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
    submitted = request.headers.get(settings.csrf_header_name)
    cookie_values = _csrf_cookie_values(request.headers.getlist('cookie'), settings.csrf_cookie_name)
    if not submitted or not any(secrets_equal(value, submitted) for value in cookie_values):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='csrf_failed')


def _csrf_cookie_values(cookie_headers: list[str], name: str) -> list[str]:
    """Every value of the named cookie across the Cookie headers: a browser
    may legitimately carry duplicates (a stale path-scoped copy shadowing the
    fresh one — Request.cookies sees only the first header, and within one
    header the last duplicate wins), so double-submit must match the header
    against any copy the site issued, not just the first one."""
    values: list[str] = []
    for header in cookie_headers:
        for entry in header.split(';'):
            separator = entry.find('=')
            if separator == -1:
                continue
            if entry[:separator].strip() == name:
                values.append(entry[separator + 1:].strip())
    return values


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
        token_version = int(payload['ver'])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid_subject') from exc
    user = UserRepository(db).get_by_id(user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='user_unavailable')
    # create_token embeds the user's token_version as `ver`; a bump
    # (password change, logout-everywhere, refresh rotation) retires every
    # previously issued access token here — the same comparison
    # rotate_refresh_token applies on the refresh side
    if user.token_version != token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='token_version_stale')
    return user


def require_roles(*roles: str) -> Callable[..., User]:
    async def dependency(current_user: Annotated[User, Depends(get_current_user)]) -> User:
        if current_user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='insufficient_role')
        return current_user

    return dependency
