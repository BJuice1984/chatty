"""User search contracts: логин-хэнл и выводимое имя из email."""

from __future__ import annotations

from pydantic import BaseModel

from app.models.user import User


class UserSearchItem(BaseModel):
    id: int
    login: str
    display_name: str

    @classmethod
    def from_user(cls, user: User) -> 'UserSearchItem':
        """Хэнл — полный email в нижнем регистре; display_name — local-part с fallback на полный email.

        У модели User нет ни одного из этих полей, поэтому выводимое имя
        выводится здесь, на границе контракта, — обе фазы строятся на этой форме.
        """

        login = user.email.lower()
        local_part = login.split('@', 1)[0]
        return cls(id=user.id, login=login, display_name=local_part or login)
