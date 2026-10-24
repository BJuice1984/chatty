"""Cookie-based authentication endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.deps import get_current_user, get_db, get_settings, require_csrf, validate_origin
from app.core.security import clear_auth_cookies, set_auth_cookies
from app.models.user import User
from app.schemas.auth import LoginRequest, MessageResponse, RegisterRequest, UserResponse
from app.services.auth import (
    authenticate_user,
    issue_tokens,
    register_user,
    revoke_refresh_tokens,
    rotate_refresh_token,
)


router = APIRouter(prefix='/auth', tags=['auth'])


def _set_session(response: Response, user: User, settings: Settings) -> None:
    tokens = issue_tokens(user, settings)
    set_auth_cookies(
        response,
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        csrf_token=tokens.csrf_token,
        settings=settings,
    )


@router.post('/register', response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    validate_origin(request, settings)
    user = register_user(db, payload)
    _set_session(response, user, settings)
    return user


@router.post('/login', response_model=UserResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    validate_origin(request, settings)
    user = authenticate_user(db, payload)
    _set_session(response, user, settings)
    return user


@router.post('/refresh', response_model=UserResponse)
async def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    require_csrf(request, settings)
    token = request.cookies.get(settings.refresh_cookie_name)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='refresh_required')
    user, tokens = rotate_refresh_token(db, token, settings)
    set_auth_cookies(
        response,
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        csrf_token=tokens.csrf_token,
        settings=settings,
    )
    return user


@router.post('/logout', response_model=MessageResponse)
async def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MessageResponse:
    require_csrf(request, settings)
    revoke_refresh_tokens(db, request.cookies.get(settings.refresh_cookie_name), settings)
    clear_auth_cookies(response, settings)
    return MessageResponse(message='logged_out')


@router.get('/me', response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user
