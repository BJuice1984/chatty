"""Cookie-based authentication endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.deps import get_current_user, get_db, get_settings, require_csrf, validate_origin
from app.core.security import clear_auth_cookies, set_auth_cookies
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    MessageResponse,
    PasswordChange,
    ProfileUpdate,
    RegisterRequest,
    UserResponse,
)
from app.services.auth import (
    authenticate_user,
    change_password,
    issue_tokens,
    logout_everywhere,
    register_user,
    revoke_refresh_tokens,
    rotate_refresh_token,
    update_profile,
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


@router.post('/logout-all', response_model=MessageResponse)
async def logout_all(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MessageResponse:
    """Log out EVERY device: the token_version bump retires all previously
    issued tokens (access ones die at the get_current_user comparison,
    refresh ones at rotation), the current cookies are cleared on top. The
    literal 'logout-all' cannot collide with '/logout' — no parameterized
    route lives in this router."""
    require_csrf(request, settings)
    logout_everywhere(db, current_user)
    clear_auth_cookies(response, settings)
    return MessageResponse(message='logged_out_everywhere')


@router.put('/profile', response_model=UserResponse)
async def set_profile(
    payload: ProfileUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    """Edit the caller's profile (display_name/phone/send_read_receipts):
    only the carried fields are applied, email/login stay immutable (email
    IS the login — a separate security-heavy feature)."""
    require_csrf(request, settings)
    return update_profile(db, current_user, payload)


@router.put('/password', response_model=UserResponse)
async def set_password(
    payload: PasswordChange,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    """Change the password: the wrong old one is a 401; on success every
    refresh token dies with the token_version bump and the SAME response
    reissues fresh cookies for the current session (other devices log
    out, this one stays signed in)."""
    require_csrf(request, settings)
    user = change_password(db, current_user, payload)
    _set_session(response, user, settings)
    return user


@router.get('/me', response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user
