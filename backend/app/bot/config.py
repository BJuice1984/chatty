"""Stage-9 bot settings read from the environment.

`app/core/config.py` stays untouched: the bot knobs are owned by this package
and documented in `backend/.env.example`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

PROVIDER_API = 'CHATTY_BOT_PROVIDER_API'
PROVIDER_URL = 'CHATTY_BOT_PROVIDER_URL'
MODEL = 'CHATTY_BOT_MODEL'
TIMEOUT_SECONDS = 'CHATTY_BOT_TIMEOUT_SECONDS'
ENABLE_THINKING = 'CHATTY_BOT_ENABLE_THINKING'
STREAMING = 'CHATTY_BOT_STREAMING'
MAX_ATTEMPTS = 'CHATTY_BOT_MAX_ATTEMPTS'
STALE_AFTER_SECONDS = 'CHATTY_BOT_STALE_AFTER_SECONDS'
USER_EMAIL = 'CHATTY_BOT_USER_EMAIL'
RAG_TOP_K = 'CHATTY_BOT_RAG_TOP_K'
RAG_MIN_SCORE = 'CHATTY_BOT_RAG_MIN_SCORE'
MAX_ANSWER_CHARS = 'CHATTY_BOT_MAX_ANSWER_CHARS'

DEFAULT_PROVIDER_API = 'ollama'
PROVIDER_APIS = ('ollama', 'openai')
DEFAULT_PROVIDER_URL = 'http://127.0.0.1:11434'
DEFAULT_MODEL = 'qwen3:14b'
DEFAULT_TIMEOUT_SECONDS = 60.0
# Стриминг ответа (kill-switch) и thinking-ручка: дефолты сохраняют текущее
# поведение — целый ответ и thinking-модель как есть
DEFAULT_ENABLE_THINKING = True
DEFAULT_STREAMING = True
TRUE_FLAGS = ('1', 'true', 'yes', 'on')
FALSE_FLAGS = ('0', 'false', 'no', 'off')
DEFAULT_MAX_ATTEMPTS = 2
DEFAULT_STALE_AFTER_SECONDS = 180.0
DEFAULT_USER_EMAIL = 'bot@chatty.local'
DEFAULT_RAG_TOP_K = 3
# Порог отсечения нерелевантных чанков (cosine, bge-m3): ниже — чанк не идёт
# ни в промпт, ни в attachment (live-замер 2026-11-03: релевантные запросы
# дают top-1 0.62-0.69, нерелевантные 0.38-0.41; фронтовое зеркало —
# RAG_RELEVANT_MIN_SCORE в src/features/ai-assistant/documents.ts)
DEFAULT_RAG_MIN_SCORE = 0.5
DEFAULT_MAX_ANSWER_CHARS = 4000


@dataclass(frozen=True)
class BotSettings:
    provider_api: str
    provider_url: str
    model: str
    timeout_seconds: float
    max_attempts: int
    stale_after_seconds: float
    user_email: str
    rag_top_k: int
    rag_min_score: float
    max_answer_chars: int
    enable_thinking: bool = True
    streaming: bool = True


def _env_flag(env: dict[str, str], name: str, default: bool) -> bool:
    raw = env.get(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in TRUE_FLAGS:
        return True
    if value in FALSE_FLAGS:
        return False
    return default


def bot_settings_from_env(environ: dict[str, str] | None = None) -> BotSettings:
    env = os.environ if environ is None else environ
    provider_api = env.get(PROVIDER_API, DEFAULT_PROVIDER_API).strip().lower()
    if provider_api not in PROVIDER_APIS:
        provider_api = DEFAULT_PROVIDER_API
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
        rag_min_score = float(env.get(RAG_MIN_SCORE, DEFAULT_RAG_MIN_SCORE))
    except ValueError:
        rag_min_score = DEFAULT_RAG_MIN_SCORE
    try:
        max_answer_chars = int(env.get(MAX_ANSWER_CHARS, DEFAULT_MAX_ANSWER_CHARS))
    except ValueError:
        max_answer_chars = DEFAULT_MAX_ANSWER_CHARS
    return BotSettings(
        provider_api=provider_api,
        provider_url=env.get(PROVIDER_URL, DEFAULT_PROVIDER_URL).rstrip('/'),
        model=env.get(MODEL, DEFAULT_MODEL),
        timeout_seconds=timeout if timeout > 0 else DEFAULT_TIMEOUT_SECONDS,
        max_attempts=max_attempts if max_attempts >= 1 else DEFAULT_MAX_ATTEMPTS,
        stale_after_seconds=stale_after if stale_after > 0 else DEFAULT_STALE_AFTER_SECONDS,
        user_email=env.get(USER_EMAIL, DEFAULT_USER_EMAIL).strip().lower() or DEFAULT_USER_EMAIL,
        rag_top_k=rag_top_k if rag_top_k > 0 else DEFAULT_RAG_TOP_K,
        rag_min_score=(
            rag_min_score if 0.0 < rag_min_score <= 1.0 else DEFAULT_RAG_MIN_SCORE
        ),
        max_answer_chars=(
            max_answer_chars if 0 < max_answer_chars <= 20_000 else DEFAULT_MAX_ANSWER_CHARS
        ),
        enable_thinking=_env_flag(env, ENABLE_THINKING, DEFAULT_ENABLE_THINKING),
        streaming=_env_flag(env, STREAMING, DEFAULT_STREAMING),
    )


# --- LLM chat auto-title (2026-11-06-llm-chat-autotitle) ---------------------
# The autotitle path reuses the BOT provider stack (CHATTY_BOT_PROVIDER_API/
# URL/MODEL); these knobs own only the naming policy itself.

AUTOTITLE_ENABLED = 'CHATTY_AUTOTITLE_ENABLED'
AUTOTITLE_MIN_USER_MESSAGES = 'CHATTY_AUTOTITLE_MIN_USER_MESSAGES'
AUTOTITLE_MIN_USER_CHARS = 'CHATTY_AUTOTITLE_MIN_USER_CHARS'
AUTOTITLE_CONTEXT_MESSAGES = 'CHATTY_AUTOTITLE_CONTEXT_MESSAGES'
AUTOTITLE_CONTEXT_CHARS = 'CHATTY_AUTOTITLE_CONTEXT_CHARS'
AUTOTITLE_TIMEOUT_SECONDS = 'CHATTY_AUTOTITLE_TIMEOUT_SECONDS'
AUTOTITLE_MAX_TITLE_CHARS = 'CHATTY_AUTOTITLE_MAX_TITLE_CHARS'
AUTOTITLE_MAX_CHAT_MESSAGES = 'CHATTY_AUTOTITLE_MAX_CHAT_MESSAGES'

DEFAULT_AUTOTITLE_ENABLED = True
# Human replies only (bot answers and kind-bearing system lines never count):
# two short greetings stay far below the char floor and never reach the model.
DEFAULT_AUTOTITLE_MIN_USER_MESSAGES = 2
DEFAULT_AUTOTITLE_MIN_USER_CHARS = 120
DEFAULT_AUTOTITLE_CONTEXT_MESSAGES = 10
DEFAULT_AUTOTITLE_CONTEXT_CHARS = 2000
DEFAULT_AUTOTITLE_TIMEOUT_SECONDS = 15.0
DEFAULT_AUTOTITLE_MAX_TITLE_CHARS = 48
# Tail guard: a chat that grew past this many messages without ever passing
# the threshold (or with the model persistently unavailable) stops trying.
DEFAULT_AUTOTITLE_MAX_CHAT_MESSAGES = 40


@dataclass(frozen=True)
class AutoTitleSettings:
    enabled: bool
    min_user_messages: int
    min_user_chars: int
    context_messages: int
    context_chars: int
    timeout_seconds: float
    max_title_chars: int
    max_chat_messages: int


def _env_int(env: dict[str, str], name: str, default: int, *, minimum: int = 1) -> int:
    try:
        value = int(env.get(name, default))
    except ValueError:
        value = default
    return value if value >= minimum else default


def _env_float(env: dict[str, str], name: str, default: float, *, minimum: float = 0.0) -> float:
    try:
        value = float(env.get(name, default))
    except ValueError:
        value = default
    return value if value > minimum else default


def autotitle_settings_from_env(environ: dict[str, str] | None = None) -> AutoTitleSettings:
    env = os.environ if environ is None else environ
    return AutoTitleSettings(
        enabled=_env_flag(env, AUTOTITLE_ENABLED, DEFAULT_AUTOTITLE_ENABLED),
        min_user_messages=_env_int(env, AUTOTITLE_MIN_USER_MESSAGES, DEFAULT_AUTOTITLE_MIN_USER_MESSAGES),
        min_user_chars=_env_int(env, AUTOTITLE_MIN_USER_CHARS, DEFAULT_AUTOTITLE_MIN_USER_CHARS),
        context_messages=_env_int(env, AUTOTITLE_CONTEXT_MESSAGES, DEFAULT_AUTOTITLE_CONTEXT_MESSAGES),
        context_chars=_env_int(env, AUTOTITLE_CONTEXT_CHARS, DEFAULT_AUTOTITLE_CONTEXT_CHARS),
        timeout_seconds=_env_float(env, AUTOTITLE_TIMEOUT_SECONDS, DEFAULT_AUTOTITLE_TIMEOUT_SECONDS),
        max_title_chars=_env_int(env, AUTOTITLE_MAX_TITLE_CHARS, DEFAULT_AUTOTITLE_MAX_TITLE_CHARS),
        max_chat_messages=_env_int(env, AUTOTITLE_MAX_CHAT_MESSAGES, DEFAULT_AUTOTITLE_MAX_CHAT_MESSAGES),
    )
