"""Chat lifecycle and server-side membership authorization."""

from __future__ import annotations

from datetime import UTC, datetime
from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.chat import Chat, ChatMember
from app.models.message import Message
from app.models.user import User
from app.repositories.chats import ChatRepository
from app.repositories.contacts import ContactRepository
from app.repositories.messages import MessageRepository
from app.repositories.users import UserRepository
from app.schemas.chat import (
    ChatCreate,
    ChatLastMessageBrief,
    ChatMemberBrief,
    ChatSearchResult,
    ChatSearchSnippet,
    ChatUpdate,
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

# Сид серверного авто-названия чата (013): чат one-click-создания стартует
# как «Чат с», каждое СВЕЖЕЕ членство дописывает имя участника. Задуман как
# задокументированный sync-twin фронтовой константы NEW_CHAT_TITLE
# (src/utils/constants.ts) — менять только парой.
AUTO_TITLE_SEED = 'Чат с'


def to_member_brief(
    user_id: int,
    email: str,
    avatar_file_id: int | None,
    display_name: str | None = None,
    left_at: datetime | None = None,
) -> ChatMemberBrief:
    """Единая точка сборки формы участника: и список чатов, и эндпоинт
    участников строят её здесь, чтобы формы не разъехались (login —
    email-хэнл контракта, display_name — редактируемая колонка с fallback
    на локальную часть email — правило UserSearchItem/ContactResponse);
    left_at — архивное членство, значимо только для одиночного эндпоинта
    участников (краткие составы GET /chats зовут без него)."""
    return ChatMemberBrief(
        id=user_id,
        login=email,
        display_name=display_name or email.split('@')[0],
        avatar_url=file_avatar_url(avatar_file_id),
        left_at=left_at,
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
        self.messages_repo = MessageRepository(session)
        # the repository (not ContactService) is composed here to keep the
        # implicit capture free of a service-to-service cycle
        self.contacts = ContactRepository(session)

    def create(self, owner_id: int, payload: ChatCreate) -> Chat:
        chat = self.chats.add(Chat(
            title=payload.title.strip(),
            owner_id=owner_id,
            is_ai=payload.is_ai,
            auto_titled=payload.auto_titled,
        ))
        self.chats.add_member(ChatMember(chat_id=chat.id, user_id=owner_id))
        self.session.commit()
        self.session.refresh(chat)
        return chat

    def update(
        self,
        chat_id: int,
        requester_id: int,
        payload: ChatUpdate,
    ) -> tuple[Chat, Message | None, Message | None, bool, str | None]:
        """Обобщённое тело PUT (013): прежняя rename-семантика для заданного
        ИЗМЕНИВШЕГОСЯ title (require_active_member — write-гвард, архивы
        read-only; идентичный title — идемпотентный no-op без сообщения) И
        гашение auto_titled (ручное название отключает авто-режим навсегда),
        плюс флаг is_ai для заданного значения. Возвращает (chat, system_message,
        ai_message, ai_changed, auto_title) — ВЕСЬ WS fan-out принадлежит
        эндпоинту (прецедент репозитория: сервисы не импортируют hub).

        2026-11-06-quick: включение AI сразу сажает бота в участники
        (ensure_bot_membership — бот виден в шапке с аватаркой, а не после
        первого ответа), а auto_titled-сид дополняется «AI» («Чат с» ->
        «Чат с AI») через ту же 013-append-механику; auto_title возвращается
        эндпоинту для fan-out chat_renamed.

        2026-11-07: смена is_ai пишет в ленту системное сообщение
        kind='chat_ai_toggled' («X включил/выключил бота») — узор
        chat_renamed; эндпоинт фан-аутит его событием 'message'."""

        chat = self.require_active_member(chat_id, requester_id)
        system_message: Message | None = None
        ai_message: Message | None = None
        ai_changed = False
        auto_title: str | None = None
        actor_name: str | None = None

        title = payload.title.strip() if payload.title is not None else None
        if title is not None and title != chat.title:
            actor_name = self.user_display_name(requester_id)
            chat.title = title
            # ручное название гасит авто-режим навсегда (фундамент LLM-нейминга:
            # контекстное переименование — только пока название автоматическое)
            chat.auto_titled = False
            system_message = self.messages_repo.add(Message(
                chat_id=chat_id,
                user_id=requester_id,
                content=f'{actor_name} переименовал чат в «{title}»',
                kind='chat_renamed',
            ))

        if payload.is_ai is not None and payload.is_ai != chat.is_ai:
            if actor_name is None:
                actor_name = self.user_display_name(requester_id)
            chat.is_ai = payload.is_ai
            ai_changed = True
            verb = 'включил' if chat.is_ai else 'выключил'
            ai_message = self.messages_repo.add(Message(
                chat_id=chat_id,
                user_id=requester_id,
                content=f'{actor_name} {verb} бота',
                kind='chat_ai_toggled',
            ))
            if chat.is_ai and not chat.is_dm:
                auto_title = self.ensure_bot_membership(chat)

        if system_message is not None or ai_changed:
            self.session.commit()
            self.session.refresh(chat)
        return chat, system_message, ai_message, ai_changed, auto_title

    def user_display_name(self, user_id: int) -> str:
        """Отображаемое имя участника для служебных строк ленты
        (rename/ai-toggle/member events): display_name fallback — правило
        to_member_brief (локальная часть email), неизвестный пользователь —
        строковый id."""
        user = self.users.get_by_id(user_id)

        return (user.display_name if user is not None and user.display_name else None) \
            or (user.email.split('@')[0] if user is not None else str(user_id))

    def _member_event_message(self, chat_id: int, author_id: int, content: str, kind: str) -> Message:
        """Служебная строка ленты о составе чата (2026-11-07): пишется в
        транзакции вызывающего (add/kick/leave/rejoin), фан-аут 'message'
        принадлежит эндпоинту — узор chat_renamed."""
        return self.messages_repo.add(Message(
            chat_id=chat_id,
            user_id=author_id,
            content=content,
            kind=kind,
        ))

    def chat_avatar_event(self, chat_id: int, author_id: int) -> Message:
        """Служебная строка ленты о смене аватара чата (2026-11-07):
        «X обновил аватар чата», kind='chat_avatar_updated' — узор
        member-событий (своя транзакция: аватар уже закоммичен
        set_chat_avatar, строка — здесь); вызывающий эндпоинт
        (files.upload_avatar) сам фан-аутит строку событием 'message' и
        патч-событие 'chat_avatar_updated' АКТИВНЫМ участникам."""
        event = self._member_event_message(
            chat_id,
            author_id,
            f'{self.user_display_name(author_id)} обновил аватар чата',
            'chat_avatar_updated',
        )
        self.session.commit()
        return event

    def ensure_bot_membership(self, chat: Chat) -> str | None:
        """Посадить бота в участники (2026-11-06-quick): бот-юзер ищется по
        CHATTY_BOT_USER_EMAIL; пустой display_name дополняется «AI» (имя в
        списке участников и источник 013-append). Свежая вставка членства
        проходит через общий add-механизм с авто-дополнением названия; уже
        существующее членство — no-op. Возвращает новый title или None;
        коммитит вызывающий. Бот-юзера нет (не зарегистрирован) — тихий
        пропуск: ран бота сам честно зафейлится bot_user_not_configured."""
        from app.bot.config import bot_settings_from_env

        bot = self.users.get_by_email(bot_settings_from_env().user_email)
        if bot is None:
            return None
        if not bot.display_name:
            bot.display_name = 'AI'
            self.session.add(bot)
        existing = self.chats.get_member(chat.id, bot.id)
        if existing is not None:
            return None
        member = ChatMember(chat_id=chat.id, user_id=bot.id)
        self.chats.add_member(member)
        return self._auto_title_append(chat, bot.id)

    def mark_all_read(self, user_id: int) -> int:
        """«Пометить всё прочитанными»: bulk-upsert маркеров чтения по всем
        чатам пользователя (активным И архивным — ровно тот скоуп, чьи
        непрочитанные считает unread_counts). Возвращает число чатов с
        сообщениями (чаты без сообщений маркера не требуют)."""

        return self.chats.mark_all_read(user_id)

    def create_dm(self, owner_id: int, target_id: int) -> tuple[Chat, bool]:
        """Get-or-create the 1:1 chat with the user: the existing DM (found
        by the is_dm flag plus both memberships, never by member counting)
        returns (chat, False); otherwise the chat is created with the
        target's display_name (email local part when unset) as the
        denormalized title, owner = caller, is_ai False, is_dm True, and
        exactly the two members -> (chat, True)."""
        if target_id == owner_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='dm_self_forbidden')
        target = self.users.get_by_id(target_id)
        if target is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='user_not_found')
        existing = self.chats.find_dm(owner_id, target_id)
        if existing is not None:
            return existing, False
        login = target.email.lower()
        # NEW dms prefer the target's display_name; the stored title stays
        # denormalized forever (existing dm titles keep their local part)
        chat = self.chats.add(
            Chat(
                title=target.display_name or login.split('@', 1)[0] or login,
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
        for chat_id, user_id, email, avatar_file_id, display_name in self.chats.list_members_for_chats(chat_ids):
            briefs = grouped.setdefault(chat_id, [])
            if len(briefs) < MEMBERS_BRIEF_CAP:
                briefs.append(to_member_brief(user_id, email, avatar_file_id, display_name))
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
        cap CHATS_SEARCH_RESULTS_CAP применяется после сортировки.

        '@'-режим: запрос с ведущим '@' ищет не по тексту, а по СОУЧАСТНИКАМ
        (префикс login/display_name, кроме самого запрашивающего) — это путь
        ручного '@'-ввода и кнопки «Найти все чаты» (сид '@'+email уникален
        и даёт ровно общие чаты с этим пользователем). Порядок — по
        активности (last_message ?? created_at, id DESC), сниппет несёт имя
        совпавшего, времени совпадения нет."""
        if q.startswith('@'):
            return self._search_by_member(user_id, q[1:].strip())
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

    def _search_by_member(self, user_id: int, term: str) -> list[ChatSearchResult]:
        """'@'-ветка: пустой term честно даёт пустой результат; matched_in
        'member', сниппет — имя совпавшего участника (выбрано в репозитории),
        last_match_at нет; порядок по активности (last_message.created_at ??
        chat.created_at DESC, затем id DESC — зеркалирует клиентский
        activityOrder: датируемые свежее-раньше, недатированные ниже всех)."""
        if term == '':
            return []
        matches = self.chats.search_member_matches(user_id, term)
        if not matches:
            return []
        chat_ids = [chat_id for chat_id, _name in matches]
        last_messages = self.last_messages_for_chats(chat_ids)
        created_ats = self.chats.chat_created_ats(chat_ids)

        def anchor_of(chat_id: int):
            brief = last_messages.get(chat_id)
            if brief is not None:
                return brief.time
            return created_ats.get(chat_id)

        anchored = sorted(
            [(chat_id, name) for chat_id, name in matches if anchor_of(chat_id) is not None],
            key=lambda item: (anchor_of(item[0]), item[0]),
            reverse=True,
        )
        unanchored = sorted(
            [(chat_id, name) for chat_id, name in matches if anchor_of(chat_id) is None],
            key=lambda item: item[0],
            reverse=True,
        )
        return [
            ChatSearchResult(
                chat_id=chat_id,
                matched_in='member',
                snippet=ChatSearchSnippet(before='', match=name, after=''),
            )
            for chat_id, name in (anchored + unanchored)[:CHATS_SEARCH_RESULTS_CAP]
        ]

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

    def kick_member(self, chat_id: int, requester_id: int, user_id: int) -> Message | None:
        """Owner-only kick (the delete-chat precedent): hard-deletes the
        membership row — the kicked user loses the chat entirely (no
        archive row: GET /chats and WS connect refuse), a later re-add
        starts a FRESH row. The owner's own archived state does not matter
        (require_owned checks owner_id only). 2026-11-07: в ленту пишется
        служебная строка kind='chat_member_removed' («X удалил Y») — её
        фан-аутит эндпоинт."""

        self.require_owned(chat_id, requester_id)
        if not self.chats.remove_member(chat_id, user_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='member_not_found')
        event = self._member_event_message(
            chat_id,
            requester_id,
            f'{self.user_display_name(requester_id)} удалил {self.user_display_name(user_id)}',
            'chat_member_removed',
        )
        self.session.commit()
        return event

    def leave(self, chat_id: int, user_id: int) -> Message | None:
        """Self-leave ARCHIVES the membership: left_at = now, the row (and
        with it the readable history and the dimmed list entry) stays.
        Repeat leave on an archived row is an idempotent no-write; a
        never-member gets the membership 403; the chat itself lives on
        (owner_id stays historical). 2026-11-07: в ленту пишется служебная
        строка kind='chat_member_left' («X удалился из чата»)."""

        self.require_chat(chat_id)
        member = self.chats.get_member(chat_id, user_id)
        if member is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat_membership_required')
        if member.left_at is not None:
            return None
        member.left_at = datetime.now(UTC)
        event = self._member_event_message(
            chat_id,
            user_id,
            f'{self.user_display_name(user_id)} удалился из чата',
            'chat_member_left',
        )
        self.session.commit()
        return event

    def rejoin(self, chat_id: int, user_id: int) -> Message | None:
        """Self-rejoin after a self-leave: reactivates the caller's OWN
        archived membership row through the shared helper (left_at -> NULL
        on the same row — writes and live pushes resume, joined_at kept).
        A missing row (kicked or never-member) gets the membership 403,
        an already-active row is an idempotent no-write, an unknown chat
        the usual 404. 2026-11-07: реальная реактивация пишет в ленту
        kind='chat_member_rejoined' («X вернулся в чат»)."""

        self.require_chat(chat_id)
        member = self.chats.get_member(chat_id, user_id)
        if member is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat_membership_required')
        if not self.chats.reactivate_member(member):
            return None
        event = self._member_event_message(
            chat_id,
            user_id,
            f'{self.user_display_name(user_id)} вернулся в чат',
            'chat_member_rejoined',
        )
        self.session.commit()
        return event

    def add_member(self, chat_id: int, requester_id: int, user_id: int) -> tuple[ChatMember, str | None, bool, Message | None]:
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
        semantics). The membership response shape stays unchanged.

        013: the FRESH-insert branch additionally appends the added member's
        name to an auto-titled non-DM chat's title (the existing/reactivated
        early return never touches the title — a repeated add must not
        duplicate the name). Returns (member, new_title | None, ai_changed,
        member_event); the WS fan-out for a non-None new_title (and the AI
        toggle) belongs to the ENDPOINT (the repo precedent: services never
        import the hub).

        2026-11-06-quick: добавление БОТА участником (кнопка «+» с адресом
        бота) включает чату is_ai — «то же самое», что «+AI»: карточка
        помечается ✦AI, пустой display_name бота дополняется «AI» (append
        даст «Чат с AI»), endpoint фан-аутит chat_ai_toggled.

        2026-11-07: свежая вставка (и реальная реактивация) НЕ-бота пишет в
        ленту kind='chat_member_added' («X добавил Y») — идемпотентный
        повтор молчит; бот не пишется отдельно (его семантика — «включил
        бота» у PUT-toggle)."""
        chat = self.require_active_member(chat_id, requester_id)
        user = self.users.get_by_id(user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='user_not_found')
        from app.bot.config import bot_settings_from_env

        is_bot = user.email.lower() == bot_settings_from_env().user_email
        if is_bot and not user.display_name:
            user.display_name = 'AI'
            self.session.add(user)
        existing = self.chats.get_member(chat_id, user_id)
        if existing is not None:
            # the shared reactivation helper (the rejoin path's twin); the
            # auto-title append NEVER runs here (review F-4)
            reactivated = self.chats.reactivate_member(existing)
            if user_id != requester_id:
                self.contacts.upsert(requester_id, user_id)
            ai_changed = is_bot and not chat.is_ai
            if ai_changed:
                chat.is_ai = True
            member_event = None
            if reactivated and not is_bot:
                member_event = self._member_event_message(
                    chat_id,
                    requester_id,
                    f'{self.user_display_name(requester_id)} добавил {self.user_display_name(user_id)}',
                    'chat_member_added',
                )
            if reactivated or user_id != requester_id or ai_changed or member_event is not None:
                self.session.commit()
            return existing, None, ai_changed, member_event
        member = ChatMember(chat_id=chat_id, user_id=user_id)
        try:
            self.chats.add_member(member)
            if user_id != requester_id:
                self.contacts.upsert(requester_id, user_id)
            new_title = self._auto_title_append(chat, user_id)
            ai_changed = is_bot and not chat.is_ai
            if ai_changed:
                chat.is_ai = True
            member_event = None
            if not is_bot:
                member_event = self._member_event_message(
                    chat_id,
                    requester_id,
                    f'{self.user_display_name(requester_id)} добавил {self.user_display_name(user_id)}',
                    'chat_member_added',
                )
            self.session.commit()
        except IntegrityError:
            self.session.rollback()
            existing = self.chats.get_member(chat_id, user_id)
            if existing is None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='member_conflict')
            return existing, None, False, None
        self.session.refresh(member)
        return member, new_title, ai_changed, member_event

    def _auto_title_append(self, chat: Chat, user_id: int) -> str | None:
        """Дописывает имя СВЕЖЕГО участника в авто-название чата (013):
        сработает только для auto_titled не-DM чата; сид AUTO_TITLE_SEED
        получает имя через пробел («Чат с Вася»), более длинное название —
        через запятую («Чат с Вася, Маша»); имя — display_name с фолбэком на
        локальную часть email (правило to_member_brief). Результат длиннее
        200 символов — тихий пропуск (само добавление остаётся успешным).
        Возвращает новый title или None; коммитит вызывающий — той же
        транзакцией, что и вставку членства."""
        if not chat.auto_titled or chat.is_dm:
            return None
        user = self.users.get_by_id(user_id)
        if user is None:
            return None
        login = user.email.lower()
        name = user.display_name or login.split('@', 1)[0] or login
        new_title = f'{AUTO_TITLE_SEED} {name}' if chat.title == AUTO_TITLE_SEED else f'{chat.title}, {name}'
        # кап колонки String(200) — тот же лимит, что max_length ChatCreate/ChatUpdate
        if len(new_title) > 200:
            return None
        chat.title = new_title
        return new_title
