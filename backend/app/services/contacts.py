"""Contact book lifecycle: guards and response assembly."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.repositories.contacts import ContactRepository
from app.repositories.users import UserRepository
from app.schemas.contact import ContactResponse


class ContactService:
    def __init__(self, session: Session):
        self.session = session
        self.contacts = ContactRepository(session)
        self.users = UserRepository(session)

    def list_for_owner(self, owner_id: int) -> list[ContactResponse]:
        """The caller's contacts in the contract order (created_at DESC,
        contact_user_id DESC — set in the repository), shaped here from the
        joined user fields."""
        return [ContactResponse.from_parts(*row) for row in self.contacts.list_for_owner(owner_id)]

    def add(self, owner_id: int, user_id: int) -> ContactResponse:
        """Idempotent add: 201-equivalent for both the fresh insert and the
        existing row (the add_member precedent). Guards: self-add is
        forbidden, an unknown user is a 404."""
        if user_id == owner_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='contact_self_forbidden')
        user = self.users.get_by_id(user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='user_not_found')
        contact = self.contacts.upsert(owner_id, user_id)
        self.session.commit()
        self.session.refresh(contact)
        return ContactResponse.from_parts(user.id, user.email, user.avatar_file_id, contact.created_at)

    def remove(self, owner_id: int, user_id: int) -> None:
        """Delete the caller's row for the user; an absent row is a 404."""
        if not self.contacts.remove(owner_id, user_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='contact_not_found')
        self.session.commit()
