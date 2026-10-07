"""Durable bot runs: idempotency, bounded retries, scope and failure semantics."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.bot.provider import BotProviderError
from app.ingestion.embeddings import EmbeddingError
from app.models.bot_run import BotRun
from app.models.user import User
from app.services.files import DownloadedObject

FIXTURES = Path(__file__).parents[2] / 'fixtures' / 'documents'

BOT_EMAIL = 'bot@chatty.local'
ANSWER = ' The fixture describes the Chatty RAG document. '


class MemoryStorage:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}

    def upload(self, object_key: str, body: bytes, content_type: str) -> None:
        self.objects[object_key] = (body, content_type)

    def download(self, object_key: str) -> DownloadedObject:
        body, content_type = self.objects[object_key]
        return DownloadedObject(BytesIO(body), content_type, len(body))


class HashEmbeddingProvider:
    """Deterministic fake: identical texts produce identical vectors."""

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(text) for text in texts]

    @staticmethod
    def _vector(text: str) -> list[float]:
        digest = hashlib.sha256(text.encode()).digest()
        return [float(byte) for byte in digest[:32]]


class FailingEmbeddingProvider:
    def embed(self, texts: list[str]) -> list[list[float]]:
        raise EmbeddingError('endpoint unreachable')


class FakeBotProvider:
    """Scripted provider that records every prompt it sees."""

    def __init__(self, answers: list[str] | None = None, error: BotProviderError | None = None):
        self.answers = list(answers or [])
        self.error = error
        self.calls: list[list[dict]] = []

    def complete(self, messages: list[dict]) -> str:
        self.calls.append(messages)
        if self.error is not None:
            raise self.error
        if not self.answers:
            raise AssertionError('scripted provider ran out of answers')
        return self.answers.pop(0)


pytestmark = pytest.mark.anyio


async def register(client: AsyncClient, email: str) -> dict:
    response = await client.post(
        '/api/v1/auth/register',
        json={'email': email, 'password': 'correct horse battery staple'},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def register_bot_user(app) -> None:
    """Register the bot account on its own client: registering on the shared
    client would re-authenticate it and every later call would act as the bot."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://testserver') as bot_client:
        await register(bot_client, BOT_EMAIL)


def bot_user_id(session_factory) -> int:
    with session_factory() as session:
        user = session.scalars(select(User).where(User.email == BOT_EMAIL)).one()
        return user.id


def promote_to_admin(session_factory, user_id: int) -> None:
    with session_factory() as session:
        user = session.get(User, user_id)
        assert user is not None
        user.role = 'admin'
        session.commit()


async def upload(client: AsyncClient, chat_id: int, name: str) -> dict:
    body = (FIXTURES / name).read_bytes()
    response = await client.post(
        '/api/v1/files',
        data={'chat_id': str(chat_id)},
        files={'uploaded': (name, body, 'application/octet-stream')},
    )
    assert response.status_code == 201, response.text
    file = response.json()
    assert file['status'] == 'ready'
    return file


def bot_ready(app, provider: FakeBotProvider | None = None) -> FakeBotProvider:
    app.state.object_storage = MemoryStorage()
    app.state.embedding_provider = HashEmbeddingProvider()
    provider = provider if provider is not None else FakeBotProvider(answers=[ANSWER])
    app.state.bot_provider = provider
    return provider


async def setup_ai_chat_with_document(client, app, session_factory, *, email: str) -> tuple[int, dict]:
    user = await register(client, email)
    promote_to_admin(session_factory, user['id'])
    chat = await client.post('/api/v1/chats', json={'title': 'AI', 'is_ai': True})
    assert chat.status_code == 201, chat.text
    chat_id = chat.json()['id']
    file = await upload(client, chat_id, 'sample.docx')
    ingested = await client.post(f"/api/v1/documents/{file['file_id']}/ingest")
    assert ingested.status_code == 200, ingested.text
    assert ingested.json()['status'] == 'ready'
    return chat_id, file


