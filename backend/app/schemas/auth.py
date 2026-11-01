"""Public authentication request and response contracts."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=256)

    @field_validator('email')
    @classmethod
    def normalise_email(cls, value: str) -> str:
        normalised = value.strip().lower()
        if '@' not in normalised or normalised.startswith('@') or normalised.endswith('@'):
            raise ValueError('email must be valid')
        return normalised


class RegisterRequest(Credentials):
    pass


class LoginRequest(Credentials):
    pass


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    role: str
    is_active: bool
    created_at: datetime
    # populated from the User.avatar_url property (None when not uploaded)
    avatar_url: str | None = None
    # settings-wave profile fields (additive): display_name NULL falls back
    # to the email local part at the UI-facing name builders, never here;
    # the additive None/None/True defaults keep model_validate paths that
    # build the shape from partial objects alive
    display_name: str | None = None
    phone: str | None = None
    send_read_receipts: bool = True


class ProfileUpdate(BaseModel):
    """Partial profile payload: only the CARRIED fields are applied by the
    service (an absent field never wipes its column); validation lives here
    — display_name is trimmed to 0..120 (an empty trim clears the column to
    NULL at the service), phone is trimmed to NULL (empty) or 3..30."""

    display_name: str | None = None
    phone: str | None = None
    send_read_receipts: bool | None = None

    @field_validator('display_name')
    @classmethod
    def trim_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        if len(trimmed) > 120:
            raise ValueError('display_name must be at most 120 characters')
        return trimmed

    @field_validator('phone')
    @classmethod
    def trim_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        if trimmed and not 3 <= len(trimmed) <= 30:
            raise ValueError('phone must be 3 to 30 characters or empty')
        return trimmed


class PasswordChange(BaseModel):
    old_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=12, max_length=256)


class MessageResponse(BaseModel):
    message: str
