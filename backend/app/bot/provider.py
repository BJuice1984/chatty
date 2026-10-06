"""Local-only chat provider seam.

The configured provider is a native Ollama endpoint; there is no cloud
fallback at any layer. Transport, HTTP, timeout and malformed-payload
failures raise an explicit ``BotProviderError`` with a machine-readable kind
which the service records on the run — never a silent PASS.
"""

from __future__ import annotations

from typing import Protocol

import httpx

from app.bot.config import BotSettings


class BotProviderError(Exception):
    """Explicit provider failure with a machine-readable kind."""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


class BotProvider(Protocol):
    def complete(self, messages: list[dict[str, str]]) -> str:
        """Return the assistant answer for an OpenAI-style message list."""


class OllamaBotProvider:
    """Synchronous Ollama ``/api/chat`` client used behind an async boundary."""

    def __init__(self, *, url: str, model: str, timeout_seconds: float = 60.0, transport: httpx.BaseTransport | None = None):
        self.url = url
        self.model = model
        self.timeout_seconds = timeout_seconds
        self._transport = transport

    def complete(self, messages: list[dict[str, str]]) -> str:
        try:
            with httpx.Client(timeout=self.timeout_seconds, transport=self._transport) as client:
                response = client.post(
                    f'{self.url}/api/chat',
                    json={'model': self.model, 'messages': messages, 'stream': False},
                )
        except httpx.TimeoutException as exc:
            raise BotProviderError('provider_timeout', f'provider timed out after {self.timeout_seconds}s') from exc
        except httpx.HTTPError as exc:
            raise BotProviderError('provider_unreachable', f'provider endpoint unreachable: {exc}') from exc
        if response.status_code != 200:
            raise BotProviderError('provider_failed', f'provider endpoint returned {response.status_code}')
        try:
            payload = response.json()
        except ValueError as exc:
            raise BotProviderError('provider_malformed', 'provider returned a malformed payload') from exc
        if not isinstance(payload, dict):
            raise BotProviderError('provider_malformed', 'provider returned a malformed payload')
        message = payload.get('message')
        if not isinstance(message, dict):
            raise BotProviderError('provider_malformed', 'provider returned a malformed payload')
        content = message.get('content')
        if not isinstance(content, str) or not content.strip():
            raise BotProviderError('provider_malformed', 'provider returned an empty answer')
        return content


def default_provider(bot: BotSettings) -> OllamaBotProvider:
    return OllamaBotProvider(url=bot.provider_url, model=bot.model, timeout_seconds=bot.timeout_seconds)


def get_bot_provider(state: object, bot: BotSettings) -> BotProvider:
    """Prefer an injected provider (tests) over the configured endpoint."""
    existing = getattr(state, 'bot_provider', None)
    if existing is not None:
        return existing
    return default_provider(bot)
