"""FastAPI dependencies for sessions, users, roles and CSRF checks."""

from __future__ import annotations

from collections.abc import AsyncGenerator, Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import decode_token
from app.models.user import User
from app.repositories.users import UserRepository


async def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_db(request: Request) -> AsyncGenerator[Session, None]:
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        yield session


def validate_origin(request: Request, settings: Settings) -> None:
    origin = request.headers.get('origin')
    if origin and origin not in settings.allowed_origins:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='origin_not_allowed')


def require_csrf(request: Request, settings: Settings) -> None:
    validate_origin(request, settings)
    expected = request.cookies.get(settings.csrf_cookie_name)
    actual = request.headers.get(settings.csrf_header_name)
    if not expected or not actual or not secrets_equal(expected, actual):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='csrf_failed')


def secrets_equal(left: str, right: str) -> bool:
    import hmac

    return hmac.compare_digest(left, right)


async def get_current_user(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    token = request.cookies.get(settings.access_cookie_name)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='authentication_required',
            headers={'WWW-Authenticate': 'Bearer'},
        )
    payload = decode_token(token, settings, 'access')
    try:
        user_id = int(payload['sub'])
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid_subject') from exc
    user = UserRepository(db).get_by_id(user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='user_unavailable')
    return user


def require_roles(*roles: str) -> Callable[..., User]:
    async def dependency(current_user: Annotated[User, Depends(get_current_user)]) -> User:
        if current_user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='insufficient_role')
        return current_user

    return dependency
