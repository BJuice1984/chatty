"""Deterministic word-aware text chunking with overlap."""

from __future__ import annotations

import re
from dataclasses import dataclass

_WHITESPACE = re.compile(r'\s+')


@dataclass(frozen=True)
class Chunk:
    ordinal: int
    content: str


def chunk_text(text: str, *, target_chars: int = 800, overlap_chars: int = 120) -> list[Chunk]:
    """Split normalized text into chunks of at most ~target_chars characters.

    Boundaries fall on words; consecutive chunks share a trailing overlap so
    sentences crossing a boundary stay retrievable from both sides.
    """
    if target_chars <= overlap_chars:
        raise ValueError('target_chars must exceed overlap_chars')
    words = [word for word in _WHITESPACE.split(text.strip()) if word]
    if not words:
        return []
    chunks: list[Chunk] = []
    current: list[str] = []
    length = 0
    for word in words:
        extra = len(word) + (1 if current else 0)
        if current and length + extra > target_chars:
            chunks.append(' '.join(current))
            overlap = _tail(current, overlap_chars)
            current = list(overlap)
            length = len(' '.join(current))
        current.append(word)
        length += len(word) + (1 if len(current) > 1 else 0)
    if current:
        chunks.append(' '.join(current))
    return [Chunk(ordinal=index, content=content) for index, content in enumerate(chunks)]


def _tail(words: list[str], overlap_chars: int) -> list[str]:
    tail: list[str] = []
    length = 0
    for word in reversed(words):
        extra = len(word) + (1 if tail else 0)
        if length + extra > overlap_chars:
            break
        tail.insert(0, word)
        length += extra
    return tail
