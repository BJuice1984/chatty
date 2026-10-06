"""Stage-8 RAG settings read from the environment.

`app/core/config.py` stays untouched: the RAG knobs are owned by this package
and documented in `backend/.env.example`.
"""

from __future__ import annotations

import os
import shlex
from dataclasses import dataclass

EMBEDDING_URL = 'CHATTY_RAG_EMBEDDING_URL'
EMBEDDING_MODEL = 'CHATTY_RAG_EMBEDDING_MODEL'
CONVERTER_COMMAND = 'CHATTY_RAG_CONVERTER_COMMAND'
CONVERTER_TIMEOUT = 'CHATTY_RAG_CONVERTER_TIMEOUT_SECONDS'
TOP_K_MAX = 'CHATTY_RAG_TOP_K_MAX'

DEFAULT_EMBEDDING_URL = 'http://127.0.0.1:11434'
DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text'
DEFAULT_CONVERTER_COMMAND = ('soffice', '--headless', '--convert-to', 'docx')
DEFAULT_CONVERTER_TIMEOUT_SECONDS = 30.0
DEFAULT_TOP_K_MAX = 20


@dataclass(frozen=True)
class RagSettings:
    embedding_url: str
    embedding_model: str
    converter_command: tuple[str, ...]
    converter_timeout_seconds: float
    top_k_max: int


def rag_settings_from_env(environ: dict[str, str] | None = None) -> RagSettings:
    env = os.environ if environ is None else environ
    command = env.get(CONVERTER_COMMAND, '').strip()
    parsed_command = tuple(shlex.split(command)) if command else DEFAULT_CONVERTER_COMMAND
    try:
        timeout = float(env.get(CONVERTER_TIMEOUT, DEFAULT_CONVERTER_TIMEOUT_SECONDS))
    except ValueError:
        timeout = DEFAULT_CONVERTER_TIMEOUT_SECONDS
    try:
        top_k_max = int(env.get(TOP_K_MAX, DEFAULT_TOP_K_MAX))
    except ValueError:
        top_k_max = DEFAULT_TOP_K_MAX
    return RagSettings(
        embedding_url=env.get(EMBEDDING_URL, DEFAULT_EMBEDDING_URL).rstrip('/'),
        embedding_model=env.get(EMBEDDING_MODEL, DEFAULT_EMBEDDING_MODEL),
        converter_command=parsed_command or DEFAULT_CONVERTER_COMMAND,
        converter_timeout_seconds=timeout if timeout > 0 else DEFAULT_CONVERTER_TIMEOUT_SECONDS,
        top_k_max=top_k_max if top_k_max > 0 else DEFAULT_TOP_K_MAX,
    )
