"""Prompt construction keeps the data-scope boundary explicit."""

from __future__ import annotations

from app.bot.prompts import CONTEXT_CHUNK_CHARS, SYSTEM_PROMPT, build_messages


def test_without_context_builds_system_and_user_only():
    messages = build_messages('What is this chat about?', [])

    assert [message['role'] for message in messages] == ['system', 'user']
    assert messages[0]['content'] == SYSTEM_PROMPT
    assert messages[1]['content'] == 'What is this chat about?'


def test_context_chunks_are_numbered_and_scoped():
    messages = build_messages('question', ['first chunk', 'second chunk'])

    assert [message['role'] for message in messages] == ['system', 'system', 'user']
    context = messages[1]['content']
    assert 'Document context from this chat' in context
    assert '[1] first chunk' in context
    assert '[2] second chunk' in context


def test_long_chunks_are_truncated():
    long_chunk = 'x' * (CONTEXT_CHUNK_CHARS + 50)
    messages = build_messages('q', [long_chunk])

    context = messages[1]['content']
    assert 'x' * CONTEXT_CHUNK_CHARS in context
    assert 'x' * (CONTEXT_CHUNK_CHARS + 1) not in context


def test_only_provided_data_enters_the_prompt():
    messages = build_messages('my question', ['allowed chunk'])

    flattened = '\n'.join(message['content'] for message in messages)
    assert 'allowed chunk' in flattened
    assert 'foreign' not in flattened
