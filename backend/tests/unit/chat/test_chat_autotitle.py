"""One-shot LLM chat auto-naming unit contract (2026-11-06-llm-chat-autotitle).

The service gates: the threshold counts HUMAN replies only (bot answers and
kind-bearing system lines never count), the kill-switch, DMs, cleared flags
and the MAX_CHAT_MESSAGES tail never reach the model; the context transcript
carries the recent kind-NULL non-empty messages with user/bot roles and
respects the caps; answer hygiene unwraps quotes/dot and rejects empty/NONE/
multiline/overlong answers leaving auto_titled untouched; the one-shot CAS
makes a second rename a silent no-op and never overwrites a pre-cleared flag.
"""

from __future__ import annotations

import pytest

from app.bot.config import AutoTitleSettings, BotSettings
from app.bot.provider import BotProviderError
from app.core.security import hash_password
from app.models.chat import Chat
from app.models.message import Message
from app.models.user import User
from app.schemas.chat import ChatCreate
from app.services.chat_autotitle import ChatAutoTitleService

BOT_EMAIL = 'bot@chatty.local'


def make_bot_settings() -> BotSettings:
    return BotSettings(
        provider_api='ollama',
        provider_url='http://127.0.0.1:11434',
        model='qwen3:14b',
        timeout_seconds=60.0,
        max_attempts=2,
        stale_after_seconds=180.0,
        user_email=BOT_EMAIL,
        rag_top_k=3,
        rag_min_score=0.5,
        max_answer_chars=4000,
    )


def make_autotitle(**overrides: object) -> AutoTitleSettings:
    defaults: dict[str, object] = {
        'enabled': True,
        'min_user_messages': 2,
        'min_user_chars': 120,
        'context_messages': 10,
        'context_chars': 2000,
        'timeout_seconds': 15.0,
        'max_title_chars': 48,
        'max_chat_messages': 40,
    }
    defaults.update(overrides)
    return AutoTitleSettings(**defaults)


class ScriptedTitleProvider:
    """Records every prompt; short-path aware like the fakes the bot suite uses."""

    def __init__(self, answers: list[str] | None = None, error: BotProviderError | None = None):
        self.answers = list(answers or [])
        self.error = error
        self.calls: list[list[dict]] = []
        self.short_calls = 0

    def complete(self, messages: list[dict]) -> str:
        self.calls.append(messages)
        if self.error is not None:
            raise self.error
        if not self.answers:
            raise AssertionError('scripted provider ran out of answers')
        return self.answers.pop(0)

    def complete_short(self, messages: list[dict], *, max_tokens: int, timeout_seconds: float) -> str:
        self.short_calls += 1
        assert timeout_seconds == 15.0
        return self.complete(messages)


