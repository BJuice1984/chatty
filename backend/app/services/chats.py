"""Chat lifecycle and server-side membership authorization."""

from __future__ import annotations

from datetime import UTC, datetime
from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.chat import Chat, ChatMember
from app.models.user import User
from app.repositories.chats import ChatRepository
from app.repositories.contacts import ContactRepository
from app.repositories.users import UserRepository
from app.schemas.chat import (
    ChatCreate,
    ChatLastMessageBrief,
    ChatMemberBrief,
    ChatSearchResult,
    ChatSearchSnippet,
)
from app.schemas.file import avatar_url as file_avatar_url

# Cap кратких составов в GET /chats: гвард, не контракт пагинации
# (прецедент FEED_CAP историй); диалоги (<= 2 участников) не режутся —
# правило «единственный собеседник» нужно только им.
MEMBERS_BRIEF_CAP = 10

# Cap результатов GET /chats/search: применяется ПОСЛЕ сортировки,
# гвард, не пагинация (прецедент MEMBERS_BRIEF_CAP)
CHATS_SEARCH_RESULTS_CAP = 50

# Сниппет поиска: окно до/после совпадения ≤ 32 символов с каждой стороны
CHAT_SEARCH_SNIPPET_WINDOW = 32


def to_member_brief(user_id: int, email: str, avatar_file_id: int | None) -> ChatMemberBrief:
    """Единая точка сборки формы участника: и список чатов, и эндпоинт
    участников строят её здесь, чтобы формы не разъехались (login —
    email-хэнл контракта, display_name — его локальная часть)."""
    return ChatMemberBrief(
        id=user_id,
        login=email,
        display_name=email.split('@')[0],
        avatar_url=file_avatar_url(avatar_file_id),
    )


def build_search_snippet(content: str, q: str) -> ChatSearchSnippet | None:
    """Окно вокруг ПЕРВОГО case-insensitive вхождения q в content: до и
    после ≤ CHAT_SEARCH_SNIPPET_WINDOW символов, части — сырые подстроки
    оригинала (экранирует клиент — сервер остаётся transport-only).
    None — защитный случай «БД совпала, а Python-фолдинг не нашёл»
    (расхождение таблиц фолдинга SQLite/PG/Python на экзотике)."""
    needle = q.lower()
    index = content.lower().find(needle)
    if index < 0:
        return None
    start = max(index - CHAT_SEARCH_SNIPPET_WINDOW, 0)
    end = min(index + len(needle) + CHAT_SEARCH_SNIPPET_WINDOW, len(content))
    return ChatSearchSnippet(
        before=content[start:index],
        match=content[index:index + len(needle)],
        after=content[index + len(needle):end],
    )


