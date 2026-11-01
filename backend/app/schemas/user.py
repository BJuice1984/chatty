"""User search contracts: login handle and display name."""

from __future__ import annotations

from pydantic import BaseModel

from app.models.user import User


class UserSearchItem(BaseModel):
    id: int
    login: str
    display_name: str

    @classmethod
    def from_user(cls, user: User) -> 'UserSearchItem':
        """Login is the full lower-cased email; display_name prefers the
        user's editable column and falls back to the email local part (the
        full email when the local part is empty) — the same fallback rule
        ContactResponse and to_member_brief apply, so every name surface
        agrees."""

        login = user.email.lower()
        local_part = login.split('@', 1)[0]
        return cls(id=user.id, login=login, display_name=user.display_name or local_part or login)
