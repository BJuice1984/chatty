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


class MessageResponse(BaseModel):
    message: str
