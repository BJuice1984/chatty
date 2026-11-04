"""Provider streaming, the thinking knob and the throttled bot_delta bridge.

No inference host is involved (host down, deferred acceptance): SSE shapes
come from ``httpx.MockTransport`` handlers, the service runs against scripted
fakes with an injectable stream clock, and the endpoint bridge is observed
through a fake hub. The final-message path must stay byte-identical — deltas
are progress-only.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from types import SimpleNamespace

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.bot.config import bot_settings_from_env
from app.bot.provider import (
    BotProvider,
    BotProviderError,
    OllamaBotProvider,
    OpenAIChatProvider,
)
from app.ingestion.config import rag_settings_from_env
from app.models.message import Message
from app.models.user import User
from app.schemas.chat import ChatCreate
from app.schemas.message import MessageCreate
from app.services.bot import DELTA_EMIT_WINDOW_SECONDS, BotService
from app.services.chats import ChatService
from app.services.messages import MessageService

BOT_EMAIL = 'bot@chatty.local'

pytestmark = pytest.mark.anyio


def sse(lines: list[str]) -> httpx.Response:
    return httpx.Response(200, headers={'content-type': 'text/event-stream'}, text='\n'.join(lines) + '\n')


def openai(handler, **kwargs) -> OpenAIChatProvider:
    return OpenAIChatProvider(
        url='http://openai.test',
        model='qwen3.5-9b',
        timeout_seconds=5.0,
        transport=httpx.MockTransport(handler),
        **kwargs,
    )


# ---------------------------------------------------------------- providers


def test_openai_stream_yields_only_content_deltas():
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content.decode()))
        return sse([
            ': keep-alive comment',
            'data: {"choices": [{"delta": {"role": "assistant"}}]}',
            'data: {"choices": [{"delta": {"content": "Hel"}}]}',
            'data: {"choices": [{"delta": {"reasoning_content": "secret thought"}}]}',
            'data: {"choices": [{"delta": {"content": "lo"}}]}',
            'data: {"choices": [{"delta": {"finish_reason": "stop"}}]}',
            'data: {"choices": [], "usage": {}}',
            'data: [DONE]',
        ])

    deltas = list(openai(handler).complete_stream([{'role': 'user', 'content': 'q'}]))

    assert deltas == ['Hel', 'lo']
    assert bodies[0]['stream'] is True


def test_openai_stream_malformed_data_line_is_explicit():
    def handler(request: httpx.Request) -> httpx.Response:
        return sse(['data: {not-json'])

    with pytest.raises(BotProviderError) as exc_info:
        list(openai(handler).complete_stream([{'role': 'user', 'content': 'q'}]))
    assert exc_info.value.kind == 'provider_malformed'


def test_openai_stream_without_content_is_malformed():
    def handler(request: httpx.Request) -> httpx.Response:
        return sse([
            'data: {"choices": [{"delta": {"role": "assistant"}}]}',
            'data: {"choices": [{"delta": {"reasoning_content": "only thinking"}}]}',
            'data: [DONE]',
        ])

    with pytest.raises(BotProviderError) as exc_info:
        list(openai(handler).complete_stream([{'role': 'user', 'content': 'q'}]))
    assert exc_info.value.kind == 'provider_malformed'


def test_openai_stream_timeout_is_explicit():
    def raise_timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout('chunk overdue')

    with pytest.raises(BotProviderError) as exc_info:
        list(openai(raise_timeout).complete_stream([{'role': 'user', 'content': 'q'}]))
    assert exc_info.value.kind == 'provider_timeout'


def test_openai_stream_http_error_is_explicit():
    failing = openai(lambda request: httpx.Response(503))

    with pytest.raises(BotProviderError) as exc_info:
        list(failing.complete_stream([{'role': 'user', 'content': 'q'}]))
    assert exc_info.value.kind == 'provider_failed'


def test_openai_body_carries_thinking_kwarg_only_when_disabled():
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        bodies.append(body)
        if body['stream']:
            return sse(['data: {"choices": [{"delta": {"content": "ok"}}]}', 'data: [DONE]'])
        return httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'content': 'ok'}}]})

    provider = openai(handler, enable_thinking=False)
    assert provider.complete([{'role': 'user', 'content': 'q'}]) == 'ok'
    assert ''.join(provider.complete_stream([{'role': 'user', 'content': 'q'}])) == 'ok'

    assert bodies[0]['chat_template_kwargs'] == {'enable_thinking': False}
    assert bodies[1]['chat_template_kwargs'] == {'enable_thinking': False}
    assert bodies[1]['stream'] is True


def test_openai_body_has_no_thinking_kwarg_when_enabled():
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        bodies.append(body)
        if body['stream']:
            return sse(['data: {"choices": [{"delta": {"content": "ok"}}]}', 'data: [DONE]'])
        return httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'content': 'ok'}}]})

    provider = openai(handler)
    assert provider.complete([{'role': 'user', 'content': 'q'}]) == 'ok'
    assert ''.join(provider.complete_stream([{'role': 'user', 'content': 'q'}])) == 'ok'

    assert 'chat_template_kwargs' not in bodies[0]
    assert 'chat_template_kwargs' not in bodies[1]


def test_ollama_complete_stream_is_one_explicit_chunk():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={'message': {'role': 'assistant', 'content': 'whole answer'}})

    provider = OllamaBotProvider(
        url='http://ollama.test',
        model='qwen3:14b',
        timeout_seconds=5.0,
        transport=httpx.MockTransport(handler),
    )

    assert list(provider.complete_stream([{'role': 'user', 'content': 'q'}])) == ['whole answer']


def test_protocol_default_gives_subclassed_fakes_a_single_chunk_stream():
    class SubclassedFake(BotProvider):
        def __init__(self):
            self.calls: list[list[dict]] = []

        def complete(self, messages: list[dict]) -> str:
            self.calls.append(messages)
            return 'whole answer'

    fake = SubclassedFake()

    assert list(fake.complete_stream([{'role': 'user', 'content': 'q'}])) == ['whole answer']
    assert len(fake.calls) == 1


# -------------------------------------------------------------------- config


def test_streaming_and_thinking_flags_default_true_and_parse_explicitly():
    defaults = bot_settings_from_env({})
    assert defaults.streaming is True
    assert defaults.enable_thinking is True

    off = bot_settings_from_env({
        'CHATTY_BOT_STREAMING': 'false',
        'CHATTY_BOT_ENABLE_THINKING': 'False',
    })
    assert off.streaming is False
    assert off.enable_thinking is False

    garbage = bot_settings_from_env({
        'CHATTY_BOT_STREAMING': 'maybe',
        'CHATTY_BOT_ENABLE_THINKING': 'maybe',
    })
    assert garbage.streaming is True
    assert garbage.enable_thinking is True


# ------------------------------------------------------------------- service


class FakeStreamClock:
    """Deterministic monotonic clock that the scripted provider advances."""

    def __init__(self):
        self.now = 0.0

    def advance(self, seconds: float) -> None:
        self.now += seconds

    def __call__(self) -> float:
        return self.now


class ScriptedStreamProvider:
    """complete_stream walks a (delta, advance-seconds) script, then optionally raises."""

    def __init__(self, script: list[tuple[str, float]], error: BotProviderError | None = None):
        self.script = list(script)
        self.error = error
        self.stream_calls = 0
        self.complete_calls = 0
        self.clock = FakeStreamClock()

    def complete(self, messages: list[dict]) -> str:
        self.complete_calls += 1
        return ''.join(delta for delta, _advance in self.script)

    def complete_stream(self, messages: list[dict]):
        self.stream_calls += 1
        for delta, advance in self.script:
            self.clock.advance(advance)
            yield delta
        if self.error is not None:
            raise self.error


def run_scripted_bot(
    session_factory,
    test_settings,
    *,
    provider,
    bot=None,
    on_delta=None,
    **service_kwargs,
):
    """Seed bot user + AI chat + question, run the service, return (run, answer)."""
    with session_factory() as session:
        session.add(User(email=BOT_EMAIL, password_hash='not-a-real-login-hash'))
        session.commit()
        bot_user_id = session.scalars(select(User)).first().id
        owner = SimpleNamespace(id=bot_user_id + 1)
        chat = ChatService(session).create(owner.id, ChatCreate(title='AI', is_ai=True))
        message = MessageService(session).create(chat.id, owner.id, MessageCreate(content='question'))
        service = BotService(
            session,
            test_settings,
            bot if bot is not None else bot_settings_from_env(),
            rag_settings_from_env(),
            provider=provider,
            rag_search=lambda **_kwargs: [],
            **service_kwargs,
        )
        run = service.run(chat_id=chat.id, user_id=owner.id, message_id=message.id, on_delta=on_delta)
        answer = session.get(Message, run.response_message_id) if run.response_message_id else None
        return run, (answer.content if answer is not None else None)


def test_service_coalesces_deltas_into_the_window(app, session_factory, test_settings):
    provider = ScriptedStreamProvider([
        ('He', 0.0),
        ('ll', 0.1),
        ('o ', 0.2),
        ('wo', DELTA_EMIT_WINDOW_SECONDS + 0.01),
        ('rld', 0.1),
    ])
    emitted: list[str] = []

    run, answer = run_scripted_bot(
        session_factory,
        test_settings,
        provider=provider,
        on_delta=emitted.append,
        stream_clock=provider.clock,
    )

    assert run.status == 'succeeded'
    assert provider.stream_calls == 1
    # the first three deltas (clock 0.0/0.1/0.3) coalesce into ONE emit; the
    # window re-arms and 'wo' goes alone; 'rld' stays in the tail — the final
    # message carries the full text
    assert emitted == ['Hello ', 'wo']
    assert answer == 'Hello world'


def test_stream_failure_after_an_emit_never_calls_on_delta_again(app, session_factory, test_settings):
    provider = ScriptedStreamProvider(
        [('a', 0.0), ('b', DELTA_EMIT_WINDOW_SECONDS + 0.05)],
        error=BotProviderError('provider_timeout', 'stream died'),
    )
    emitted: list[str] = []

    run, answer = run_scripted_bot(
        session_factory,
        test_settings,
        provider=provider,
        on_delta=emitted.append,
        stream_clock=provider.clock,
    )

    assert run.status == 'failed'
    assert run.error_kind == 'provider_timeout'
    assert run.response_message_id is None
    assert answer is None
    # 'ab' was emitted BEFORE the failure; nothing may follow it
    assert emitted == ['ab']


def test_stream_failure_within_the_window_emits_nothing(app, session_factory, test_settings):
    provider = ScriptedStreamProvider(
        [('a', 0.0)],
        error=BotProviderError('provider_malformed', 'empty stream'),
    )
    emitted: list[str] = []

    run, _answer = run_scripted_bot(
        session_factory,
        test_settings,
        provider=provider,
        on_delta=emitted.append,
        stream_clock=provider.clock,
    )

    assert run.status == 'failed'
    assert run.error_kind == 'provider_malformed'
    assert emitted == []


def test_broken_bridge_never_fails_or_blocks_the_run(app, session_factory, test_settings, caplog):
    provider = ScriptedStreamProvider([('Hi', 0.0), ('!', DELTA_EMIT_WINDOW_SECONDS + 0.05)])
    calls: list[str] = []

    def broken_bridge(text: str) -> None:
        calls.append(text)
        raise RuntimeError('bridge exploded')

    with caplog.at_level(logging.WARNING, logger='app.services.bot'):
        run, answer = run_scripted_bot(
            session_factory,
            test_settings,
            provider=provider,
            on_delta=broken_bridge,
            stream_clock=provider.clock,
        )

    assert run.status == 'succeeded'
    assert answer == 'Hi!'
    assert calls == ['Hi!']
    assert 'bot delta bridge failed' in caplog.text


def test_streaming_false_bypasses_the_stream_end_to_end(app, session_factory, test_settings):
    provider = ScriptedStreamProvider([('Hello', 0.0), (' world', 0.0)])
    emitted: list[str] = []

    run, answer = run_scripted_bot(
        session_factory,
        test_settings,
        provider=provider,
        bot=bot_settings_from_env({'CHATTY_BOT_STREAMING': 'false'}),
        on_delta=emitted.append,
    )

    assert run.status == 'succeeded'
    assert provider.complete_calls == 1
    assert provider.stream_calls == 0
    assert emitted == []
    assert answer == 'Hello world'


def test_structural_fake_without_stream_keeps_the_whole_answer_path(app, session_factory, test_settings):
    class LegacyFake:
        """Classic scripted provider: complete() only, no complete_stream."""

        def __init__(self):
            self.calls = 0

        def complete(self, messages: list[dict]) -> str:
            self.calls += 1
            return 'plain answer'

    provider = LegacyFake()
    emitted: list[str] = []

    run, answer = run_scripted_bot(
        session_factory,
        test_settings,
        provider=provider,
        on_delta=emitted.append,
    )

    assert run.status == 'succeeded'
    assert provider.calls == 1
    assert emitted == []
    assert answer == 'plain answer'


# ------------------------------------------------------------------ endpoint


class GappedStreamProvider:
    """complete_stream with one real-time gap so the ~250ms window opens."""

    def __init__(self, fast_deltas: list[str], slow_deltas: list[str], gap: float = 0.3):
        self.fast_deltas = fast_deltas
        self.slow_deltas = slow_deltas
        self.gap = gap

    def complete(self, messages: list[dict]) -> str:
        return ''.join(self.fast_deltas) + ''.join(self.slow_deltas)

    def complete_stream(self, messages: list[dict]):
        for delta in self.fast_deltas:
            yield delta
        time.sleep(self.gap)
        for delta in self.slow_deltas:
            yield delta


class RecordingHub:
    def __init__(self):
        self.broadcasts: list[dict] = []

    async def broadcast(self, chat_id, payload, *, active_user_ids):
        self.broadcasts.append(
            {'chat_id': chat_id, 'payload': payload, 'active_user_ids': set(active_user_ids)}
        )


async def register(client: AsyncClient, email: str) -> dict:
    response = await client.post(
        '/api/v1/auth/register',
        json={'email': email, 'password': 'correct horse battery staple'},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def register_bot_user(app) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://testserver') as bot_client:
        await register(bot_client, BOT_EMAIL)


async def drain_loop() -> None:
    for _ in range(4):
        await asyncio.sleep(0)


async def test_endpoint_bridge_broadcasts_bot_delta_through_the_hub(client, app, monkeypatch):
    hub = RecordingHub()
    monkeypatch.setattr('app.api.v1.endpoints.bot.hub', hub)
    app.state.bot_provider = GappedStreamProvider(['He', 'll'], ['!'])
    await register_bot_user(app)
    owner = await register(client, 'bridge-owner@example.com')
    chat_id = (await client.post('/api/v1/chats', json={'title': 'AI', 'is_ai': True})).json()['id']
    message = (
        await client.post(
            f'/api/v1/chats/{chat_id}/messages',
            json={'content': 'Any question.', 'client_message_id': 'bridge-q'},
        )
    ).json()

    response = await client.post(f'/api/v1/chats/{chat_id}/bot/runs', json={'message_id': message['id']})

    assert response.status_code == 200, response.text
    assert response.json()['status'] == 'succeeded'
    await drain_loop()

    deltas = [entry for entry in hub.broadcasts if entry['payload']['type'] == 'bot_delta']
    assert [entry['payload'] for entry in deltas] == [
        {'type': 'bot_delta', 'content': {'message_id': message['id'], 'delta': 'Hell!'}}
    ]
    assert owner['id'] in deltas[0]['active_user_ids']
    final = hub.broadcasts[-1]
    assert final['payload']['type'] == 'message'
    assert final['chat_id'] == chat_id
    assert final['payload']['content']['content'] == 'Hell!'


async def test_streaming_kill_switch_suppresses_bot_delta_at_the_endpoint(client, app, monkeypatch):
    hub = RecordingHub()
    monkeypatch.setattr('app.api.v1.endpoints.bot.hub', hub)
    monkeypatch.setenv('CHATTY_BOT_STREAMING', 'false')
    app.state.bot_provider = GappedStreamProvider(['He', 'll'], ['!'])
    await register_bot_user(app)
    await register(client, 'kill-switch-owner@example.com')
    chat_id = (await client.post('/api/v1/chats', json={'title': 'AI', 'is_ai': True})).json()['id']
    message = (
        await client.post(
            f'/api/v1/chats/{chat_id}/messages',
            json={'content': 'Any question.', 'client_message_id': 'kill-switch-q'},
        )
    ).json()

    response = await client.post(f'/api/v1/chats/{chat_id}/bot/runs', json={'message_id': message['id']})

    assert response.status_code == 200, response.text
    assert response.json()['status'] == 'succeeded'
    await drain_loop()

    assert [entry for entry in hub.broadcasts if entry['payload']['type'] == 'bot_delta'] == []
    assert len(hub.broadcasts) == 1
    assert hub.broadcasts[0]['payload']['type'] == 'message'
    assert hub.broadcasts[0]['payload']['content']['content'] == 'Hell!'
