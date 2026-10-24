"""Admin ingestion, member scope, traceability and failed-document exclusion."""

from __future__ import annotations

import hashlib
from io import BytesIO
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.ingestion.embeddings import EmbeddingError
from app.models.user import User
from app.services.files import DownloadedObject

FIXTURES = Path(__file__).parents[2] / 'fixtures' / 'documents'


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


pytestmark = pytest.mark.anyio


async def register(client: AsyncClient, email: str) -> dict:
    response = await client.post(
        '/api/v1/auth/register',
        json={'email': email, 'password': 'correct horse battery staple'},
    )
    assert response.status_code == 201
    return response.json()


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


def rag_ready(app) -> None:
    app.state.object_storage = MemoryStorage()
    app.state.embedding_provider = HashEmbeddingProvider()


async def test_admin_ingestion_reaches_ready_and_search_returns_file_id(client, app, session_factory):
    rag_ready(app)
    user = await register(client, 'admin@example.com')
    promote_to_admin(session_factory, user['id'])
    chat = await client.post('/api/v1/chats', json={'title': 'RAG'})
    assert chat.status_code == 201
    chat_id = chat.json()['id']
    file = await upload(client, chat_id, 'sample.docx')

    ingested = await client.post(f"/api/v1/documents/{file['file_id']}/ingest")
    assert ingested.status_code == 200, ingested.text
    document = ingested.json()
    assert document['status'] == 'ready'
    assert document['error_kind'] is None
    assert document['chunk_count'] >= 1

    found = await client.post(
        f'/api/v1/chats/{chat_id}/documents/search',
        json={'query': 'Chatty RAG fixture document.', 'top_k': 5},
    )
    assert found.status_code == 200, found.text
    results = found.json()
    assert results, 'ready document must be searchable'
    top = max(results, key=lambda item: item['score'])
    assert top['file_id'] == file['file_id']
    assert {item['file_id'] for item in results} == {file['file_id']}


async def test_non_admin_cannot_ingest(client, app):
    rag_ready(app)
    await register(client, 'member@example.com')
    chat = await client.post('/api/v1/chats', json={'title': 'No admin'})
    file = await upload(client, chat.json()['id'], 'sample.docx')

    denied = await client.post(f"/api/v1/documents/{file['file_id']}/ingest")

    assert denied.status_code == 403
    assert denied.json()['detail'] == 'insufficient_role'


async def test_anonymous_cannot_ingest(client, app):
    rag_ready(app)

    response = await client.post('/api/v1/documents/1/ingest')

    assert response.status_code == 401


async def test_failed_documents_are_never_searchable(client, app, session_factory):
    rag_ready(app)
    user = await register(client, 'admin2@example.com')
    promote_to_admin(session_factory, user['id'])
    chat = await client.post('/api/v1/chats', json={'title': 'Failures'})
    chat_id = chat.json()['id']
    good = await upload(client, chat_id, 'sample.docx')
    corrupt = await upload(client, chat_id, 'corrupt.docx')
    empty = await upload(client, chat_id, 'empty.pdf')

    good_result = await client.post(f"/api/v1/documents/{good['file_id']}/ingest")
    assert good_result.status_code == 200
    assert good_result.json()['status'] == 'ready'

    corrupt_result = await client.post(f"/api/v1/documents/{corrupt['file_id']}/ingest")
    assert corrupt_result.status_code == 200
    assert corrupt_result.json()['status'] == 'failed'
    assert corrupt_result.json()['error_kind'] == 'parse_failed'

    empty_result = await client.post(f"/api/v1/documents/{empty['file_id']}/ingest")
    assert empty_result.status_code == 200
    assert empty_result.json()['status'] == 'failed'
    assert empty_result.json()['error_kind'] == 'no_text'

    found = await client.post(
        f'/api/v1/chats/{chat_id}/documents/search',
        json={'query': 'Chatty RAG fixture document.', 'top_k': 50},
    )
    assert found.status_code == 200
    file_ids = {item['file_id'] for item in found.json()}
    assert file_ids == {good['file_id']}


async def test_reingestion_replaces_chunks_without_duplicates(client, app, session_factory):
    rag_ready(app)
    user = await register(client, 'admin3@example.com')
    promote_to_admin(session_factory, user['id'])
    chat = await client.post('/api/v1/chats', json={'title': 'Reingest'})
    chat_id = chat.json()['id']
    file = await upload(client, chat_id, 'sample.docx')

    first = await client.post(f"/api/v1/documents/{file['file_id']}/ingest")
    assert first.status_code == 200
    second = await client.post(f"/api/v1/documents/{file['file_id']}/ingest")
    assert second.status_code == 200
    assert second.json()['status'] == 'ready'
    assert second.json()['id'] == first.json()['id']
    assert second.json()['chunk_count'] == first.json()['chunk_count']

    found = await client.post(
        f'/api/v1/chats/{chat_id}/documents/search',
        json={'query': 'Chatty RAG fixture document.', 'top_k': 50},
    )
    ordinals = [item['ordinal'] for item in found.json()]
    assert len(ordinals) == len(set(ordinals)), 're-ingestion must not duplicate chunks'


