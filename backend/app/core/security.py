"""Cookie JWT and password primitives used by the authentication service."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import HTTPException, Response, status
from jwt import InvalidTokenError
from pwdlib import PasswordHash

from app.core.config import Settings


password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    return password_hash.verify(password, encoded)


def create_token(
    *,
    subject: int,
    role: str,
    token_type: str,
    token_version: int,
    settings: Settings,
) -> str:
    now = datetime.now(UTC)
    lifetime = (
        timedelta(minutes=settings.access_token_minutes)
        if token_type == 'access'
        else timedelta(days=settings.refresh_token_days)
    )
    payload: dict[str, Any] = {
        'sub': str(subject),
        'role': role,
        'type': token_type,
        'ver': token_version,
        'jti': secrets.token_urlsafe(24),
        'iat': now,
        'exp': now + lifetime,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str, settings: Settings, expected_type: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='invalid_token',
            headers={'WWW-Authenticate': 'Bearer'},
        ) from exc
    if payload.get('type') != expected_type or not payload.get('sub'):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='invalid_token_type',
            headers={'WWW-Authenticate': 'Bearer'},
        )
    return payload


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def set_auth_cookies(
    response: Response,
    *,
    access_token: str,
    refresh_token: str,
    csrf_token: str,
    settings: Settings,
) -> None:
    common = {
        'secure': settings.cookie_secure,
        'httponly': True,
        'samesite': 'lax',
        'domain': settings.cookie_domain,
    }
    response.set_cookie(settings.access_cookie_name, access_token, max_age=settings.access_token_minutes * 60, **common)
    response.set_cookie(
        settings.refresh_cookie_name,
        refresh_token,
        max_age=settings.refresh_token_days * 24 * 60 * 60,
        path=f'{settings.api_prefix}/auth',
        **common,
    )
    response.set_cookie(
        settings.csrf_cookie_name,
        csrf_token,
        max_age=settings.refresh_token_days * 24 * 60 * 60,
        secure=settings.cookie_secure,
        httponly=False,
        samesite='lax',
        domain=settings.cookie_domain,
    )


def clear_auth_cookies(response: Response, settings: Settings) -> None:
    response.delete_cookie(settings.access_cookie_name, domain=settings.cookie_domain)
    response.delete_cookie(
        settings.refresh_cookie_name,
        domain=settings.cookie_domain,
        path=f'{settings.api_prefix}/auth',
    )
    response.delete_cookie(settings.csrf_cookie_name, domain=settings.cookie_domain)
