"""Message persistence, authorization, pagination, idempotency и социальный слой."""

from __future__ import annotations

from collections.abc import Sequence
from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.message import Message
from app.models.reaction import Reaction
from app.repositories.chats import ChatRepository
from app.repositories.files import FileRepository
from app.repositories.messages import MessageRepository
from app.services.chats import ChatService
from app.repositories.reactions import ReactionRepository
from app.schemas.message import MessageCreate, MessageReplyTo, MessageResponse
from app.schemas.reaction import REACTION_EMOJIS, ReactionSummary


MAX_HISTORY_LIMIT = 100
REPLY_SNIPPET_LENGTH = 80


class MessageService:
    def __init__(self, session: Session):
        self.session = session
        self.chats = ChatRepository(session)
        self.files = FileRepository(session)
        self.messages = MessageRepository(session)
        self.reactions = ReactionRepository(session)

    def create(self, chat_id: int, user_id: int, payload: MessageCreate) -> Message:
        self._require_member(chat_id, user_id)
        if payload.client_message_id:
            existing = self.messages.get_by_client_message_id(chat_id, user_id, payload.client_message_id)
            if existing is not None:
                return existing
        if payload.reply_to_id is not None:
            reply_target = self.messages.get_by_id(payload.reply_to_id)
            if reply_target is None or reply_target.chat_id != chat_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='reply_target_invalid')
        if payload.file_id is not None:
            file = self.files.get_by_id(payload.file_id)
            if file is None or file.chat_id != chat_id or file.status != 'ready':
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='file_not_ready_for_message')
        message = Message(
            chat_id=chat_id,
            user_id=user_id,
            content=payload.content.strip() if payload.content else None,
            file_id=payload.file_id,
            client_message_id=payload.client_message_id,
            reply_to_id=payload.reply_to_id,
        )
        try:
            self.messages.add(message)
            self.session.commit()
            self.session.refresh(message)
            return message
        except IntegrityError:
            self.session.rollback()
            if payload.client_message_id:
                existing = self.messages.get_by_client_message_id(chat_id, user_id, payload.client_message_id)
                if existing is not None:
                    return existing
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='message_conflict')

    def history(
        self,
        chat_id: int,
        user_id: int,
        *,
        before_id: int | None,
        limit: int,
    ) -> tuple[list[Message], int | None]:
        self._require_member(chat_id, user_id)
        bounded_limit = min(max(limit, 1), MAX_HISTORY_LIMIT)
        before = None
        if before_id is not None:
            before = self.messages.get_by_id(before_id)
            if before is None or before.chat_id != chat_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='invalid_history_cursor')
        rows = self.messages.list_before(chat_id, before=before, limit=bounded_limit)

        # выдача истории читает чат: маркер двигаем к старшей странице выдачи
        # (страница desc: первый элемент — новейший из выданных)
        if rows:
            newest_read = max(row.id for row in rows[:bounded_limit])
            ChatService(self.session).mark_read(chat_id, user_id, newest_read)

        has_more = len(rows) > bounded_limit
        page = rows[:bounded_limit]
        return page, page[-1].id if has_more and page else None

    def set_reaction(
        self,
        chat_id: int,
        message_id: int,
        user_id: int,
        emoji: str,
    ) -> tuple[bool, list[ReactionSummary]]:
        """Переключает реакцию; возвращает (active, сводка по сообщению для зрителя)."""

        self._require_member(chat_id, user_id)
        if emoji not in REACTION_EMOJIS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='emoji_not_allowed')
        message = self.messages.get_by_id(message_id)
        if message is None or message.chat_id != chat_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='message_not_found')
        existing = self.reactions.find(message_id, user_id, emoji)
        if existing is not None:
            self.reactions.remove(existing)
            self.session.commit()
            active = False
        else:
            try:
                self.reactions.add(Reaction(message_id=message_id, user_id=user_id, emoji=emoji))
                self.session.commit()
                active = True
            except IntegrityError:
                # параллельный запрос уже вставил ту же строку — реакция считается включённой
                self.session.rollback()
                active = self.reactions.find(message_id, user_id, emoji) is not None
        return active, self.reaction_summaries([message_id], user_id).get(message_id, [])

    def reaction_summaries(
        self,
        message_ids: Sequence[int],
        viewer_id: int,
    ) -> dict[int, list[ReactionSummary]]:
        """Сводки {emoji, count, mine} по сообщениям; mine относительно зрителя."""

        ids = list(message_ids)
        counts = self.reactions.counts_by_message(ids)
        mine = self.reactions.viewer_emojis(ids, viewer_id)
        summaries: dict[int, list[ReactionSummary]] = {}
        for message_id, emoji, count in counts:
            summaries.setdefault(message_id, []).append(
                ReactionSummary(emoji=emoji, count=count, mine=(message_id, emoji) in mine),
            )
        return summaries

    def present(self, messages: Sequence[Message], viewer_id: int) -> list[MessageResponse]:
        """Собирает ответы контракта: reply-блок со сниппетом и сводки реакций."""

        summaries = self.reaction_summaries([message.id for message in messages], viewer_id)
        parents = self.messages.get_many(
            {message.reply_to_id for message in messages if message.reply_to_id is not None},
        )
        presented: list[MessageResponse] = []
        for message in messages:
            reply_to = None
            parent = parents.get(message.reply_to_id) if message.reply_to_id is not None else None
            if parent is not None:
                reply_to = MessageReplyTo(
                    id=parent.id,
                    user_id=parent.user_id,
                    snippet=(parent.content or '')[:REPLY_SNIPPET_LENGTH],
                )
            presented.append(
                MessageResponse.model_validate(message).model_copy(
                    update={'reply_to': reply_to, 'reactions': summaries.get(message.id, [])},
                ),
            )
        return presented

    def present_one(self, message: Message, viewer_id: int) -> MessageResponse:
        return self.present([message], viewer_id)[0]

    def _require_member(self, chat_id: int, user_id: int) -> None:
        if self.chats.get_by_id(chat_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='chat_not_found')
        if not self.chats.is_member(chat_id, user_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat_membership_required')
