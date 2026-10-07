"""Stage-9 bot settings read from the environment.

`app/core/config.py` stays untouched: the bot knobs are owned by this package
and documented in `backend/.env.example`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

PROVIDER_URL = 'CHATTY_BOT_PROVIDER_URL'
MODEL = 'CHATTY_BOT_MODEL'
TIMEOUT_SECONDS = 'CHATTY_BOT_TIMEOUT_SECONDS'
MAX_ATTEMPTS = 'CHATTY_BOT_MAX_ATTEMPTS'
STALE_AFTER_SECONDS = 'CHATTY_BOT_STALE_AFTER_SECONDS'
USER_EMAIL = 'CHATTY_BOT_USER_EMAIL'
RAG_TOP_K = 'CHATTY_BOT_RAG_TOP_K'
MAX_ANSWER_CHARS = 'CHATTY_BOT_MAX_ANSWER_CHARS'

DEFAULT_PROVIDER_URL = 'http://127.0.0.1:11434'
DEFAULT_MODEL = 'qwen3:14b'
DEFAULT_TIMEOUT_SECONDS = 60.0
DEFAULT_MAX_ATTEMPTS = 2
DEFAULT_STALE_AFTER_SECONDS = 180.0
DEFAULT_USER_EMAIL = 'bot@chatty.local'
DEFAULT_RAG_TOP_K = 3
DEFAULT_MAX_ANSWER_CHARS = 4000


@dataclass(frozen=True)
class BotSettings:
    provider_url: str
    model: str
    timeout_seconds: float
    max_attempts: int
    stale_after_seconds: float
    user_email: str
    rag_top_k: int
    max_answer_chars: int


def bot_settings_from_env(environ: dict[str, str] | None = None) -> BotSettings:
    env = os.environ if environ is None else environ
    try:
        timeout = float(env.get(TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS))
    except ValueError:
        timeout = DEFAULT_TIMEOUT_SECONDS
    try:
        max_attempts = int(env.get(MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS))
    except ValueError:
        max_attempts = DEFAULT_MAX_ATTEMPTS
    try:
        stale_after = float(env.get(STALE_AFTER_SECONDS, DEFAULT_STALE_AFTER_SECONDS))
    except ValueError:
        stale_after = DEFAULT_STALE_AFTER_SECONDS
    try:
        rag_top_k = int(env.get(RAG_TOP_K, DEFAULT_RAG_TOP_K))
    except ValueError:
        rag_top_k = DEFAULT_RAG_TOP_K
    try:
        max_answer_chars = int(env.get(MAX_ANSWER_CHARS, DEFAULT_MAX_ANSWER_CHARS))
    except ValueError:
        max_answer_chars = DEFAULT_MAX_ANSWER_CHARS
    return BotSettings(
        provider_url=env.get(PROVIDER_URL, DEFAULT_PROVIDER_URL).rstrip('/'),
        model=env.get(MODEL, DEFAULT_MODEL),
        timeout_seconds=timeout if timeout > 0 else DEFAULT_TIMEOUT_SECONDS,
        max_attempts=max_attempts if max_attempts >= 1 else DEFAULT_MAX_ATTEMPTS,
        stale_after_seconds=stale_after if stale_after > 0 else DEFAULT_STALE_AFTER_SECONDS,
        user_email=env.get(USER_EMAIL, DEFAULT_USER_EMAIL).strip().lower() or DEFAULT_USER_EMAIL,
        rag_top_k=rag_top_k if rag_top_k > 0 else DEFAULT_RAG_TOP_K,
        max_answer_chars=(
            max_answer_chars if 0 < max_answer_chars <= 20_000 else DEFAULT_MAX_ANSWER_CHARS
        ),
    )
