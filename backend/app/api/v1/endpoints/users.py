"""User lookup for @-login invitations."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.repositories.users import UserRepository
from app.schemas.user import UserSearchItem


router = APIRouter(tags=['users'])

# верхняя граница выдачи поиска; остальное пользователь уточняет префиксом
MAX_SEARCH_RESULTS = 10


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
            'import app.main, not app.api.v1.router: the users domain '
            'registers itself while the endpoints package initializes'
        ) from exc
    register_domain_router(router)


@router.get('/users', response_model=list[UserSearchItem])
async def search_users(
    login: str = Query(min_length=1, max_length=320),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[UserSearchItem]:
    users = UserRepository(db).search_by_login_prefix(
        login,
        limit=MAX_SEARCH_RESULTS,
        exclude_user_id=current_user.id,
    )
    return [UserSearchItem.from_user(user) for user in users]
