"""User repository kept below the service layer."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import User


class UserRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_by_id(self, user_id: int) -> User | None:
        return self.session.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        return self.session.scalar(select(User).where(User.email == email.lower()))

    def search_by_login_prefix(
        self,
        prefix: str,
        *,
        limit: int,
        exclude_user_id: int,
    ) -> list[User]:
        """Пользователи, чей логин-хэнл (полный email) начинается с префикса.

        Регистр не важен; ``%``/``_`` в префиксе экранируются, чтобы искаться
        буквально; собственная запись исключается; порядок детерминирован.
        """

        escaped = prefix.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        statement = (
            select(User)
            .where(
                User.email.like(f'{escaped.lower()}%', escape='\\'),
                User.id != exclude_user_id,
            )
            .order_by(User.email.asc(), User.id.asc())
            .limit(limit)
        )
        return list(self.session.scalars(statement))

    def add(self, user: User) -> User:
        self.session.add(user)
        self.session.flush()
        return user
