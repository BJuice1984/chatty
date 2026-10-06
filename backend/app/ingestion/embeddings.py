"""Local-only embedding provider seam.

The configured provider is a native Ollama endpoint; there is no cloud
fallback at any layer. A missing endpoint raises an explicit error which the
service records (`embedding_provider_failed` during ingestion, an HTTP 503
during retrieval) — never a silent PASS.
"""

from __future__ import annotations

import math
from typing import Protocol

import httpx

from app.ingestion.config import RagSettings


class EmbeddingError(Exception):
    """Explicit embedding provider failure."""


class EmbeddingProvider(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed texts positionally; exactly one vector per input text."""


class OllamaEmbeddingProvider:
    """Synchronous Ollama `/api/embed` client used behind an async boundary."""

    def __init__(self, *, url: str, model: str, timeout_seconds: float = 10.0, transport: httpx.BaseTransport | None = None):
        self.url = url
        self.model = model
        self.timeout_seconds = timeout_seconds
        self._transport = transport

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            with httpx.Client(timeout=self.timeout_seconds, transport=self._transport) as client:
                response = client.post(f'{self.url}/api/embed', json={'model': self.model, 'input': texts})
        except httpx.HTTPError as exc:
            raise EmbeddingError(f'embedding endpoint unreachable: {exc}') from exc
        if response.status_code != 200:
            raise EmbeddingError(f'embedding endpoint returned {response.status_code}')
        try:
            vectors = response.json()['embeddings']
        except (KeyError, ValueError) as exc:
            raise EmbeddingError('embedding endpoint returned a malformed payload') from exc
        if not isinstance(vectors, list) or len(vectors) != len(texts):
            raise EmbeddingError('embedding endpoint returned a mismatched vector count')
        try:
            parsed = [[float(value) for value in vector] for vector in vectors]
        except (ValueError, TypeError) as exc:
            raise EmbeddingError('embedding endpoint returned a malformed payload') from exc
        if any(not vector for vector in parsed):
            raise EmbeddingError('embedding endpoint returned an empty vector')
        return parsed


def default_provider(rag: RagSettings) -> OllamaEmbeddingProvider:
    return OllamaEmbeddingProvider(url=rag.embedding_url, model=rag.embedding_model)


def get_provider(state: object, rag: RagSettings) -> EmbeddingProvider:
    """Prefer an injected provider (tests) over the configured endpoint."""
    existing = getattr(state, 'embedding_provider', None)
    if existing is not None:
        return existing
    return default_provider(rag)


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    norm_left = math.sqrt(sum(a * a for a in left))
    norm_right = math.sqrt(sum(b * b for b in right))
    if norm_left == 0.0 or norm_right == 0.0:
        return 0.0
    return dot / (norm_left * norm_right)
