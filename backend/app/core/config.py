"""Environment-backed application settings."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration; secrets are intentionally never given defaults."""

    model_config = SettingsConfigDict(
        env_file='.env',
        env_prefix='CHATTY_',
        extra='ignore',
        case_sensitive=False,
    )

    app_name: str = 'Chatty internal API'
    environment: Literal['development', 'test', 'production'] = 'development'
    api_prefix: str = '/api/v1'
    database_url: str = 'sqlite:///./chatty.db'
    jwt_secret: str = ''
    jwt_algorithm: str = 'HS256'
    access_token_minutes: int = Field(default=15, ge=1, le=60)
    refresh_token_days: int = Field(default=7, ge=1, le=90)
    allowed_origins: list[str] = Field(default_factory=lambda: ['http://localhost:3000'])
    cookie_secure: bool = False
    cookie_domain: str | None = None
    access_cookie_name: str = 'chatty_access'
    refresh_cookie_name: str = 'chatty_refresh'
    csrf_cookie_name: str = 'chatty_csrf'
    csrf_header_name: str = 'X-CSRF-Token'
    max_upload_bytes: int = Field(default=10 * 1024 * 1024, ge=1, le=1024 * 1024 * 1024)
    seed_admin_email: str | None = None
    seed_admin_password: str | None = None

    @field_validator('allowed_origins', mode='before')
    @classmethod
    def parse_allowed_origins(cls, value: object) -> object:
        if value is None or value == '':
            return []
        if isinstance(value, str):
            try:
                decoded = json.loads(value)
            except json.JSONDecodeError:
                return [item.strip() for item in value.split(',') if item.strip()]
            if isinstance(decoded, list):
                return decoded
            return [value]
        return value

    def require_runtime_security(self) -> None:
        """Reject missing/weak secrets before a non-test server starts."""

        if self.environment != 'test' and len(self.jwt_secret) < 32:
            raise RuntimeError('CHATTY_JWT_SECRET must contain at least 32 characters')
        if self.environment == 'production' and not self.cookie_secure:
            raise RuntimeError('CHATTY_COOKIE_SECURE must be true in production')


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
