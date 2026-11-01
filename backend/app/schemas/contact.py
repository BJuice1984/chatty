"""Contact book contracts: login and display name derived from email."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, PositiveInt

from app.schemas.file import avatar_url as file_avatar_url


class ContactCreate(BaseModel):
    user_id: PositiveInt


class ContactResponse(BaseModel):
    """One row of the caller's contact book; id is the CONTACT user's id."""

    id: int
    login: str
    display_name: str
    avatar_url: str | None = None
    created_at: datetime

    @classmethod
    def from_parts(
        cls,
        user_id: int,
        email: str,
        avatar_file_id: int | None,
        created_at: datetime,
    ) -> 'ContactResponse':
        """login is the lower-cased full email, display_name its local part —
        the UserSearchItem.from_user rule, so the contact list and the user
        search cannot drift apart; avatar mirrors to_member_brief."""
        login = email.lower()
        return cls(
            id=user_id,
            login=login,
            display_name=login.split('@', 1)[0] or login,
            avatar_url=file_avatar_url(avatar_file_id),
            created_at=created_at,
        )
