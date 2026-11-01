"""Contact book queries."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models.contact import Contact
from app.models.user import User


class ContactRepository:
    def __init__(self, session: Session):
        self.session = session

    def get(self, owner_id: int, contact_user_id: int) -> Contact | None:
        return self.session.get(Contact, (owner_id, contact_user_id))

    def upsert(self, owner_id: int, contact_user_id: int) -> Contact:
        """Get-then-insert idempotent upsert (the add_member idiom): the
        composite PK (owner_id, contact_user_id) makes a re-add hit the
        existing row, never a duplicate; commit stays with the caller."""
        existing = self.get(owner_id, contact_user_id)
        if existing is not None:
            return existing
        contact = Contact(owner_id=owner_id, contact_user_id=contact_user_id)
        self.session.add(contact)
        self.session.flush()
        return contact

    def remove(self, owner_id: int, contact_user_id: int) -> bool:
        """Delete the row when present; False means nothing was removed."""
        contact = self.get(owner_id, contact_user_id)
        if contact is None:
            return False
        self.session.delete(contact)
        self.session.flush()
        return True

    def list_for_owner(self, owner_id: int) -> list[tuple[int, str, int | None, datetime, str | None]]:
        """Owner's contacts as (contact_user_id, email handle, avatar_file_id,
        created_at, display_name) — the user fields come from a JOIN
        (display_name feeds the ContactResponse fallback), ordering is the
        contract's created_at DESC, contact_user_id DESC."""
        rows = (
            self.session.query(
                Contact.contact_user_id, User.email, User.avatar_file_id, Contact.created_at, User.display_name
            )
            .join(User, User.id == Contact.contact_user_id)
            .filter(Contact.owner_id == owner_id)
            .order_by(Contact.created_at.desc(), Contact.contact_user_id.desc())
            .all()
        )
        return [
            (row.contact_user_id, row.email, row.avatar_file_id, row.created_at, row.display_name)
            for row in rows
        ]
