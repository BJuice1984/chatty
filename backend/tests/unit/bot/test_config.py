"""Bot settings: defaults, overrides and safe fallbacks."""

from __future__ import annotations

from app.bot.config import (
    DEFAULT_MAX_ANSWER_CHARS,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_USER_EMAIL,
    bot_settings_from_env,
)


def test_defaults_from_clean_env():
    bot = bot_settings_from_env({})

    assert bot.provider_url == 'http://127.0.0.1:11434'
    assert bot.model == 'qwen3:14b'
    assert bot.timeout_seconds == 60.0
    assert bot.max_attempts == 2
    assert bot.stale_after_seconds == 180.0
    assert bot.user_email == 'bot@chatty.local'
    assert bot.rag_top_k == 3
    assert bot.max_answer_chars == 4000


def test_env_overrides_are_parsed():
    bot = bot_settings_from_env({
        'CHATTY_BOT_PROVIDER_URL': 'http://ollama.local:11434/',
        'CHATTY_BOT_MODEL': 'llama3.1:8b',
        'CHATTY_BOT_TIMEOUT_SECONDS': '15',
        'CHATTY_BOT_MAX_ATTEMPTS': '3',
        'CHATTY_BOT_STALE_AFTER_SECONDS': '45.5',
        'CHATTY_BOT_USER_EMAIL': 'Assistant@Chatty.Local',
        'CHATTY_BOT_RAG_TOP_K': '5',
        'CHATTY_BOT_MAX_ANSWER_CHARS': '1000',
    })

    assert bot.provider_url == 'http://ollama.local:11434'
    assert bot.model == 'llama3.1:8b'
    assert bot.timeout_seconds == 15.0
    assert bot.max_attempts == 3
    assert bot.stale_after_seconds == 45.5
    assert bot.user_email == 'assistant@chatty.local'
    assert bot.rag_top_k == 5
    assert bot.max_answer_chars == 1000


def test_invalid_values_fall_back_to_defaults():
    bot = bot_settings_from_env({
        'CHATTY_BOT_TIMEOUT_SECONDS': 'soon',
        'CHATTY_BOT_MAX_ATTEMPTS': '0',
        'CHATTY_BOT_STALE_AFTER_SECONDS': '-5',
        'CHATTY_BOT_RAG_TOP_K': 'many',
        'CHATTY_BOT_MAX_ANSWER_CHARS': '99999',
        'CHATTY_BOT_USER_EMAIL': '   ',
    })

    assert bot.timeout_seconds == 60.0
    assert bot.max_attempts == DEFAULT_MAX_ATTEMPTS
    assert bot.stale_after_seconds == 180.0
    assert bot.rag_top_k == 3
    assert bot.max_answer_chars == DEFAULT_MAX_ANSWER_CHARS
    assert bot.user_email == DEFAULT_USER_EMAIL
