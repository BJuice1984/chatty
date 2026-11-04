"""Local-only chat provider seam.

The configured provider speaks either the native Ollama protocol or the
OpenAI-compatible chat protocol (`CHATTY_BOT_PROVIDER_API`); there is no
cloud fallback at any layer. Transport, HTTP, timeout and malformed-payload
failures raise an explicit ``BotProviderError`` with a machine-readable kind
which the service records on the run — never a silent PASS.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
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

    def complete_stream(self, messages: list[dict[str, str]]) -> Iterator[str]:
        """Yield the answer incrementally as text deltas.

        The default is the degenerate single-chunk stream (the whole answer
        at once) so fake providers that SUBCLASS the protocol stream for
        free; structural implementations do NOT inherit Protocol defaults —
        every real provider defines ``complete_stream`` explicitly (N-1).
        """
        yield self.complete(messages)


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

    def complete_stream(self, messages: list[dict[str, str]]) -> Iterator[str]:
        """Explicit single-chunk stream: the native seam stays whole-answer.

        Structural implementers do not inherit Protocol defaults, so the
        one-chunk behaviour is spelled out here instead of relying on the
        ``BotProvider`` default (review N-1).
        """
        yield self.complete(messages)


class OpenAIChatProvider:
    """Synchronous OpenAI-compatible ``/v1/chat/completions`` client."""

    def __init__(
        self,
        *,
        url: str,
        model: str,
        timeout_seconds: float = 60.0,
        transport: httpx.BaseTransport | None = None,
        enable_thinking: bool = True,
    ):
        self.url = url
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.enable_thinking = enable_thinking
        self._transport = transport

    def _request_body(self, messages: list[dict[str, str]], *, stream: bool) -> dict[str, object]:
        body: dict[str, object] = {'model': self.model, 'messages': messages, 'stream': stream}
        if not self.enable_thinking:
            # llama-server knob: a thinking model (Qwen3.5) skips its long
            # reasoning phase and the first token arrives fast
            body['chat_template_kwargs'] = {'enable_thinking': False}
        return body

    def complete(self, messages: list[dict[str, str]]) -> str:
        try:
            with httpx.Client(timeout=self.timeout_seconds, transport=self._transport) as client:
                response = client.post(
                    f'{self.url}/v1/chat/completions',
                    json=self._request_body(messages, stream=False),
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
        choices = payload.get('choices')
        if not isinstance(choices, list) or not choices:
            raise BotProviderError('provider_malformed', 'provider returned a malformed payload')
        message = choices[0].get('message') if isinstance(choices[0], dict) else None
        if not isinstance(message, dict):
            raise BotProviderError('provider_malformed', 'provider returned a malformed payload')
        content = message.get('content')
        if not isinstance(content, str) or not content.strip():
            raise BotProviderError('provider_malformed', 'provider returned an empty answer')
        return content

    def complete_stream(self, messages: list[dict[str, str]]) -> Iterator[str]:
        """Stream SSE ``data:`` chunks, yielding ONLY content deltas.

        ``reasoning_content`` (thinking models) is ignored; the httpx read
        timeout applies PER CHUNK — a stalled stream fails fast instead of
        burning the whole-answer budget.
        """
        parts: list[str] = []
        try:
            with httpx.Client(timeout=self.timeout_seconds, transport=self._transport) as client:
                with client.stream(
                    'POST',
                    f'{self.url}/v1/chat/completions',
                    json=self._request_body(messages, stream=True),
                ) as response:
                    if response.status_code != 200:
                        raise BotProviderError('provider_failed', f'provider endpoint returned {response.status_code}')
                    for line in response.iter_lines():
                        delta = _sse_content_delta(line)
                        if delta is None:
                            continue
                        parts.append(delta)
                        yield delta
        except httpx.TimeoutException as exc:
            raise BotProviderError('provider_timeout', f'provider timed out after {self.timeout_seconds}s') from exc
        except httpx.HTTPError as exc:
            raise BotProviderError('provider_unreachable', f'provider endpoint unreachable: {exc}') from exc
        if not ''.join(parts).strip():
            raise BotProviderError('provider_malformed', 'provider returned an empty answer')


def _sse_content_delta(line: str) -> str | None:
    """Content delta carried by ONE SSE line, or None for everything else.

    Only ``data:`` lines are payloads; ``[DONE]``, control lines (``event:``,
    ``id:``, comments) and non-content deltas (role-only, finish markers,
    ``reasoning_content`` thinking, empty-choices usage chunks) yield
    nothing. A ``data:`` payload that is not a JSON object of the expected
    shape is an explicit ``provider_malformed`` — never a silent skip.
    """
    text = line.strip()
    if not text.startswith('data:'):
        return None
    payload = text[len('data:'):].strip()
    if not payload or payload == '[DONE]':
        return None
    try:
        chunk = json.loads(payload)
    except ValueError:
        raise BotProviderError('provider_malformed', 'provider returned a malformed payload') from None
    if not isinstance(chunk, dict):
        raise BotProviderError('provider_malformed', 'provider returned a malformed payload')
    choices = chunk.get('choices')
    if not isinstance(choices, list) or not choices:
        return None
    choice = choices[0]
    if not isinstance(choice, dict):
        raise BotProviderError('provider_malformed', 'provider returned a malformed payload')
    delta = choice.get('delta')
    if delta is None:
        return None
    if not isinstance(delta, dict):
        raise BotProviderError('provider_malformed', 'provider returned a malformed payload')
    content = delta.get('content')
    if not isinstance(content, str) or not content:
        return None
    return content


def default_provider(bot: BotSettings) -> OllamaBotProvider | OpenAIChatProvider:
    if bot.provider_api == 'openai':
        return OpenAIChatProvider(
            url=bot.provider_url,
            model=bot.model,
            timeout_seconds=bot.timeout_seconds,
            enable_thinking=bot.enable_thinking,
        )
    return OllamaBotProvider(url=bot.provider_url, model=bot.model, timeout_seconds=bot.timeout_seconds)


def get_bot_provider(state: object, bot: BotSettings) -> BotProvider:
    """Prefer an injected provider (tests) over the configured endpoint."""
    existing = getattr(state, 'bot_provider', None)
    if existing is not None:
        return existing
    return default_provider(bot)
