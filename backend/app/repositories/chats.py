"""Chat and membership queries."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Integer, and_, func, literal, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models.chat import Chat, ChatMember
from app.models.chat_last_read import ChatLastRead
from app.models.message import Message
from app.models.user import User


def escape_like(value: str) -> str:
    """Экранирует LIKE-метасимволы, чтобы искомая подстрока трактовалась
    буквально (правило repositories/users.py::search_by_login_prefix)."""

    return value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


class ChatRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_by_id(self, chat_id: int) -> Chat | None:
        return self.session.get(Chat, chat_id)

    def list_for_user(self, user_id: int) -> list[tuple[Chat, datetime | None]]:
        """ALL chats of the user — active AND archived rows alike — as
        (chat, membership left_at) pairs: None = active, set = archived
        (self-left; history stays readable, the list shows the archive
        entry). Kicked users have no row, so the chat disappears here."""
        statement = (
            select(Chat, ChatMember.left_at)
            .join(ChatMember, ChatMember.chat_id == Chat.id)
            .where(ChatMember.user_id == user_id)
            .order_by(Chat.created_at.asc(), Chat.id.asc())
        )
        return [(chat, left_at) for chat, left_at in self.session.execute(statement).all()]

    def is_member(self, chat_id: int, user_id: int) -> bool:
        """Row-exists membership — the READ side (active OR archived)."""
        statement = select(ChatMember.chat_id).where(
            ChatMember.chat_id == chat_id,
            ChatMember.user_id == user_id,
        )
        return self.session.scalar(statement) is not None

    def is_active_member(self, chat_id: int, user_id: int) -> bool:
        """ACTIVE membership — the WRITE side: a row with left_at set is an
        archived membership and must not pass write guards."""
        statement = select(ChatMember.chat_id).where(
            ChatMember.chat_id == chat_id,
            ChatMember.user_id == user_id,
            ChatMember.left_at.is_(None),
        )
        return self.session.scalar(statement) is not None

    def active_member_ids(self, chat_id: int) -> set[int]:
        """ACTIVE member user ids of the chat — the WS broadcast fan-out
        filter: archived sockets must not receive live pushes."""
        statement = select(ChatMember.user_id).where(
            ChatMember.chat_id == chat_id,
            ChatMember.left_at.is_(None),
        )
        return set(self.session.scalars(statement))

    def get_member(self, chat_id: int, user_id: int) -> ChatMember | None:
        return self.session.get(ChatMember, (chat_id, user_id))

    def find_dm(self, user_a: int, user_b: int) -> Chat | None:
        """Earliest is_dm chat whose membership covers BOTH users: each
        membership is its own IN-subquery, so a DM is defined solely by the
        is_dm flag plus the two memberships — member counting never promotes
        a plain 2-member group. id asc, limit 1 keeps the get-or-create
        deterministic; order of the pair does not matter."""
        membership_a = select(ChatMember.chat_id).where(ChatMember.user_id == user_a).scalar_subquery()
        membership_b = select(ChatMember.chat_id).where(ChatMember.user_id == user_b).scalar_subquery()
        statement = (
            select(Chat)
            .where(
                Chat.is_dm.is_(True),
                Chat.id.in_(membership_a),
                Chat.id.in_(membership_b),
            )
            .order_by(Chat.id.asc())
            .limit(1)
        )
        return self.session.scalars(statement).first()

    def add(self, chat: Chat) -> Chat:
        self.session.add(chat)
        self.session.flush()
        return chat

    def delete(self, chat: Chat) -> None:
        """Удаляет чат; зависимые строки снимаются каскадами БД по FK-правилам."""

        self.session.delete(chat)
        self.session.flush()

    def add_member(self, member: ChatMember) -> ChatMember:
        self.session.add(member)
        self.session.flush()
        return member

    def reactivate_member(self, member: ChatMember) -> bool:
        """Clear the archive marker of an EXISTING membership row:
        left_at -> NULL on the SAME row (joined_at kept — the fresh-row
        semantics of a post-kick re-add never apply here). True when the
        row was archived and this call reactivated it, False when it was
        already active (the idempotent no-write); the commit stays with
        the caller's transaction."""
        if member.left_at is None:
            return False
        member.left_at = None
        self.session.flush()
        return True

    def remove_member(self, chat_id: int, user_id: int) -> bool:
        """Hard-deletes the membership row (owner kick — opposed to the
        soft left_at archive of a self-leave): the user loses the chat
        entirely and a later re-add starts a FRESH row. False when no row
        exists (member_not_found at the service)."""

        member = self.get_member(chat_id, user_id)
        if member is None:
            return False
        self.session.delete(member)
        self.session.flush()
        return True

    def unread_counts(self, user_id: int) -> dict[int, int]:
        """Чужие сообщения новее последнего прочитанного маркера по каждому чату
        пользователя; своих сообщений не считаем. Один запрос: memberships
        дают все чаты, маркер приезжает LEFT JOIN-ом, отсечение чужих новее
        маркера — агрегатный COUNT FILTER (было 3 запроса + COUNT на каждый
        чат с маркером)."""
        statement = (
            select(
                ChatMember.chat_id,
                func.count(Message.id).filter(
                    Message.user_id != user_id,
                    Message.id > func.coalesce(ChatLastRead.last_read_message_id, 0),
                ),
            )
            .where(ChatMember.user_id == user_id)
            .outerjoin(
                ChatLastRead,
                and_(
                    ChatLastRead.user_id == user_id,
                    ChatLastRead.chat_id == ChatMember.chat_id,
                ),
            )
            .outerjoin(Message, Message.chat_id == ChatMember.chat_id)
            .group_by(ChatMember.chat_id)
        )
        return {chat_id: int(count) for chat_id, count in self.session.execute(statement).all()}

    def mark_read(self, chat_id: int, user_id: int, message_id: int) -> None:
        """Upsert маркера чтения одним атомарным INSERT ... ON CONFLICT:
        двигаем только вперёд (старые страницы истории не «прочитывают»
        новее уже увиденного); гонка двух конкурентных отметок гасится на
        стороне БД, а не IntegrityError. Диалект — по bind-у сессии
        (юниты — SQLite, прод — PostgreSQL), как в stories add_view."""

        insert = pg_insert if self.session.get_bind().dialect.name == 'postgresql' else sqlite_insert
        statement = (
            insert(ChatLastRead)
            .values(user_id=user_id, chat_id=chat_id, last_read_message_id=message_id)
            .on_conflict_do_update(
                index_elements=['user_id', 'chat_id'],
                set_={'last_read_message_id': message_id},
                where=ChatLastRead.last_read_message_id < message_id,
            )
        )
        self.session.execute(statement)
        self.session.commit()

    def mark_all_read(self, user_id: int) -> int:
        """Bulk-двойник mark_read для «Пометить всё прочитанными»: один
        диалектный INSERT..SELECT ставит маркер каждого чата пользователя
        (ЛЮБОГО членства — активного и архивного, ровно как их считает
        unread_counts) на новейшее сообщение чата; ON CONFLICT двигает
        только вперёд (excluded-неймспейс — единственный способ адресовать
        строку-источник INSERT..SELECT в DO UPDATE). Чаты без сообщений
        строки не дают (нечего читать). Возвращает число чатов, покрытых
        SELECT-ом (посчитано отдельно: RETURNING конфликтных UPDATE в
        SQLite ненадёжен)."""

        insert = pg_insert if self.session.get_bind().dialect.name == 'postgresql' else sqlite_insert
        newest = (
            select(Message.chat_id, func.max(Message.id).label('last_id'))
            .join(ChatMember, ChatMember.chat_id == Message.chat_id)
            .where(ChatMember.user_id == user_id)
            .group_by(Message.chat_id)
            .subquery()
        )
        covered = self.session.scalars(select(newest.c.chat_id)).all()
        if not covered:
            return 0
        statement = insert(ChatLastRead).from_select(
            ['user_id', 'chat_id', 'last_read_message_id'],
            select(
                func.cast(user_id, Integer).label('user_id'),
                newest.c.chat_id.label('chat_id'),
                newest.c.last_id.label('last_read_message_id'),
            ).where(
                # SQLite-парсер путает ON CONFLICT с join-ограничением SELECT-а
                # без WHERE — литеральный true развязывает синтаксис (док SQLite
                # про upsert); PostgreSQL'у условие безразлично
                literal(True)
            ),
        )
        statement = statement.on_conflict_do_update(
            index_elements=['user_id', 'chat_id'],
            set_={'last_read_message_id': statement.excluded.last_read_message_id},
            where=ChatLastRead.last_read_message_id < statement.excluded.last_read_message_id,
        )
        self.session.execute(statement)
        self.session.commit()
        return len(set(covered))

    def list_members(self, chat_id: int) -> list[tuple[int, str, int | None, str | None, datetime | None]]:
        """Участники чата как (user_id, email-хэнл, avatar_file_id,
        display_name, left_at) — для UI-списка, меток «уже добавлен» в
        поиске и аватаров участников; left_at — архивное членство
        (покинул чат, строка не удалялась), display_name идёт в fallback
        to_member_brief."""
        rows = (
            self.session.query(
                ChatMember.user_id, User.email, User.avatar_file_id, User.display_name, ChatMember.left_at
            )
            .join(User, User.id == ChatMember.user_id)
            .filter(ChatMember.chat_id == chat_id)
            .order_by(ChatMember.user_id)
            .all()
        )
        return [
            (row.user_id, row.email, row.avatar_file_id, row.display_name, row.left_at)
            for row in rows
        ]

    def list_members_for_chats(self, chat_ids: list[int]) -> list[tuple[int, int, str, int | None, str | None]]:
        """Участники многих чатов одним IN-запросом как (chat_id, user_id,
        email-хэнл, avatar_file_id, display_name) — для пакетного состава в
        GET /chats; порядок детерминирован (чат, порядок вступления,
        user_id)."""
        if not chat_ids:
            return []
        rows = (
            self.session.query(
                ChatMember.chat_id, ChatMember.user_id, User.email, User.avatar_file_id, User.display_name
            )
            .join(User, User.id == ChatMember.user_id)
            .filter(ChatMember.chat_id.in_(chat_ids))
            .order_by(ChatMember.chat_id, ChatMember.joined_at, ChatMember.user_id)
            .all()
        )
        return [(row.chat_id, row.user_id, row.email, row.avatar_file_id, row.display_name) for row in rows]

    def last_messages_for_chats(self, chat_ids: list[int]) -> list[tuple[int, str | None, datetime]]:
        """Новейшее сообщение каждого чата из списка одним SELECT: окно
        row_number() по (created_at DESC, id DESC) — тай-брейк по id
        держит результат детерминированным при равных created_at; окно
        поддерживается и SQLite (тесты), и PostgreSQL (прод), под ним
        индекс ix_messages_chat_created_id. Возвращает (chat_id, content,
        created_at); чаты без сообщений в результате отсутствуют."""
        if not chat_ids:
            return []
        newest = (
            select(
                Message.chat_id,
                Message.content,
                Message.created_at,
                func.row_number()
                .over(
                    partition_by=Message.chat_id,
                    order_by=(Message.created_at.desc(), Message.id.desc()),
                )
                .label('rank'),
            )
            .where(Message.chat_id.in_(chat_ids))
            .subquery()
        )
        statement = select(
            newest.c.chat_id, newest.c.content, newest.c.created_at
        ).where(newest.c.rank == 1)
        return [
            (chat_id, content, created_at)
            for chat_id, content, created_at in self.session.execute(statement).all()
        ]

    def search_title_matches(self, user_id: int, q: str) -> list[tuple[int, str]]:
        """Чаты пользователя (скоуп по участию), в чьём title есть
        case-insensitive подстрока q: lower()+LIKE (на PostgreSQL сворачивает
        весь Unicode; SQLite в тестах — только ASCII) с экранированием
        %/_/\\ по правилу users.py. Возвращает (chat_id, title); итоговый
        порядок собирает сервис."""
        pattern = f'%{escape_like(q).lower()}%'
        statement = (
            select(Chat.id, Chat.title)
            .join(ChatMember, ChatMember.chat_id == Chat.id)
            .where(
                ChatMember.user_id == user_id,
                func.lower(Chat.title).like(pattern, escape='\\'),
            )
        )
        return [(chat_id, title) for chat_id, title in self.session.execute(statement).all()]

    def search_member_matches(self, user_id: int, term: str) -> list[tuple[int, str]]:
        """'@'-режим поиска: чаты пользователя (ЛЮБОЕ членство — скоуп как в
        search_title_matches), где ДРУГОЙ участник (user_id != запрашивающего)
        совпадает с term case-insensitive ПРЕФИКСОМ по login (полный email,
        нижний регистр хранится) ИЛИ display_name (coalesce на пустую строку;
        префикс по локальной части email покрывается display_name-веткой).
        LIKE с экранированием по правилу escape_like. На чат берётся
        детерминированно ПЕРВЫЙ совпавший участник (min user_id) — питоновская
        редукция вместо коррелированного подзапроса (масштаб учебный, число
        совпадений мало). Возвращает (chat_id, matched_name)."""
        prefix = f'{escape_like(term).lower()}%'
        statement = (
            select(
                ChatMember.chat_id,
                User.id,
                func.coalesce(User.display_name, User.email),
            )
            .join(ChatMember, ChatMember.user_id == User.id)
            .where(
                ChatMember.chat_id.in_(
                    select(ChatMember.chat_id).where(ChatMember.user_id == user_id)
                ),
                ChatMember.user_id != user_id,
                or_(
                    func.lower(User.email).like(prefix, escape='\\'),
                    func.lower(func.coalesce(User.display_name, '')).like(prefix, escape='\\'),
                ),
            )
        )
        first: dict[int, tuple[int, str]] = {}
        for chat_id, member_id, name in self.session.execute(statement).all():
            current = first.get(chat_id)
            if current is None or member_id < current[0]:
                first[chat_id] = (member_id, name)
        return [(chat_id, name) for chat_id, (_member_id, name) in sorted(first.items())]

    def chat_created_ats(self, chat_ids: list[int]) -> dict[int, datetime]:
        """created_at чатов одним IN-запросом — опора fallback-активности
        '@'-порядка (чатам без сообщений нечего терять кроме даты создания)."""
        if not chat_ids:
            return {}
        rows = self.session.execute(
            select(Chat.id, Chat.created_at).where(Chat.id.in_(chat_ids))
        ).all()
        return dict(rows)

    def search_message_matches(self, user_id: int, q: str) -> list[tuple[int, str, datetime]]:
        """Свежайшее совпадающее сообщение каждого чата пользователя одним
        SELECT: участие задаёт скоуп, content IS NOT NULL (файловые
        вложения не ищутся), lower()+LIKE с экранированием как в
        search_title_matches; окно row_number() по (created_at DESC,
        id DESC) даёт свежайшее с тем же тай-брейком, что и
        last_messages_for_chats. Возвращает (chat_id, content, created_at)."""
        pattern = f'%{escape_like(q).lower()}%'
        matching = (
            select(
                Message.chat_id,
                Message.content,
                Message.created_at,
                func.row_number()
                .over(
                    partition_by=Message.chat_id,
                    order_by=(Message.created_at.desc(), Message.id.desc()),
                )
                .label('rank'),
            )
            .join(ChatMember, ChatMember.chat_id == Message.chat_id)
            .where(
                ChatMember.user_id == user_id,
                Message.content.is_not(None),
                func.lower(Message.content).like(pattern, escape='\\'),
            )
            .subquery()
        )
        statement = select(
            matching.c.chat_id, matching.c.content, matching.c.created_at
        ).where(matching.c.rank == 1)
        return [
            (chat_id, content, created_at)
            for chat_id, content, created_at in self.session.execute(statement).all()
        ]
