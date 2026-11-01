"""Contact book endpoints: list, add and remove the caller's contacts."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.contact import ContactCreate, ContactResponse
from app.services.contacts import ContactService


router = APIRouter(prefix='/contacts', tags=['contacts'])


def register_domain() -> None:
    """Mount this router through the stage-5 composition seam.

    Called at the end of ``app.api.v1.endpoints`` package init. The import is
    local because ``router.py`` imports that package while it is still
    initializing; every entry point in the repository reaches the router
    through ``app.main``, which imports ``endpoints.health`` first.
    """
    try:
        from app.api.v1.router import register_domain_router
    except ImportError as exc:
        raise ImportError(
            'import app.main, not app.api.v1.router: the contacts domain '
            'registers itself while the endpoints package initializes'
        ) from exc
    register_domain_router(router)


@router.get('', response_model=list[ContactResponse])
async def list_contacts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ContactResponse]:
    return ContactService(db).list_for_owner(current_user.id)


@router.post('', response_model=ContactResponse, status_code=status.HTTP_201_CREATED)
async def add_contact(
    payload: ContactCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContactResponse:
    # 201 for the fresh row AND for the existing one — idempotent add (the
    # add_member precedent)
    return ContactService(db).add(current_user.id, payload.user_id)


@router.delete('/{user_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    ContactService(db).remove(current_user.id, user_id)
