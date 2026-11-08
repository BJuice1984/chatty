"""Durable bot run execution with bounded retries and chat-scoped authorization.

One run per source message (``unique(message_id)``): execution is claimed by a
conditional compare-and-set transition committed before any external call, so
duplicate delivery never creates a second active execution and a hard crash
leaves an observable ``queued``/``running`` row. Search stays scoped to the
source chat through the stage 8 contract and the answer is posted through the
stage 6 message contract, whose file authorization is the enforcement point.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Iterator
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
from app.services.files import FileService
from app.services.messages import MessageService
from app.vacations.forms.skill import VacationFormsSkill
from app.vacations.skill import VacationSkill

logger = logging.getLogger(__name__)

# Окно коалесценции дельт: чаще нет смысла (финальное сообщение всё равно
# несёт полный текст), реже — заметное «дёргание» плейсхолдера
DELTA_EMIT_WINDOW_SECONDS = 0.25


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
        stream_clock: Callable[[], float] | None = None,
        files: FileService | None = None,
    ):
        self.session = session
        self.settings = settings
        self.bot = bot
        self.rag = rag
        self.provider = provider if provider is not None else default_provider(bot)
        self.rag_provider = rag_provider
        self.rag_search = rag_search if rag_search is not None else self._default_rag_search
        self.clock = clock if clock is not None else (lambda: datetime.now(UTC))
        self.stream_clock = stream_clock if stream_clock is not None else time.monotonic
        self.files = files
        self.runs = BotRunRepository(session)
        self.messages = MessageRepository(session)
        self.users = UserRepository(session)
        self.chats = ChatService(session)
        self.message_service = MessageService(session)

    def _default_rag_search(self, *, chat_id: int, user_id: int, query: str, top_k: int) -> list[Any]:
        service = DocumentService(self.session, self.settings, self.rag, provider=self.rag_provider)
        return service.search(chat_id=chat_id, user_id=user_id, query=query, top_k=top_k)

    def run(
        self,
        *,
        chat_id: int,
        user_id: int,
        message_id: int,
        on_delta: Callable[[str], None] | None = None,
    ) -> BotRun:
        # write guard: a bot run posts an answer into the chat, so an
        # archived membership (read-only) is rejected like a missing one
        chat = self.chats.require_active_member(chat_id, user_id)
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
        return self._execute(run, chat, message, bot_user, requester_id=user_id, on_delta=on_delta)

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

    def _answer(self, prompt: list[dict[str, str]], *, on_delta: Callable[[str], None] | None) -> str:
        """Full answer through the provider seam.

        Стриминг включается только при ``CHATTY_BOT_STREAMING=true`` И наличии
        ``complete_stream`` у провайдера: структурные фейки (классические
        scripted-провайдеры) идут старым целым ответом, а выключенный флаг —
        операторский kill-switch обратно к байт-в-байт прежнему ``complete()``.
        """
        complete_stream = getattr(self.provider, 'complete_stream', None)
        if self.bot.streaming and complete_stream is not None:
            return self._consume_stream(complete_stream(prompt), on_delta)
        return self.provider.complete(prompt)

    def _consume_stream(self, deltas: Iterator[str], on_delta: Callable[[str], None] | None) -> str:
        """Аккумулировать полный ответ, коалесцируя дельты в on_delta.

        Дельты склеиваются окном ~250мс; хвост не флашится (финальное
        сообщение несёт полный текст); после неудачи колбэк не вызывается —
        буфер отбрасывается вместе с раном, ошибки моста глотаются и
        логируются: стриминговый прогресс не должен ронять или блокировать ран.
        """
        parts: list[str] = []
        window: list[str] = []
        emitted_at = self.stream_clock()
        for delta in deltas:
            if not delta:
                continue
            parts.append(delta)
            if on_delta is None:
                continue
            window.append(delta)
            moment = self.stream_clock()
            if moment - emitted_at < DELTA_EMIT_WINDOW_SECONDS:
                continue
            text = ''.join(window)
            window.clear()
            emitted_at = moment
            self._emit_delta(on_delta, text)
        return ''.join(parts)

    def _emit_delta(self, on_delta: Callable[[str], None], text: str) -> None:
        try:
            on_delta(text)
        except Exception:
            logger.warning('bot delta bridge failed', exc_info=True)

    def _execute(
        self,
        run: BotRun,
        chat: Chat,
        message: Message,
        bot_user,
        *,
        requester_id: int,
        on_delta: Callable[[str], None] | None = None,
    ) -> BotRun:
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

        # Отмена рана выключением бота (2026-11-07): is_ai гасится другим
        # запросом (PUT toggle), пока наш ран идёт, — свежий перечит флага
        # из БД (expire): выключенный чат не тратит инференс и не постит
        # ответ; вторая проверка после инференса закрывает окно генерации
        self.session.expire(chat)
        if not chat.is_ai:
            return fail('bot_disabled')

        # Vacation forms skill (2026-11-08-vacation-forms, D-F-12): runs
        # FIRST — an active wizard owns the dialog, and a form phrasing must
        # never fall into the dates offer; generated RTF is delivered as a
        # chat attachment through the FileService seam injected at the
        # endpoint (D-F-5)
        forms_outcome = VacationFormsSkill(self.session).handle(
            content=message.content,
            user_id=message.user_id,
        )
        if forms_outcome is not None and forms_outcome.reply is not None:
            self.session.expire(chat)
            if not chat.is_ai:
                return fail('bot_disabled')
            attachment_file_id = None
            if forms_outcome.attachment is not None:
                if self.files is None:
                    return fail('form_storage_unavailable')
                try:
                    file = self.files.upload(
                        chat_id=chat.id,
                        owner_id=bot_user.id,
                        original_name=forms_outcome.attachment.filename,
                        content_type=forms_outcome.attachment.content_type,
                        body=forms_outcome.attachment.body,
                    )
                except Exception:
                    logger.warning('form attachment upload failed', exc_info=True)
                    return fail('form_storage_failed')
                attachment_file_id = file.id
            response = self.message_service.create(
                chat.id,
                bot_user.id,
                MessageCreate(
                    content=forms_outcome.reply.strip()[: self.bot.max_answer_chars],
                    file_id=attachment_file_id,
                ),
            )
            run.status = 'succeeded'
            run.error_kind = None
            run.response_message_id = response.id
            run.attachment_file_id = attachment_file_id
            self.session.commit()
            self.session.refresh(run)
            return run
        if forms_outcome is not None and forms_outcome.passthrough_question is not None:
            question = forms_outcome.passthrough_question
        else:
            question = message.content

        # Vacation skill (2026-11-08): deterministic branch BEFORE the RAG
        # search — the schedule never enters the RAG pipeline (live-инцидент
        # 2026-11-03); reply posts through the same message path, a decline
        # passes the ORIGINAL question into the normal path below
        vacation_outcome = VacationSkill(self.session, self.provider).handle(
            content=message.content,
            user_id=message.user_id,
        )
        if vacation_outcome is not None and vacation_outcome.reply is not None:
            self.session.expire(chat)
            if not chat.is_ai:
                return fail('bot_disabled')
            response = self.message_service.create(
                chat.id,
                bot_user.id,
                MessageCreate(content=vacation_outcome.reply.strip()[: self.bot.max_answer_chars]),
            )
            run.status = 'succeeded'
            run.error_kind = None
            run.response_message_id = response.id
            run.attachment_file_id = None
            self.session.commit()
            self.session.refresh(run)
            return run
        if vacation_outcome is not None and vacation_outcome.passthrough_question is not None:
            question = vacation_outcome.passthrough_question

        try:
            found = self.rag_search(
                chat_id=chat.id,
                user_id=bot_user.id,
                query=question,
                top_k=self.bot.rag_top_k,
            )
        except HTTPException as exc:
            if exc.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                return fail('embedding_provider_unavailable')
            raise

        # Нерелевантные чанки (score ниже порога) не идут ни в промпт, ни в
        # attachment: на посторонний вопрос бот честно отвечает «информации
        # нет» и НЕ присылает ближайший по косинусу файл (live-инцидент
        # 2026-11-03: «график отпусков» прилетал к любому вопросу)
        chunks = [hit for hit in found if hit.score >= self.bot.rag_min_score]
        attachment_file_id = chunks[0].chunk.file_id if chunks else None

        try:
            answer = self._answer(
                build_messages(question, [hit.chunk.content for hit in chunks]),
                on_delta=on_delta,
            )
        except BotProviderError as exc:
            return fail(exc.kind)
        content = answer.strip()[: self.bot.max_answer_chars]

        self.session.expire(chat)
        if not chat.is_ai:
            return fail('bot_disabled')

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