async def test_retrieval_is_membership_scoped(client, app, session_factory):
    rag_ready(app)
    admin = await register(client, 'scope-admin@example.com')
    promote_to_admin(session_factory, admin['id'])
    chat = await client.post('/api/v1/chats', json={'title': 'Scoped'})
    chat_id = chat.json()['id']
    file = await upload(client, chat_id, 'sample.docx')
    ingested = await client.post(f"/api/v1/documents/{file['file_id']}/ingest")
    assert ingested.json()['status'] == 'ready'

    outsider_client = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    await register(outsider_client, 'outsider@example.com')
    denied = await outsider_client.post(
        f'/api/v1/chats/{chat_id}/documents/search',
        json={'query': 'Chatty RAG fixture document.', 'top_k': 5},
    )
    assert denied.status_code == 403
    assert denied.json()['detail'] == 'chat_membership_required'
    await outsider_client.aclose()

    allowed = await client.post(
        f'/api/v1/chats/{chat_id}/documents/search',
        json={'query': 'Chatty RAG fixture document.', 'top_k': 5},
    )
    assert allowed.status_code == 200
    assert allowed.json()


async def test_top_k_is_capped_by_settings(client, app, session_factory, monkeypatch):
    rag_ready(app)
    monkeypatch.setenv('CHATTY_RAG_TOP_K_MAX', '2')
    user = await register(client, 'cap-admin@example.com')
    promote_to_admin(session_factory, user['id'])
    chat = await client.post('/api/v1/chats', json={'title': 'Capped'})
    chat_id = chat.json()['id']
    file = await upload(client, chat_id, 'sample.docx')
    ingested = await client.post(f"/api/v1/documents/{file['file_id']}/ingest")
    assert ingested.json()['status'] == 'ready'

    found = await client.post(
        f'/api/v1/chats/{chat_id}/documents/search',
        json={'query': 'Chatty', 'top_k': 50},
    )
    assert found.status_code == 200
    assert len(found.json()) <= 2


async def test_embedding_provider_failure_blocks_search_explicitly(client, app, session_factory):
    class ExplicitlyFailingProvider:
        def embed(self, texts: list[str]) -> list[list[float]]:
            raise EmbeddingError('endpoint unreachable')

    rag_ready(app)
    user = await register(client, 'fail-admin@example.com')
    promote_to_admin(session_factory, user['id'])
    chat = await client.post('/api/v1/chats', json={'title': 'Unavailable'})
    chat_id = chat.json()['id']
    file = await upload(client, chat_id, 'sample.docx')

    app.state.embedding_provider = ExplicitlyFailingProvider()
    failed_ingest = await client.post(f"/api/v1/documents/{file['file_id']}/ingest")
    assert failed_ingest.status_code == 200
    assert failed_ingest.json()['status'] == 'failed'
    assert failed_ingest.json()['error_kind'] == 'embedding_provider_failed'

    # with a healthy provider the same file reaches ready; the corpus is then
    # non-empty and retrieval really consults the provider
    app.state.embedding_provider = HashEmbeddingProvider()
    ready_ingest = await client.post(f"/api/v1/documents/{file['file_id']}/ingest")
    assert ready_ingest.json()['status'] == 'ready'

    app.state.embedding_provider = ExplicitlyFailingProvider()
    found = await client.post(
        f'/api/v1/chats/{chat_id}/documents/search',
        json={'query': 'anything', 'top_k': 5},
    )
    assert found.status_code == 503
    assert found.json()['detail'] == 'embedding_provider_unavailable'


async def test_misbehaving_provider_never_leaks_500_or_strands_documents(client, app, session_factory):
    """RV1/RV2 regression: contract-violating providers hit explicit failures."""

    class EmptyResultProvider:
        def embed(self, texts: list[str]) -> list[list[float]]:
            return []

    rag_ready(app)
    user = await register(client, 'misbehaving-admin@example.com')
    promote_to_admin(session_factory, user['id'])
    chat = await client.post('/api/v1/chats', json={'title': 'Misbehaving'})
    chat_id = chat.json()['id']
    file = await upload(client, chat_id, 'sample.docx')

    app.state.embedding_provider = EmptyResultProvider()
    short_ingest = await client.post(f"/api/v1/documents/{file['file_id']}/ingest")
    assert short_ingest.status_code == 200
    assert short_ingest.json()['status'] == 'failed'
    assert short_ingest.json()['error_kind'] == 'embedding_provider_failed'

    app.state.embedding_provider = HashEmbeddingProvider()
    ready_ingest = await client.post(f"/api/v1/documents/{file['file_id']}/ingest")
    assert ready_ingest.json()['status'] == 'ready'

    app.state.embedding_provider = EmptyResultProvider()
    found = await client.post(
        f'/api/v1/chats/{chat_id}/documents/search',
        json={'query': 'anything', 'top_k': 5},
    )
    assert found.status_code == 503
    assert found.json()['detail'] == 'embedding_provider_unavailable'
