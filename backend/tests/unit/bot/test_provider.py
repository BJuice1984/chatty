"""Provider seam: payload parsing, explicit failures, injection."""

from __future__ import annotations

import json

import httpx
import pytest

from app.bot.config import BotSettings
from app.bot.provider import BotProviderError, OllamaBotProvider, default_provider, get_bot_provider


def bot() -> BotSettings:
    return BotSettings(
        provider_url='http://ollama.invalid',
        model='qwen3:14b',
        timeout_seconds=5.0,
        max_attempts=2,
        stale_after_seconds=180.0,
        user_email='bot@chatty.local',
        rag_top_k=3,
        max_answer_chars=4000,
    )


def provider(handler, *, timeout=5.0) -> OllamaBotProvider:
    return OllamaBotProvider(
        url='http://ollama.test',
        model='qwen3:14b',
        timeout_seconds=timeout,
        transport=httpx.MockTransport(handler),
    )


def test_complete_parses_successful_response():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        assert body['model'] == 'qwen3:14b'
        assert body['stream'] is False
        assert body['messages'][0]['role'] == 'user'
        return httpx.Response(200, json={'message': {'role': 'assistant', 'content': ' answer text '}})

    assert provider(handler).complete([{'role': 'user', 'content': 'question'}]) == ' answer text '


def test_http_error_is_explicit():
    failing = provider(lambda request: httpx.Response(500))

    with pytest.raises(BotProviderError) as exc_info:
        failing.complete([{'role': 'user', 'content': 'q'}])
    assert exc_info.value.kind == 'provider_failed'


def test_transport_error_is_explicit():
    def raise_connect_error(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError('connection refused')

    with pytest.raises(BotProviderError) as exc_info:
        provider(raise_connect_error).complete([{'role': 'user', 'content': 'q'}])
    assert exc_info.value.kind == 'provider_unreachable'


def test_timeout_is_explicit():
    def raise_timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout('timed out')

    with pytest.raises(BotProviderError) as exc_info:
        provider(raise_timeout).complete([{'role': 'user', 'content': 'q'}])
    assert exc_info.value.kind == 'provider_timeout'


@pytest.mark.parametrize(
    'payload',
    [
        [],
        {},
        {'message': None},
        {'message': 'assistant'},
        {'message': {'role': 'assistant'}},
        {'message': {'role': 'assistant', 'content': None}},
        {'message': {'role': 'assistant', 'content': 42}},
        {'message': {'role': 'assistant', 'content': '   '}},
    ],
)
def test_malformed_payloads_are_explicit(payload):
    with pytest.raises(BotProviderError) as exc_info:
        provider(lambda request: httpx.Response(200, json=payload)).complete(
            [{'role': 'user', 'content': 'q'}]
        )
    assert exc_info.value.kind == 'provider_malformed'


def test_non_json_body_is_explicit():
    with pytest.raises(BotProviderError) as exc_info:
        provider(lambda request: httpx.Response(200, text='<html>')).complete(
            [{'role': 'user', 'content': 'q'}]
        )
    assert exc_info.value.kind == 'provider_malformed'


def test_get_bot_provider_prefers_the_injected_instance():
    class FakeProvider:
        def complete(self, messages):
            return 'ok'

    fake = FakeProvider()
    state = type('State', (), {'bot_provider': fake})()

    assert get_bot_provider(state, bot()) is fake


def test_default_provider_targets_the_configured_url():
    result = default_provider(bot())

    assert isinstance(result, OllamaBotProvider)
    assert result.url == 'http://ollama.invalid'
    assert result.model == 'qwen3:14b'
    assert result.timeout_seconds == 5.0
