"""Provider seam: payload parsing, explicit failures, injection."""

from __future__ import annotations

import json
from dataclasses import replace

import httpx
import pytest

from app.bot.config import BotSettings
from app.bot.provider import (
    BotProviderError,
    OllamaBotProvider,
    OpenAIChatProvider,
    default_provider,
    get_bot_provider,
)


def bot(provider_api: str = 'ollama') -> BotSettings:
    return BotSettings(
        provider_api=provider_api,
        provider_url='http://ollama.invalid',
        model='qwen3:14b',
        timeout_seconds=5.0,
        max_attempts=2,
        stale_after_seconds=180.0,
        user_email='bot@chatty.local',
        rag_top_k=3,
        rag_min_score=0.5,
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


def openai_provider(handler, *, timeout=5.0) -> OpenAIChatProvider:
    return OpenAIChatProvider(
        url='http://openai.test',
        model='qwen3.5-9b',
        timeout_seconds=timeout,
        transport=httpx.MockTransport(handler),
    )


def test_openai_complete_posts_chat_completions_and_parses_content():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        body = json.loads(request.content.decode())
        assert body['model'] == 'qwen3.5-9b'
        assert body['stream'] is False
        assert body['messages'] == [{'role': 'user', 'content': 'question'}]
        return httpx.Response(
            200,
            json={'choices': [{'message': {'role': 'assistant', 'content': ' answer text '}}]},
        )

    result = openai_provider(handler).complete([{'role': 'user', 'content': 'question'}])

    assert result == ' answer text '
    assert len(requests) == 1
    assert str(requests[0].url) == 'http://openai.test/v1/chat/completions'


def test_openai_body_carries_generation_limits():
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        bodies.append(body)
        if body['stream']:
            chunk = {'choices': [{'delta': {'content': 'ok'}}]}
            return httpx.Response(200, text=f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n")
        return httpx.Response(
            200, json={'choices': [{'message': {'role': 'assistant', 'content': 'ok'}}]}
        )

    limited = OpenAIChatProvider(
        url='http://openai.test',
        model='qwen3.5-9b',
        timeout_seconds=5.0,
        transport=httpx.MockTransport(handler),
        max_tokens=768,
        frequency_penalty=0.3,
        presence_penalty=0.2,
    )

    limited.complete([{'role': 'user', 'content': 'q'}])
    deltas = list(limited.complete_stream([{'role': 'user', 'content': 'q'}]))

    assert deltas == ['ok']
    assert len(bodies) == 2
    for body in bodies:
        assert body['max_tokens'] == 768
        assert body['frequency_penalty'] == 0.3
        assert body['presence_penalty'] == 0.2


def test_openai_body_omits_neutral_generation_limits():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        assert 'max_tokens' not in body
        assert 'frequency_penalty' not in body
        assert 'presence_penalty' not in body
        return httpx.Response(
            200, json={'choices': [{'message': {'role': 'assistant', 'content': 'ok'}}]}
        )

    openai_provider(handler).complete([{'role': 'user', 'content': 'q'}])


def test_ollama_body_carries_num_predict():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        assert body['options'] == {'num_predict': 768}
        return httpx.Response(200, json={'message': {'role': 'assistant', 'content': 'ok'}})

    bounded = OllamaBotProvider(
        url='http://ollama.test',
        model='qwen3:14b',
        timeout_seconds=5.0,
        transport=httpx.MockTransport(handler),
        max_tokens=768,
    )

    bounded.complete([{'role': 'user', 'content': 'q'}])


def test_ollama_body_without_limit_has_no_options():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        assert 'options' not in body
        return httpx.Response(200, json={'message': {'role': 'assistant', 'content': 'ok'}})

    provider(handler).complete([{'role': 'user', 'content': 'q'}])


def test_openai_http_error_is_explicit():
    failing = openai_provider(lambda request: httpx.Response(503))

    with pytest.raises(BotProviderError) as exc_info:
        failing.complete([{'role': 'user', 'content': 'q'}])
    assert exc_info.value.kind == 'provider_failed'


def test_openai_transport_error_is_explicit():
    def raise_connect_error(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError('connection refused')

    with pytest.raises(BotProviderError) as exc_info:
        openai_provider(raise_connect_error).complete([{'role': 'user', 'content': 'q'}])
    assert exc_info.value.kind == 'provider_unreachable'


def test_openai_timeout_is_explicit():
    def raise_timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout('timed out')

    with pytest.raises(BotProviderError) as exc_info:
        openai_provider(raise_timeout).complete([{'role': 'user', 'content': 'q'}])
    assert exc_info.value.kind == 'provider_timeout'


@pytest.mark.parametrize(
    'payload',
    [
        [],
        {},
        {'choices': []},
        {'choices': 'assistant'},
        {'choices': [None]},
        {'choices': [42]},
        {'choices': [{'role': 'assistant'}]},
        {'choices': [{'message': None}]},
        {'choices': [{'message': 'assistant'}]},
        {'choices': [{'message': {'role': 'assistant'}}]},
        {'choices': [{'message': {'role': 'assistant', 'content': None}}]},
        {'choices': [{'message': {'role': 'assistant', 'content': 42}}]},
        {'choices': [{'message': {'role': 'assistant', 'content': '   '}}]},
    ],
)
def test_openai_malformed_payloads_are_explicit(payload):
    with pytest.raises(BotProviderError) as exc_info:
        openai_provider(lambda request: httpx.Response(200, json=payload)).complete(
            [{'role': 'user', 'content': 'q'}]
        )
    assert exc_info.value.kind == 'provider_malformed'


def test_openai_non_json_body_is_explicit():
    with pytest.raises(BotProviderError) as exc_info:
        openai_provider(lambda request: httpx.Response(200, text='<html>')).complete(
            [{'role': 'user', 'content': 'q'}]
        )
    assert exc_info.value.kind == 'provider_malformed'


def test_default_provider_dispatches_by_provider_api():
    openai_result = default_provider(bot(provider_api='openai'))
    ollama_result = default_provider(bot(provider_api='ollama'))

    assert isinstance(openai_result, OpenAIChatProvider)
    assert openai_result.url == 'http://ollama.invalid'
    assert openai_result.model == 'qwen3:14b'
    assert openai_result.timeout_seconds == 5.0
    assert isinstance(ollama_result, OllamaBotProvider)


def test_default_provider_wires_generation_limits():
    base = bot(provider_api='openai')
    settings = replace(
        base, max_tokens=512, frequency_penalty=0.4, presence_penalty=0.1
    )

    openai_result = default_provider(settings)
    ollama_result = default_provider(replace(settings, provider_api='ollama'))

    assert openai_result.max_tokens == 512
    assert openai_result.frequency_penalty == 0.4
    assert openai_result.presence_penalty == 0.1
    assert ollama_result.max_tokens == 512
