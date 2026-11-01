"""Authentication business operations."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import create_token, decode_token, hash_password, new_csrf_token, verify_password
from app.models.user import User
from app.repositories.users import UserRepository
from app.schemas.auth import LoginRequest, PasswordChange, ProfileUpdate, RegisterRequest


@dataclass(frozen=True)
class SessionTokens:
    access_token: str
    refresh_token: str
    csrf_token: str


def register_user(session: Session, payload: RegisterRequest) -> User:
    repository = UserRepository(session)
    if repository.get_by_email(payload.email) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='email_already_registered')
    user = User(email=payload.email, password_hash=hash_password(payload.password), role='user')
    repository.add(user)
    session.commit()
    session.refresh(user)
    return user


def authenticate_user(session: Session, payload: LoginRequest) -> User:
    user = UserRepository(session).get_by_email(payload.email)
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid_credentials')
    return user


def issue_tokens(user: User, settings: Settings) -> SessionTokens:
    return SessionTokens(
        access_token=create_token(
            subject=user.id,
            role=user.role,
            token_type='access',
            token_version=user.token_version,
            settings=settings,
        ),
        refresh_token=create_token(
            subject=user.id,
            role=user.role,
            token_type='refresh',
            token_version=user.token_version,
            settings=settings,
        ),
        csrf_token=new_csrf_token(),
    )


def rotate_refresh_token(session: Session, token: str, settings: Settings) -> tuple[User, SessionTokens]:
    payload = decode_token(token, settings, 'refresh')
    try:
        user_id = int(payload['sub'])
        token_version = int(payload['ver'])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid_refresh_token') from exc
    user = UserRepository(session).get_by_id(user_id)
    if user is None or not user.is_active or user.token_version != token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='refresh_token_rotated')
    user.token_version += 1
    session.commit()
    session.refresh(user)
    return user, issue_tokens(user, settings)


def revoke_refresh_tokens(session: Session, token: str | None, settings: Settings) -> None:
    if not token:
        return
    try:
        payload = decode_token(token, settings, 'refresh')
        user_id = int(payload['sub'])
    except (HTTPException, TypeError, ValueError):
        return
    user = UserRepository(session).get_by_id(user_id)
    if user is not None:
        user.token_version += 1
        session.commit()


def update_profile(session: Session, user: User, payload: ProfileUpdate) -> User:
    """Apply the profile fields the payload CARRIES: an absent field keeps
    its column (a Privacy-toggle request must not wipe the name), an empty
    trimmed string clears it to NULL (validation lives in the schema)."""
    if payload.display_name is not None:
        user.display_name = payload.display_name or None
    if payload.phone is not None:
        user.phone = payload.phone or None
    if payload.send_read_receipts is not None:
        user.send_read_receipts = payload.send_read_receipts
    session.commit()
    session.refresh(user)
    return user


def change_password(session: Session, user: User, payload: PasswordChange) -> User:
    """Verify the old password (401 invalid_credentials — the login
    message), rehash the new one and revoke EVERY refresh token via the
    token_version bump (rotate_refresh_token compares the claim). The
    endpoint reissues fresh cookies for the CURRENT session in the same
    response, so only the other devices log out."""
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid_credentials')
    user.password_hash = hash_password(payload.new_password)
    user.token_version += 1
    session.commit()
    session.refresh(user)
    return user


def logout_everywhere(session: Session, user: User) -> None:
    """Log the user out on every device: the token_version bump retires
    every previously issued token — refresh ones at rotation, access ones
    at the get_current_user version comparison (the endpoint clears the
    current cookies on top)."""
    user.token_version += 1
    session.commit()