class ChatService:
    def __init__(self, session: Session):
        self.session = session
        self.chats = ChatRepository(session)
        self.users = UserRepository(session)
        # the repository (not ContactService) is composed here to keep the
        # implicit capture free of a service-to-service cycle
        self.contacts = ContactRepository(session)

    def create(self, owner_id: int, payload: ChatCreate) -> Chat:
        chat = self.chats.add(Chat(title=payload.title.strip(), owner_id=owner_id, is_ai=payload.is_ai))
        self.chats.add_member(ChatMember(chat_id=chat.id, user_id=owner_id))
        self.session.commit()
        self.session.refresh(chat)
        return chat

    def create_dm(self, owner_id: int, target_id: int) -> tuple[Chat, bool]:
        """Get-or-create the 1:1 chat with the user: the existing DM (found
        by the is_dm flag plus both memberships, never by member counting)
        returns (chat, False); otherwise the chat is created with the target
        email local part as the denormalized title, owner = caller, is_ai
        False, is_dm True, and exactly the two members -> (chat, True)."""
        if target_id == owner_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='dm_self_forbidden')
        target = self.users.get_by_id(target_id)
        if target is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='user_not_found')
        existing = self.chats.find_dm(owner_id, target_id)
        if existing is not None:
            return existing, False
        login = target.email.lower()
        chat = self.chats.add(
            Chat(
                title=login.split('@', 1)[0] or login,
                owner_id=owner_id,
                is_ai=False,
                is_dm=True,
            )
        )
        self.chats.add_member(ChatMember(chat_id=chat.id, user_id=owner_id))
        self.chats.add_member(ChatMember(chat_id=chat.id, user_id=target_id))
        self.session.commit()
        self.session.refresh(chat)
        return chat, True

    def list_for_user(self, user_id: int) -> list[tuple[Chat, datetime | None]]:
        """ALL chats of the user with their caller-relative left_at (None =
        active) — active AND archived rows; kicked users see nothing."""
        return self.chats.list_for_user(user_id)

    def active_member_ids(self, chat_id: int) -> set[int]:
        """ACTIVE member ids of the chat — the WS fan-out filter: archived
        memberships keep their sockets out of live pushes."""
        return self.chats.active_member_ids(chat_id)

    def unread_counts(self, user_id: int) -> dict[int, int]:
        """Непрочитанные по каждому чату: чужие сообщения новее последнего
        прочитанного маркера (chat_last_reads); своих сообщений не считаем."""
        return self.chats.unread_counts(user_id)

    def members_for_chats(self, chat_ids: list[int]) -> dict[int, list[ChatMemberBrief]]:
        """Краткие составы участников для GET /chats: один IN-запрос по всем
        чатам, группировка по chat_id, cap MEMBERS_BRIEF_CAP (диалоги <= 2
        участников не режутся). Только для списка чатов — эндпоинт
        /chats/{id}/members отдаёт полный состав без cap."""
        grouped: dict[int, list[ChatMemberBrief]] = {}
        for chat_id, user_id, email, avatar_file_id in self.chats.list_members_for_chats(chat_ids):
            briefs = grouped.setdefault(chat_id, [])
            if len(briefs) < MEMBERS_BRIEF_CAP:
                briefs.append(to_member_brief(user_id, email, avatar_file_id))
        return grouped

    def list_member_briefs(self, chat_id: int) -> list[ChatMemberBrief]:
        """Полный состав чата без cap (панель участников), user_id ASC."""
        return [to_member_brief(*row) for row in self.chats.list_members(chat_id)]

    def last_messages_for_chats(self, chat_ids: list[int]) -> dict[int, ChatLastMessageBrief]:
        """Последние сообщения для GET /chats: один SELECT по всему списку
        (новейшее по created_at, тай-брейк id — в репозитории), форма
        собирается в этой единой точке, чтобы list_chats не разъехался с
        будущими потребителями; content is None — файловое вложение без
        текста; чаты без сообщений в результате отсутствуют (у эндпоинта
        это last_message: null)."""
        return {
            chat_id: ChatLastMessageBrief(content=content, time=created_at)
            for chat_id, content, created_at in self.chats.last_messages_for_chats(chat_ids)
        }

    def search_chats(self, user_id: int, q: str) -> list[ChatSearchResult]:
        """Поиск case-insensitive подстроки по чатам пользователя: title и
        непустые content сообщений (lower()+LIKE с экранированием — в
        репозитории); скоуп по участию, чужие чаты не появляются по
        построению. matched_in 'both' мержит совпадения, сниппет — окно
        вокруг первого вхождения в СВЕЖАЙШЕМ совпадающем сообщении.
        Порядок: группа с совпадением в title (title ASC, chat_id ASC),
        затем только-сообщения (свежее совпадение раньше, chat_id DESC);
        cap CHATS_SEARCH_RESULTS_CAP применяется после сортировки."""
        titles = dict(self.chats.search_title_matches(user_id, q))
        messages: dict[int, tuple[str, datetime]] = {
            chat_id: (content, created_at)
            for chat_id, content, created_at in self.chats.search_message_matches(user_id, q)
        }

        results: list[ChatSearchResult] = []
        # группа title (title-only + both): title ASC, chat_id ASC
        for chat_id, title in sorted(titles.items(), key=lambda item: (item[1], item[0])):
            freshest = messages.get(chat_id)
            if freshest is None:
                results.append(ChatSearchResult(chat_id=chat_id, matched_in='title'))
                continue
            content, created_at = freshest
            results.append(
                ChatSearchResult(
                    chat_id=chat_id,
                    matched_in='both',
                    snippet=build_search_snippet(content, q),
                    last_match_at=created_at,
                )
            )
        # группа только-сообщения: (last_match_at, chat_id) DESC
        message_only = [
            (chat_id, content, created_at)
            for chat_id, (content, created_at) in messages.items()
            if chat_id not in titles
        ]
        for chat_id, content, created_at in sorted(
            message_only, key=lambda row: (row[2], row[0]), reverse=True
        ):
            results.append(
                ChatSearchResult(
                    chat_id=chat_id,
                    matched_in='message',
                    snippet=build_search_snippet(content, q),
                    last_match_at=created_at,
                )
            )
        return results[:CHATS_SEARCH_RESULTS_CAP]

    def mark_read(self, chat_id: int, user_id: int, message_id: int) -> None:
        """Открытие истории читает чат до message_id включительно.
        Архивное участие — read-only: маркер не двигается (403 здесь сломал
        бы чтение истории — путь истории зовёт это инлайн)."""
        member = self.chats.get_member(chat_id, user_id)
        if member is not None and member.left_at is not None:
            return
        self.chats.mark_read(chat_id, user_id, message_id)

    def require_chat(self, chat_id: int) -> Chat:
        chat = self.chats.get_by_id(chat_id)
        if chat is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='chat_not_found')
        return chat

    def require_member(self, chat_id: int, user_id: int) -> Chat:
        """READ-side guard: a membership row suffices — active OR archived
        (chat, messages, members, WS connect incl. history/pagination)."""

        chat = self.require_chat(chat_id)
        if not self.chats.is_member(chat_id, user_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat_membership_required')
        return chat

    def require_active_member(self, chat_id: int, user_id: int) -> Chat:
        """WRITE-side guard: ACTIVE membership required — an archived row
        (left_at set) is read-only and rejected with the same 403 as a
        missing row (message/reaction writes, add_member, leave, bot runs,
        file uploads)."""

        chat = self.require_chat(chat_id)
        if not self.chats.is_active_member(chat_id, user_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat_membership_required')
        return chat

    def require_owned(self, chat_id: int, requester_id: int) -> Chat:
        """Удалять чат может только владелец; посторонним и участникам — 403."""

        chat = self.require_chat(chat_id)
        if chat.owner_id != requester_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat_owner_required')
        return chat

    def delete(self, chat: Chat) -> None:
        """Удаляет строку чата; зависимые строки снимаются каскадами БД по FK-правилам."""

        self.chats.delete(chat)
        self.session.commit()

    def kick_member(self, chat_id: int, requester_id: int, user_id: int) -> None:
        """Owner-only kick (the delete-chat precedent): hard-deletes the
        membership row — the kicked user loses the chat entirely (no
        archive row: GET /chats and WS connect refuse), a later re-add
        starts a FRESH row. The owner's own archived state does not matter
        (require_owned checks owner_id only)."""

        self.require_owned(chat_id, requester_id)
        if not self.chats.remove_member(chat_id, user_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='member_not_found')
        self.session.commit()

    def leave(self, chat_id: int, user_id: int) -> None:
        """Self-leave ARCHIVES the membership: left_at = now, the row (and
        with it the readable history and the dimmed list entry) stays.
        Repeat leave on an archived row is an idempotent no-write; a
        never-member gets the membership 403; the chat itself lives on
        (owner_id stays historical)."""

        self.require_chat(chat_id)
        member = self.chats.get_member(chat_id, user_id)
        if member is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat_membership_required')
        if member.left_at is not None:
            return
        member.left_at = datetime.now(UTC)
        self.session.commit()

    def add_member(self, chat_id: int, requester_id: int, user_id: int) -> ChatMember:
        """Member addition plus the implicit contact capture: EVERY successful
        resolution records the contact requester -> user (skipped for
        self-add) via the idempotent get-then-insert upsert — the fresh
        insert runs it inside the existing transaction, the
        existing-membership early return commits it on its own (that
        read-only path becomes a small write path). The upsert adds no error
        path of its own, so a contact failure cannot break member addition,
        and a crash between the two writes only delays capture to the next
        idempotent add. The requester must be an ACTIVE member (the write
        guard — an archived member cannot add anyone), and an existing
        ARCHIVED row reactivates (left_at -> NULL, same row, idempotent 201
        semantics). The membership response shape stays unchanged."""
        self.require_active_member(chat_id, requester_id)
        if self.users.get_by_id(user_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='user_not_found')
        existing = self.chats.get_member(chat_id, user_id)
        if existing is not None:
            reactivated = existing.left_at is not None
            if reactivated:
                existing.left_at = None
            if user_id != requester_id:
                self.contacts.upsert(requester_id, user_id)
            if reactivated or user_id != requester_id:
                self.session.commit()
            return existing
        member = ChatMember(chat_id=chat_id, user_id=user_id)
        try:
            self.chats.add_member(member)
            if user_id != requester_id:
                self.contacts.upsert(requester_id, user_id)
            self.session.commit()
        except IntegrityError:
            self.session.rollback()
            existing = self.chats.get_member(chat_id, user_id)
            if existing is None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='member_conflict')
            member = existing
        self.session.refresh(member)
        return member
