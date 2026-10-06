"""Deterministic chunking: sizes, overlap and ordinals."""

from __future__ import annotations

import pytest

from app.ingestion.chunking import chunk_text


def test_short_text_becomes_one_chunk():
    chunks = chunk_text('hello world')

    assert [chunk.content for chunk in chunks] == ['hello world']
    assert chunks[0].ordinal == 0


def test_whitespace_is_normalized():
    chunks = chunk_text('  hello \n\t world  ')

    assert chunks[0].content == 'hello world'


def test_empty_text_yields_no_chunks():
    assert chunk_text('   \n\t ') == []


def test_long_text_splits_with_overlap_and_sequential_ordinals():
    words = [f'w{index}' for index in range(200)]
    chunks = chunk_text(' '.join(words), target_chars=200, overlap_chars=50)

    assert len(chunks) > 1
    assert [chunk.ordinal for chunk in chunks] == list(range(len(chunks)))
    for chunk in chunks:
        assert len(chunk.content) <= 200
    for previous, current in zip(chunks, chunks[1:]):
        assert shares_leading_overlap(previous.content, current.content)


def test_chunk_boundary_keeps_shared_words():
    text = ' '.join(f'word{index}' for index in range(30))
    chunks = chunk_text(text, target_chars=80, overlap_chars=20)

    assert all(previous.content != current.content for previous, current in zip(chunks, chunks[1:]))
    for previous, current in zip(chunks, chunks[1:]):
        assert shares_leading_overlap(previous.content, current.content)


def shares_leading_overlap(previous: str, current: str) -> bool:
    """The next chunk starts with a non-empty tail window of the previous one."""
    previous_words = previous.split()
    current_words = current.split()
    return any(
        current_words[:size] == previous_words[-size:]
        for size in range(1, min(len(previous_words), len(current_words)) + 1)
    )


def test_invalid_parameters_are_rejected():
    with pytest.raises(ValueError):
        chunk_text('some text', target_chars=10, overlap_chars=10)
