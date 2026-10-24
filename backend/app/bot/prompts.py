"""Prompt construction with an explicit data-scope boundary.

The prompt is built only from the system template, chat-scoped document
context provided by the caller and the source message content; nothing else
enters the provider request.
"""

from __future__ import annotations

SYSTEM_PROMPT = (
    'You are the Chatty assistant. Answer using the document context '
    'provided below when it is relevant; you only ever see context from '
    'this chat. Answer concisely in the language of the question.'
)

CONTEXT_CHUNK_CHARS = 2000


def build_messages(source_content: str, context_chunks: list[str]) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [{'role': 'system', 'content': SYSTEM_PROMPT}]
    if context_chunks:
        numbered = '\n\n'.join(
            f'[{index}] {chunk[:CONTEXT_CHUNK_CHARS]}'
            for index, chunk in enumerate(context_chunks, start=1)
        )
        messages.append({'role': 'system', 'content': f'Document context from this chat:\n\n{numbered}'})
    messages.append({'role': 'user', 'content': source_content})
    return messages