async def post_message(client: AsyncClient, chat_id: int, content: str) -> dict:
    response = await client.post(
        f'/api/v1/chats/{chat_id}/messages',
        json={'content': content, 'client_message_id': f'c-{chat_id}-{content[:8]}'},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def bot_messages(client: AsyncClient, chat_id: int, bot_user_id: int) -> list[dict]:
    page = await client.get(f'/api/v1/chats/{chat_id}/messages', params={'limit': 100})
    assert page.status_code == 200
    return [message for message in page.json()['messages'] if message['user_id'] == bot_user_id]


def stored_run(session_factory, message_id: int) -> BotRun | None:
    with session_factory() as session:
        return session.scalars(select(BotRun).where(BotRun.message_id == message_id)).first()


def force_run_state(session_factory, message_id: int, *, status: str, age_seconds: float) -> None:
    with session_factory() as session:
        run = session.scalars(select(BotRun).where(BotRun.message_id == message_id)).one()
        run.status = status
        run.updated_at = datetime.now(UTC) - timedelta(seconds=age_seconds)
        session.commit()


async def test_bot_run_succeeds_with_authorized_attachment(client, app, session_factory):
    provider = bot_ready(app)
    chat_id, file = await setup_ai_chat_with_document(
        client, app, session_factory, email='owner@example.com'
    )
    await register_bot_user(app)
    message = await post_message(client, chat_id, 'What is the Chatty RAG fixture document about?')

    response = await client.post(f'/api/v1/chats/{chat_id}/bot/runs', json={'message_id': message['id']})

    assert response.status_code == 200, response.text
    run = response.json()
    assert run['status'] == 'succeeded'
    assert run['attempt'] == 1
    assert run['error_kind'] is None
    assert run['attachment_file_id'] == file['file_id']
    assert run['response_message_id'] is not None

    answers = await bot_messages(client, chat_id, bot_user_id(session_factory))
    assert len(answers) == 1
    assert answers[0]['content'] == ANSWER.strip()
    assert answers[0]['file_id'] == file['file_id']
    assert len(provider.calls) == 1
    prompt = '\n'.join(part['content'] for part in provider.calls[0])
    assert 'Chatty RAG fixture' in prompt


async def test_duplicate_delivery_returns_existing_run_without_reexecution(client, app, session_factory):
    provider = bot_ready(app)
    chat_id, _file = await setup_ai_chat_with_document(
        client, app, session_factory, email='owner-dup@example.com'
    )
    await register_bot_user(app)
    message = await post_message(client, chat_id, 'Summarize the document.')

    first = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': message['id']})
    second = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': message['id']})

    assert first.status_code == second.status_code == 200
    assert second.json()['id'] == first.json()['id']
    assert second.json()['attempt'] == 1
    assert second.json()['status'] == 'succeeded'
    assert len(provider.calls) == 1
    assert len(await bot_messages(client, chat_id, bot_user_id(session_factory))) == 1


async def test_provider_failure_then_retry_within_budget(client, app, session_factory):
    bot_ready(app, FakeBotProvider(error=BotProviderError('provider_failed', 'boom')))
    chat_id, _file = await setup_ai_chat_with_document(
        client, app, session_factory, email='owner-retry@example.com'
    )
    await register_bot_user(app)
    message = await post_message(client, chat_id, 'Any question.')

    failed = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': message['id']})
    assert failed.status_code == 200
    assert failed.json()['status'] == 'failed'
    assert failed.json()['error_kind'] == 'provider_failed'
    assert failed.json()['attempt'] == 1
    assert await bot_messages(client, chat_id, bot_user_id(session_factory)) == []

    app.state.bot_provider = FakeBotProvider(answers=[ANSWER])
    recovered = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': message['id']})
    assert recovered.status_code == 200
    assert recovered.json()['status'] == 'succeeded'
    assert recovered.json()['attempt'] == 2
    assert recovered.json()['id'] == failed.json()['id']
    assert len(await bot_messages(client, chat_id, bot_user_id(session_factory))) == 1


async def test_retry_budget_exhausted_is_explicit_409(client, app, session_factory, monkeypatch):
    monkeypatch.setenv('CHATTY_BOT_MAX_ATTEMPTS', '1')
    bot_ready(app, FakeBotProvider(error=BotProviderError('provider_timeout', 'slow')))
    chat_id, _file = await setup_ai_chat_with_document(
        client, app, session_factory, email='owner-budget@example.com'
    )
    await register_bot_user(app)
    message = await post_message(client, chat_id, 'Any question.')

    failed = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': message['id']})
    assert failed.json()['status'] == 'failed'
    assert failed.json()['error_kind'] == 'provider_timeout'

    exhausted = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': message['id']})
    assert exhausted.status_code == 409
    assert exhausted.json()['detail'] == 'retry_budget_exhausted'


async def test_fresh_running_row_is_returned_without_reexecution(client, app, session_factory):
    provider = bot_ready(app)
    chat_id, _file = await setup_ai_chat_with_document(
        client, app, session_factory, email='owner-fresh@example.com'
    )
    await register_bot_user(app)
    message = await post_message(client, chat_id, 'Any question.')

    bot_ready(app, FakeBotProvider(error=BotProviderError('provider_failed', 'boom')))
    failed = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': message['id']})
    assert failed.json()['attempt'] == 1

    force_run_state(session_factory, message['id'], status='running', age_seconds=0)
    app.state.bot_provider = provider
    duplicate = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': message['id']})

    assert duplicate.status_code == 200
    assert duplicate.json()['status'] == 'running'
    assert duplicate.json()['attempt'] == 1
    assert len(provider.calls) == 0
    assert await bot_messages(client, chat_id, bot_user_id(session_factory)) == []


async def test_stale_running_row_is_reclaimed_with_incremented_attempt(client, app, session_factory):
    provider = bot_ready(app)
    chat_id, _file = await setup_ai_chat_with_document(
        client, app, session_factory, email='owner-stale@example.com'
    )
    await register_bot_user(app)
    message = await post_message(client, chat_id, 'Any question.')

    bot_ready(app, FakeBotProvider(error=BotProviderError('provider_failed', 'boom')))
    failed = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': message['id']})
    assert failed.json()['attempt'] == 1

    force_run_state(session_factory, message['id'], status='running', age_seconds=600)
    app.state.bot_provider = provider
    reclaimed = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': message['id']})

    assert reclaimed.status_code == 200
    assert reclaimed.json()['status'] == 'succeeded'
    assert reclaimed.json()['attempt'] == 2
    assert reclaimed.json()['id'] == failed.json()['id']
    assert len(await bot_messages(client, chat_id, bot_user_id(session_factory))) == 1


async def test_cross_chat_message_id_is_rejected(client, app, session_factory):
    bot_ready(app)
    chat_a, _ = await setup_ai_chat_with_document(client, app, session_factory, email='cross@example.com')
    chat_b = (await client.post('/api/v1/chats', json={'title': 'B', 'is_ai': True})).json()['id']
    foreign = await post_message(client, chat_b, 'Secret content of chat B.')

    response = await client.post(f'/api/v1/chats/{chat_a}/bot/runs', json={'message_id': foreign['id']})

    assert response.status_code == 400
    assert response.json()['detail'] == 'message_not_in_chat'
    assert stored_run(session_factory, foreign['id']) is None


async def test_non_ai_chat_rejects_bot_runs(client, app):
    bot_ready(app)
    await register(client, 'plain@example.com')
    chat = await client.post('/api/v1/chats', json={'title': 'Plain', 'is_ai': False})
    chat_id = chat.json()['id']
    message = await post_message(client, chat_id, 'Hello.')

    response = await client.post(f'/api/v1/chats/{chat_id}/bot/runs', json={'message_id': message['id']})

    assert response.status_code == 409
    assert response.json()['detail'] == 'bot_not_enabled_for_chat'


async def test_membership_is_required_to_run_the_bot(client, app, session_factory):
    bot_ready(app)
    chat_id, _ = await setup_ai_chat_with_document(client, app, session_factory, email='member-owner@example.com')
    message = await post_message(client, chat_id, 'Any question.')

    outsider = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    await register(outsider, 'outsider-bot@example.com')
    denied = await outsider.post(f'/api/v1/chats/{chat_id}/bot/runs', json={'message_id': message['id']})
    assert denied.status_code == 403
    assert denied.json()['detail'] == 'chat_membership_required'
    await outsider.aclose()


async def test_anonymous_gets_401(client, app):
    bot_ready(app)

    response = await client.post('/api/v1/chats/1/bot/runs', json={'message_id': 1})

    assert response.status_code == 401


async def test_missing_message_is_404(client, app, session_factory):
    bot_ready(app)
    chat_id, _ = await setup_ai_chat_with_document(client, app, session_factory, email='missing@example.com')

    response = await client.post(f'/api/v1/chats/{chat_id}/bot/runs', json={'message_id': 99999})

    assert response.status_code == 404
    assert response.json()['detail'] == 'message_not_found'


async def test_bot_own_message_is_rejected(client, app, session_factory):
    bot_ready(app)
    chat_id, _ = await setup_ai_chat_with_document(client, app, session_factory, email='own@example.com')
    await register_bot_user(app)
    message = await post_message(client, chat_id, 'Any question.')
    answered = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': message['id']})
    assert answered.json()['status'] == 'succeeded'
    answer_id = answered.json()['response_message_id']

    loop = await client.post(f'/api/v1/chats/{chat_id}/bot/runs', json={'message_id': answer_id})

    assert loop.status_code == 409
    assert loop.json()['detail'] == 'bot_own_message'


async def test_file_only_source_requires_content(client, app, session_factory):
    bot_ready(app)
    chat_id, file = await setup_ai_chat_with_document(client, app, session_factory, email='file-only@example.com')
    response = await client.post(
        f'/api/v1/chats/{chat_id}/messages',
        json={'file_id': file['file_id'], 'client_message_id': 'file-only'},
    )
    assert response.status_code == 201

    run = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': response.json()['id']})

    assert run.status_code == 400
    assert run.json()['detail'] == 'message_content_required'


async def test_missing_bot_user_fails_the_run_explicitly(client, app, session_factory):
    bot_ready(app)
    chat_id, _ = await setup_ai_chat_with_document(client, app, session_factory, email='no-bot@example.com')
    message = await post_message(client, chat_id, 'Any question.')

    response = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': message['id']})

    assert response.status_code == 200
    assert response.json()['status'] == 'failed'
    assert response.json()['error_kind'] == 'bot_user_not_configured'
    page = await client.get(f'/api/v1/chats/{chat_id}/messages', params={'limit': 100})
    assert len(page.json()['messages']) == 1


async def test_rag_unavailability_fails_the_run_explicitly(client, app, session_factory):
    bot_ready(app)
    chat_id, _ = await setup_ai_chat_with_document(client, app, session_factory, email='rag-down@example.com')
    await register_bot_user(app)
    message = await post_message(client, chat_id, 'Any question.')

    app.state.embedding_provider = FailingEmbeddingProvider()
    response = await client.post(f"/api/v1/chats/{chat_id}/bot/runs", json={'message_id': message['id']})

    assert response.status_code == 200
    assert response.json()['status'] == 'failed'
    assert response.json()['error_kind'] == 'embedding_provider_unavailable'


def test_bot_routes_are_mounted_exactly_once(app):
    paths = [route.path for route in app.routes if getattr(route, 'path', '').endswith('/bot/runs')]
    assert paths == ['/api/v1/chats/{chat_id}/bot/runs']


async def test_foreign_attachment_cannot_enter_a_response(app, session_factory, test_settings):
    """Service-level seam check: a hostile search result is stopped by the message contract."""

    from app.bot.config import bot_settings_from_env
    from app.ingestion.config import rag_settings_from_env
    from app.models.user import User as UserModel
    from app.schemas.chat import ChatCreate
    from app.schemas.message import MessageCreate
    from app.services.bot import BotService
    from app.services.chats import ChatService
    from app.services.messages import MessageService

    with session_factory() as session:
        session.add(UserModel(email=BOT_EMAIL, password_hash='not-a-real-login-hash'))
        session.commit()
        bot_user_id = session.scalars(select(UserModel)).first().id
        owner = SimpleNamespace(id=bot_user_id + 1)
        chat = ChatService(session).create(owner.id, ChatCreate(title='AI', is_ai=True))
        message = MessageService(session).create(chat.id, owner.id, MessageCreate(content='question'))

        def hostile_search(*, chat_id, user_id, query, top_k):
            foreign_chunk = SimpleNamespace(file_id=424242, content='foreign chunk')
            return [(foreign_chunk, 0.9)]

        service = BotService(
            session,
            test_settings,
            bot_settings_from_env({}),
            rag_settings_from_env({}),
            provider=FakeBotProvider(answers=[ANSWER]),
            rag_search=hostile_search,
        )
        run = service.run(chat_id=chat.id, user_id=owner.id, message_id=message.id)

        assert run.status == 'failed'
        assert run.error_kind == 'attachment_not_authorized'
        assert run.response_message_id is None
        history = MessageService(session).history(chat.id, owner.id, before_id=None, limit=100)
        assert len(history[0]) == 1  # only the source question; no bot answer