def create_user(session, email: str, display_name: str | None = None) -> User:
    user = User(
        email=email,
        password_hash=hash_password('correct horse battery staple'),
        display_name=display_name,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def make_auto_chat(session, owner: User) -> Chat:
    chat = Chat(title='Чат с', owner_id=owner.id, is_ai=False, auto_titled=True)
    session.add(chat)
    session.commit()
    session.refresh(chat)
    return chat


def make_service(session, provider: ScriptedTitleProvider, autotitle: AutoTitleSettings | None = None) -> ChatAutoTitleService:
    return ChatAutoTitleService(
        session,
        make_bot_settings(),
        autotitle or make_autotitle(),
        provider=provider,
    )


def seed_message(session, chat_id: int, user_id: int, content: str | None, kind: str | None = None) -> Message:
    message = Message(chat_id=chat_id, user_id=user_id, content=content, kind=kind)
    session.add(message)
    session.commit()
    session.refresh(message)
    return message


def test_below_threshold_never_calls_the_model(session_factory):
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        chat = make_auto_chat(session, owner)
        seed_message(session, chat.id, owner.id, 'Привет, как дела?')

        provider = ScriptedTitleProvider(answers=['Приветствие'])
        assert make_service(session, provider).maybe_rename(chat.id) is None
        assert provider.calls == []
        session.refresh(chat)
        assert chat.auto_titled is True
        assert chat.title == 'Чат с'


def test_two_short_greetings_stay_below_the_char_floor(session_factory):
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        chat = make_auto_chat(session, owner)
        seed_message(session, chat.id, owner.id, 'Привет, как дела?')
        seed_message(session, chat.id, owner.id, 'Нормально, у меня тоже')

        provider = ScriptedTitleProvider(answers=['Приветствие'])
        assert make_service(session, provider).maybe_rename(chat.id) is None
        assert provider.calls == []


def test_bot_answers_and_system_lines_never_count(session_factory):
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        bot = create_user(session, BOT_EMAIL)
        chat = Chat(title='AI ассистент', owner_id=owner.id, is_ai=True, auto_titled=True)
        session.add(chat)
        session.commit()
        session.refresh(chat)

        # юзерская реплика одна и короткая; длиннющий ответ бота и системная
        # строка порог поднять не должны
        seed_message(session, chat.id, owner.id, 'Привет')
        seed_message(session, chat.id, bot.id, 'Здравствуйте! Я отлично справляюсь с самыми разными задачами, ' * 10)
        seed_message(session, chat.id, owner.id, 'чат переименован', kind='chat_renamed')

        provider = ScriptedTitleProvider(answers=['Ответ'])
        assert make_service(session, provider).maybe_rename(chat.id) is None
        assert provider.calls == []


def test_threshold_reached_renames_once_and_clears_the_flag(session_factory):
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        chat = make_auto_chat(session, owner)
        seed_message(session, chat.id, owner.id, 'Подскажи, как настроить Webpack publicPath для CDN-хостинга статики?')
        seed_message(session, chat.id, owner.id, 'Собираю проект, ассеты раздаются со S3, пути ломаются при деплое')

        provider = ScriptedTitleProvider(answers=['Настройка Webpack CDN'])
        service = make_service(session, provider)
        assert service.maybe_rename(chat.id) == 'Настройка Webpack CDN'
        assert provider.short_calls == 1
        session.refresh(chat)
        assert chat.title == 'Настройка Webpack CDN'
        assert chat.auto_titled is False

        # one-shot: повторный вызов — тихий no-op, модель не беспокоится
        assert make_service(session, provider).maybe_rename(chat.id) is None
        assert len(provider.calls) == 1


def test_manual_rename_first_makes_cas_a_silent_noop(session_factory):
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        chat = make_auto_chat(session, owner)
        seed_message(session, chat.id, owner.id, 'Подскажи, как настроить Webpack publicPath для CDN-хостинга статики?')
        seed_message(session, chat.id, owner.id, 'Собираю проект, ассеты раздаются со S3, пути ломаются при деплое')

        # ручной rename уже погасил флаг (013-семантика PUT)
        chat.auto_titled = False
        chat.title = 'Моё название'
        session.commit()

        provider = ScriptedTitleProvider(answers=['LLM вариант'])
        assert make_service(session, provider).maybe_rename(chat.id) is None
        # гейт отсекает ДО вызова модели: провайдер не зван (review F-3)
        assert provider.calls == []
        session.refresh(chat)
        assert chat.title == 'Моё название'


def test_dm_and_disabled_and_tail_guard(session_factory):
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        target = create_user(session, 'target@example.com')

        # is_dm даже с силой-флагом (фронт так не создаёт — пин честности)
        dm = Chat(title='DM seed', owner_id=owner.id, is_ai=False, is_dm=True, auto_titled=True)
        session.add(dm)
        session.commit()
        session.refresh(dm)
        seed_message(session, dm.id, owner.id, 'Подскажи, как настроить Webpack publicPath для CDN-хостинга статики?')
        seed_message(session, dm.id, owner.id, 'Собираю проект, ассеты раздаются со S3, пути ломаются при деплое')
        provider = ScriptedTitleProvider(answers=['Название'])
        assert make_service(session, provider).maybe_rename(dm.id) is None
        assert provider.calls == []

        # kill-switch
        chat = make_auto_chat(session, owner)
        seed_message(session, chat.id, owner.id, 'Подскажи, как настроить Webpack publicPath для CDN-хостинга статики?')
        seed_message(session, chat.id, owner.id, 'Собираю проект, ассеты раздаются со S3, пути ломаются при деплое')
        assert make_service(session, provider, autotitle=make_autotitle(enabled=False)).maybe_rename(chat.id) is None
        assert provider.calls == []

        # хвостовой гвард: сообщений больше максимума — модель не зовётся
        long_chat = make_auto_chat(session, owner)
        for index in range(41):
            seed_message(session, long_chat.id, owner.id, f'Сообщение номер {index} с содержанием подлиннее')
        assert make_service(session, provider, autotitle=make_autotitle(max_chat_messages=40)).maybe_rename(long_chat.id) is None
        assert provider.calls == []


def test_context_roles_and_transcript_filtering(session_factory):
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        bot = create_user(session, BOT_EMAIL)
        chat = Chat(title='AI ассистент', owner_id=owner.id, is_ai=True, auto_titled=True)
        session.add(chat)
        session.commit()
        session.refresh(chat)

        seed_message(session, chat.id, owner.id, 'Подскажи, как настроить Webpack publicPath для CDN-хостинга статики?')
        seed_message(session, chat.id, bot.id, 'publicPath указывает на CDN-хост, а loader options дополняют пути.')
        seed_message(session, chat.id, owner.id, 'Собираю проект, ассеты раздаются со S3, пути ломаются при деплое')
        seed_message(session, chat.id, owner.id, 'системная строка', kind='chat_renamed')
        # file-only реплика: контента нет — ни в порог, ни в транскрипт (review F-3)
        seed_message(session, chat.id, owner.id, None)

        provider = ScriptedTitleProvider(answers=['Webpack CDN'])
        assert make_service(session, provider).maybe_rename(chat.id) == 'Webpack CDN'
        prompt_user = provider.calls[0][1]['content']
        assert 'user: Подскажи' in prompt_user
        assert 'bot: publicPath' in prompt_user
        assert 'системная строка' not in prompt_user
        # file-only строки в транскрипте нет: пустая «user:»-строка отсутствует
        assert '\nuser: \n' not in prompt_user


def test_context_chars_cap_drops_the_oldest_lines(session_factory):
    # кап символов (review F-3): при context_chars=150 старые реплики не
    # влезают — транскрипт берёт только свежий хвост, укладывающийся в бюджет
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        chat = make_auto_chat(session, owner)
        seed_message(session, chat.id, owner.id, 'СТАРАЯ-РЕПЛИКА-零零零 ' * 20)
        seed_message(session, chat.id, owner.id, 'Подскажи, как настроить Webpack publicPath для CDN-хостинга статики проекта?')
        seed_message(session, chat.id, owner.id, 'Собираю проект, ассеты раздаются со S3, пути ломаются при каждом деплое')

        provider = ScriptedTitleProvider(answers=['Тема'])
        assert make_service(session, provider, autotitle=make_autotitle(context_chars=150)).maybe_rename(chat.id) == 'Тема'
        prompt_user = provider.calls[0][1]['content']
        # в бюджет 150 (вместе с префиксами ролей) влезает только свежий хвост
        assert 'СТАРАЯ-РЕПЛИКА' not in prompt_user
        assert 'Подскажи' not in prompt_user
        assert 'Собираю проект' in prompt_user


def test_context_message_cap_takes_the_recent_tail(session_factory):
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        chat = make_auto_chat(session, owner)
        for index in range(12):
            seed_message(session, chat.id, owner.id, f'Реплика {index}: достаточно длинное содержание для порога')
        seed_message(session, chat.id, owner.id, 'Финальная содержательная реплика диалога на важную тему')

        provider = ScriptedTitleProvider(answers=['Тема'])
        assert make_service(session, provider).maybe_rename(chat.id) == 'Тема'
        prompt_user = provider.calls[0][1]['content']
        assert 'Реплика 0' not in prompt_user
        assert 'Реплика 2' not in prompt_user
        assert 'Реплика 3' in prompt_user
        assert 'Финальная содержательная' in prompt_user


def test_answer_hygiene(session_factory):
    cases = [
        ('  "Webpack CDN".  ', 'Webpack CDN'),
        ('«Настройка сборки»', 'Настройка сборки'),
        ("'Vite алиасы'", 'Vite алиасы'),
        # краевые переводы строк обрезаются, не отвергаются как многострочность
        # (review F-1: plain whitespace-strip до снятия кавычек)
        ('\nWebpack CDN\n', 'Webpack CDN'),
    ]
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        chat = make_auto_chat(session, owner)
        seed_message(session, chat.id, owner.id, 'Подскажи, как настроить Webpack publicPath для CDN-хостинга статики?')
        seed_message(session, chat.id, owner.id, 'Собираю проект, ассеты раздаются со S3, пути ломаются при деплое')

        for raw, expected in cases:
            provider = ScriptedTitleProvider(answers=[raw])
            assert make_service(session, provider).maybe_rename(chat.id) == expected
            # флаг погашен первым успехом — возвращаем для следующего кейса
            chat.auto_titled = True
            session.commit()


def test_answer_rejections_keep_the_flag_alive(session_factory):
    rejects = ['', 'NONE', 'none', 'None', 'Первая строка\nВторая строка', 'а' * 49]
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        chat = make_auto_chat(session, owner)
        seed_message(session, chat.id, owner.id, 'Подскажи, как настроить Webpack publicPath для CDN-хостинга статики?')
        seed_message(session, chat.id, owner.id, 'Собираю проект, ассеты раздаются со S3, пути ломаются при деплое')

        for raw in rejects:
            provider = ScriptedTitleProvider(answers=[raw])
            assert make_service(session, provider).maybe_rename(chat.id) is None, raw
            session.refresh(chat)
            assert chat.auto_titled is True, raw

        # поздний валидный ответ переименовывает (естественный ретрай)
        provider = ScriptedTitleProvider(answers=['Webpack CDN'])
        assert make_service(session, provider).maybe_rename(chat.id) == 'Webpack CDN'
        session.refresh(chat)
        assert chat.auto_titled is False


def test_provider_error_is_swallowed(session_factory):
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        chat = make_auto_chat(session, owner)
        seed_message(session, chat.id, owner.id, 'Подскажи, как настроить Webpack publicPath для CDN-хостинга статики?')
        seed_message(session, chat.id, owner.id, 'Собираю проект, ассеты раздаются со S3, пути ломаются при деплое')

        provider = ScriptedTitleProvider(error=BotProviderError('provider_unreachable', 'host down'))
        assert make_service(session, provider).maybe_rename(chat.id) is None
        session.refresh(chat)
        assert chat.auto_titled is True


def test_fallback_complete_for_providers_without_short_path(session_factory):
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        chat = make_auto_chat(session, owner)
        seed_message(session, chat.id, owner.id, 'Подскажи, как настроить Webpack publicPath для CDN-хостинга статики?')
        seed_message(session, chat.id, owner.id, 'Собираю проект, ассеты раздаются со S3, пути ломаются при деплое')

        class LegacyProvider:
            def complete(self, messages: list[dict]) -> str:
                self.calls = [messages]
                return 'Fallback title'

        provider = LegacyProvider()
        assert make_service(session, provider).maybe_rename(chat.id) == 'Fallback title'
        session.refresh(chat)
        assert chat.title == 'Fallback title'
