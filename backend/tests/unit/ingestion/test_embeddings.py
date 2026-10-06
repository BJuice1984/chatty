"""Embedding seam: provider determinism, explicit failures, cosine math."""

from __future__ import annotations

import hashlib
import json

import httpx
import pytest

from app.ingestion.config import RagSettings
from app.ingestion.embeddings import (
    EmbeddingError,
    OllamaEmbeddingProvider,
    cosine_similarity,
    default_provider,
    get_provider,
)


class FakeProvider:
    """Deterministic vectors: identical texts embed identically."""

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(text) for text in texts]

    @staticmethod
    def _vector(text: str) -> list[float]:
        digest = hashlib.sha256(text.encode()).digest()
        return [float(byte) for byte in digest[:32]]


def rag() -> RagSettings:
    return RagSettings(
        embedding_url='http://ollama.invalid',
        embedding_model='nomic-embed-text',
        converter_command=('soffice',),
        converter_timeout_seconds=1.0,
        top_k_max=5,
    )


def test_embed_returns_one_vector_per_text():
    vectors = FakeProvider().embed(['a', 'a', 'b'])

    assert len(vectors) == 3
    assert vectors[0] == vectors[1]
    assert vectors[0] != vectors[2]
    assert all(len(vector) == 32 for vector in vectors)


def test_empty_input_returns_empty_list():
    assert FakeProvider().embed([]) == []


def test_ollama_provider_parses_successful_response():
    payload = {'embeddings': [[0.1, 0.2], [0.3, 0.4]]}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        assert body['model'] == 'nomic-embed-text'
        assert body['input'] == ['first', 'second']
        return httpx.Response(200, json=payload)

    provider = OllamaEmbeddingProvider(url='http://ollama.test', model='nomic-embed-text', transport=httpx.MockTransport(handler))

    assert provider.embed(['first', 'second']) == payload['embeddings']


def test_ollama_provider_http_error_is_explicit():
    provider = OllamaEmbeddingProvider(
        url='http://ollama.test',
        model='nomic-embed-text',
        transport=httpx.MockTransport(lambda request: httpx.Response(500)),
    )

    with pytest.raises(EmbeddingError):
        provider.embed(['text'])


def test_ollama_provider_transport_error_is_explicit():
    def raise_transport_error(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError('connection refused')

    provider = OllamaEmbeddingProvider(
        url='http://ollama.test',
        model='nomic-embed-text',
        transport=httpx.MockTransport(raise_transport_error),
    )

    with pytest.raises(EmbeddingError):
        provider.embed(['text'])


def test_ollama_provider_rejects_mismatched_vector_count():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={'embeddings': [[0.1]]})

    provider = OllamaEmbeddingProvider(
        url='http://ollama.test',
        model='nomic-embed-text',
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(EmbeddingError):
        provider.embed(['first', 'second'])


def test_ollama_provider_rejects_non_numeric_vector_elements():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={'embeddings': ['garbage-string']})

    provider = OllamaEmbeddingProvider(
        url='http://ollama.test',
        model='nomic-embed-text',
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(EmbeddingError, match='malformed payload'):
        provider.embed(['text'])


def test_ollama_provider_rejects_null_vector_elements():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={'embeddings': [None]})

    provider = OllamaEmbeddingProvider(
        url='http://ollama.test',
        model='nomic-embed-text',
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(EmbeddingError, match='malformed payload'):
        provider.embed(['text'])


def test_ollama_provider_rejects_empty_vectors():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={'embeddings': [[]]})

    provider = OllamaEmbeddingProvider(
        url='http://ollama.test',
        model='nomic-embed-text',
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(EmbeddingError, match='empty vector'):
        provider.embed(['text'])


def test_get_provider_prefers_the_injected_instance():
    fake = FakeProvider()
    state = type('State', (), {'embedding_provider': fake})()

    assert get_provider(state, rag()) is fake


def test_default_provider_targets_the_configured_url():
    provider = default_provider(rag())

    assert isinstance(provider, OllamaEmbeddingProvider)
    assert provider.url == 'http://ollama.invalid'
    assert provider.model == 'nomic-embed-text'


def test_cosine_similarity_math():
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)
    assert cosine_similarity([1.0, 2.0], [2.0, 4.0]) == pytest.approx(1.0)
    assert cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0
    assert cosine_similarity([1.0], [1.0, 2.0]) == 0.0
