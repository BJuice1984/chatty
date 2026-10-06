"""Durable bot run execution with bounded retries and chat-scoped authorization.

One run per source message (``unique(message_id)``): execution is claimed by a
conditional compare-and-set transition committed before any external call, so
duplicate delivery never creates a second active execution and a hard crash
leaves an observable ``queued``/``running`` row. Search stays scoped to the
source chat through the stage 8 contract and the answer is posted through the
stage 6 message contract, whose file authorization is the enforcement point.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.bot.config import BotSettings
from app.bot.prompts import build_messages
from app.bot.provider import BotProvider, BotProviderError, default_provider
from app.core.config import Settings
from app.ingestion.config import RagSettings
from app.ingestion.embeddings import EmbeddingProvider
from app.models.bot_run import BotRun
from app.models.chat import Chat
from app.models.message import Message
from app.repositories.bot_runs import BotRunRepository
from app.repositories.messages import MessageRepository
from app.repositories.users import UserRepository
from app.schemas.message import MessageCreate
from app.services.chats import ChatService
from app.services.documents import DocumentService
from app.services.messages import MessageService


def _as_utc(moment: datetime) -> datetime:
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


class BotService:
    def __init__(
        self,
        session: Session,
        settings: Settings,
        bot: BotSettings,
        rag: RagSettings,
        *,
        provider: BotProvider | None = None,
        rag_provider: EmbeddingProvider | None = None,
        rag_search: Callable[..., list[Any]] | None = None,
        clock: Callable[[], datetime] | None = None,
    ):
        self.session = session
        self.settings = settings
        self.bot = bot
        self.rag = rag
        self.provider = provider if provider is not None else default_provider(bot)
        self.rag_provider = rag_provider
        self.rag_search = rag_search if rag_search is not None else self._default_rag_search
        self.clock = clock if clock is not None else (lambda: datetime.now(UTC))
        self.runs = BotRunRepository(session)
        self.messages = MessageRepository(session)
        self.users = UserRepository(session)
        self.chats = ChatService(session)
        self.message_service = MessageService(session)

    def _default_rag_search(self, *, chat_id: int, user_id: int, query: str, top_k: int) -> list[Any]:
        service = DocumentService(self.session, self.settings, self.rag, provider=self.rag_provider)
        return service.search(chat_id=chat_id, user_id=user_id, query=query, top_k=top_k)

    def run(self, *, chat_id: int, user_id: int, message_id: int) -> BotRun:
        chat = self.chats.require_member(chat_id, user_id)
        if not chat.is_ai:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='bot_not_enabled_for_chat')
        message = self._source_message(chat_id, message_id)
        bot_user = self.users.get_by_email(self.bot.user_email)
        if bot_user is not None and message.user_id == bot_user.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='bot_own_message')

        run = self._ensure_run(chat_id, message_id)
        if not self._claim(run):
            self.session.refresh(run)
            return run
        return self._execute(run, chat, message, bot_user, requester_id=user_id)

    def _source_message(self, chat_id: int, message_id: int) -> Message:
        message = self.messages.get_by_id(message_id)
        if message is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='message_not_found')
        if message.chat_id != chat_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='message_not_in_chat')
        if not (message.content and message.content.strip()):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='message_content_required')
        return message

    def _ensure_run(self, chat_id: int, message_id: int) -> BotRun:
        """Insert the run row or re-read the existing one (idempotent delivery)."""
        existing = self.runs.get_by_message_id(message_id)
        if existing is not None:
            return existing
        run = BotRun(chat_id=chat_id, message_id=message_id, status='queued', attempt=0)
        try:
            self.runs.add(run)
            self.session.commit()
            return run
        except IntegrityError:
            self.session.rollback()
            existing = self.runs.get_by_message_id(message_id)
            if existing is None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='run_conflict') from None
            return existing

    def _claim(self, run: BotRun) -> bool:
        """Decide whether this delivery executes; every transition is a CAS."""
        now = self.clock()
        if run.status == 'succeeded':
            return False
        if run.attempt >= self.bot.max_attempts:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='retry_budget_exhausted')
        if run.status == 'failed':
            return self.runs.retry_failed(run, now=now)
        if run.status == 'running':
            age = now - _as_utc(run.updated_at)
            if age < timedelta(seconds=self.bot.stale_after_seconds):
                return False
            return self.runs.reclaim_stale(run, now=now)
        return self.runs.claim_fresh(run, now=now)

    def _execute(self, run: BotRun, chat: Chat, message: Message, bot_user, *, requester_id: int) -> BotRun:
        def fail(kind: str) -> BotRun:
            run.status = 'failed'
            run.error_kind = kind
            self.session.commit()
            self.session.refresh(run)
            return run

        if bot_user is None:
            return fail('bot_user_not_configured')
        self.chats.add_member(chat.id, requester_id, bot_user.id)
        run.bot_user_id = bot_user.id
        self.session.commit()

        try:
            chunks = self.rag_search(
                chat_id=chat.id,
                user_id=bot_user.id,
                query=message.content,
                top_k=self.bot.rag_top_k,
            )
        except HTTPException as exc:
            if exc.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                return fail('embedding_provider_unavailable')
            raise
        attachment_file_id = chunks[0][0].file_id if chunks else None

        try:
            answer = self.provider.complete(
                build_messages(message.content, [chunk.content for chunk, _score in chunks])
            )
        except BotProviderError as exc:
            return fail(exc.kind)
        content = answer.strip()[: self.bot.max_answer_chars]

        try:
            response = self.message_service.create(
                chat.id,
                bot_user.id,
                MessageCreate(content=content, file_id=attachment_file_id),
            )
        except HTTPException as exc:
            if exc.status_code == status.HTTP_400_BAD_REQUEST and exc.detail == 'file_not_ready_for_message':
                return fail('attachment_not_authorized')
            raise

        run.status = 'succeeded'
        run.error_kind = None
        run.response_message_id = response.id
        run.attachment_file_id = attachment_file_id
        self.session.commit()
        self.session.refresh(run)
        return run
