"""Vacation skill dialog scenarios through the real bot pipeline (AC-FLOW).

The bot pipeline runs with the FakeBotProvider seam (app.state.bot_provider,
the test_bot_api.py precedent) and a seeded fictional schedule snapshot;
the LLM never runs for the deterministic branch, the template fallback
covers provider failures, and the surname persists across chats and runs.
"""

from __future__ import annotations

from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.bot.provider import BotProviderError
from app.models import VacationName, VacationPeriod, VacationSchedule
from app.vacations.service import VacationService

BOT_EMAIL = 'bot@chatty.local'
USER_EMAIL = 'vacation-user@example.com'
SECOND_USER_EMAIL = 'vacation-second@example.com'


class MemoryStorage:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}

    def upload(self, object_key: str, body: bytes, content_type: str) -> None:
        self.objects[object_key] = (body, content_type)

    def download(self, object_key: str):
        raise AssertionError('vacation flow never touches object storage')


class HashEmbeddingProvider:
    def embed(self, texts: list[str]) -> list[list[float]]:
        import hashlib

        return [[float(byte) for byte in hashlib.sha256(text.encode()).digest()[:32]] for text in texts]


class ScriptedProvider:
    """FakeBotProvider shape: records prompts, pops scripted answers, optional error."""

    def __init__(self, answers: list[str] | None = None, error: BotProviderError | None = None):
        self.answers = list(answers or [])
        self.error = error
        self.calls: list[list[dict]] = []

    def complete(self, messages: list[dict]) -> str:
        self.calls.append(messages)
        if self.error is not None:
            raise self.error
        if not self.answers:
            raise AssertionError('scripted provider ran out of answers')
        return self.answers.pop(0)


pytestmark = pytest.mark.anyio

OFFER = 'Хотите узнать свои даты по графику отпусков?'
PERIOD_LINES = [
    'Абрикосов Т.П. с 20.04.2026 на 7 дней',
    'Абрикосов Т.П. с 03.08.2026 на 14 дней',
    'Абрикосов Т.П. с 21.12.2026 на 7 дней',
]


def seed_schedule(session_factory) -> None:
    with session_factory() as session:
        schedule = VacationSchedule(source_name='график отпусков 2026.xlsx', year=2026, row_count=3)
        session.add(schedule)
        session.flush()
        session.add_all(
            VacationPeriod(
                schedule_id=schedule.id,
                full_name='Абрикосов Т.П.',
                department='Департамент Альфа',
                position='Инженер',
                start_date=start,
                days=days,
            )
            for start, days in (
                (date(2026, 4, 20), 7),
                (date(2026, 8, 3), 14),
                (date(2026, 12, 21), 7),
            )
        )
        session.add(
            VacationPeriod(
                schedule_id=schedule.id,
                full_name='Вишневский О.Н.',
                department='Департамент Альфа',
                position='Инженер',
                start_date=date(2026, 4, 29),
                days=14,
            )
        )
        session.commit()


def bot_ready(app, provider: ScriptedProvider) -> ScriptedProvider:
    app.state.object_storage = MemoryStorage()
    app.state.embedding_provider = HashEmbeddingProvider()
    app.state.bot_provider = provider
    return provider


async def register(client: AsyncClient, email: str) -> dict:
    response = await client.post(
        '/api/v1/auth/register',
        json={'email': email, 'password': 'correct horse battery staple'},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def register_bot(app) -> None:
    from httpx import ASGITransport

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://testserver') as bot_client:
        await register(bot_client, BOT_EMAIL)


async def create_ai_chat(client: AsyncClient) -> int:
    response = await client.post('/api/v1/chats', json={'title': 'AI', 'is_ai': True})
    assert response.status_code == 201, response.text
    return response.json()['id']


async def say(client: AsyncClient, chat_id: int, content: str) -> dict:
    message = await client.post(
        f'/api/v1/chats/{chat_id}/messages',
        json={'content': content, 'client_message_id': f'c-{chat_id}-{content[:10]}-{say.counter}'},
    )
    say.counter += 1
    assert message.status_code == 201, message.text
    run = await client.post(f'/api/v1/chats/{chat_id}/bot/runs', json={'message_id': message.json()['id']})
    assert run.status_code == 200, run.text
    assert run.json()['status'] == 'succeeded', run.text
    return run.json()


say.counter = 0


async def last_bot_reply(client: AsyncClient, chat_id: int, bot_id: int) -> str:
    page = await client.get(f'/api/v1/chats/{chat_id}/messages', params={'limit': 100})
    assert page.status_code == 200
    messages = [message for message in page.json()['messages'] if message['user_id'] == bot_id]
    assert messages, 'the bot did not answer'
    latest = max(messages, key=lambda message: message['id'])
    return latest['content']


def bot_id(session_factory) -> int:
    from app.models import User

    with session_factory() as session:
        return session.scalars(select(User.id).where(User.email == BOT_EMAIL)).one()


def stored_surname(session_factory, user_id: int) -> str | None:
    with session_factory() as session:
        row = session.get(VacationName, user_id)
        return row.schedule_name if row is not None else None


async def test_offer_then_surname_then_answer_and_persistence(client, app, session_factory):
    seed_schedule(session_factory)
    provider = bot_ready(app, ScriptedProvider(error=BotProviderError('provider_unreachable', 'down')))
    await register(client, USER_EMAIL)
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()

    # (1) generic vacation message -> the exact offer, zero LLM calls
    await say(client, chat_id, 'Хочу в отпуск, но не знаю, что спросить')
    assert await last_bot_reply(client, chat_id, bot) == OFFER
    assert provider.calls == []

    # (2) «да» without a surname -> the surname question
    await say(client, chat_id, 'да')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'фамили' in reply
    assert provider.calls == []

    # the template fallback answers with the exact period lines (AC-LLMFMT)
    await say(client, chat_id, 'Абрикосов')
    reply = await last_bot_reply(client, chat_id, bot)
    for line in PERIOD_LINES:
        assert line in reply
    assert stored_surname(session_factory, user['id']) == 'Абрикосов Т.П.'

    # (2b) a NEW chat with an explicit schedule question answers immediately
    other_chat = await create_ai_chat(client)
    await say(client, other_chat, 'Когда у меня отпуск по графику?')
    reply = await last_bot_reply(client, other_chat, bot)
    for line in PERIOD_LINES:
        assert line in reply
    # the surname was not re-asked; every provider call was a vacation-compose
    # attempt that fell back to the template (never a RAG prompt)
    assert len(provider.calls) == 2
    for call in provider.calls:
        prompt = '\n'.join(part['content'] for part in call)
        assert 'Даты отпуска из графика' in prompt
        assert 'You are the Chatty assistant' not in prompt


async def test_explicit_schedule_from_scratch_asks_surname_without_offer(client, app, session_factory):
    seed_schedule(session_factory)
    llm_answer = 'Абрикосов Т.П., ваши отпуска запланированы на апрель, август и декабрь.'
    provider = bot_ready(app, ScriptedProvider(answers=[llm_answer]))
    await register(client, SECOND_USER_EMAIL)
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()

    await say(client, chat_id, 'покажи график отпусков')
    reply = await last_bot_reply(client, chat_id, bot)
    assert reply != OFFER
    assert 'фамили' in reply
    assert provider.calls == []

    # (1b) «да» WITH a stored surname answers immediately through the LLM,
    # and the captured prompt carries the structured lines (AC-LLMFMT);
    # seeding clears the pending awaiting_surname state the question left
    with session_factory() as session:
        from app.vacations.store import VacationStore

        store = VacationStore(session)
        store.save_surname(user['id'], 'Абрикосов Т.П.')
        store.clear_state(user['id'])
        session.commit()

    await say(client, chat_id, 'Хочу в отпуск')
    assert await last_bot_reply(client, chat_id, bot) == OFFER
    await say(client, chat_id, 'да')
    reply = await last_bot_reply(client, chat_id, bot)
    assert reply == llm_answer
    assert len(provider.calls) == 1
    prompt = '\n'.join(part['content'] for part in provider.calls[0])
    for line in PERIOD_LINES:
        assert line in prompt
    assert 'не выдумывай' in prompt
    # the normal RAG path's system prompt must never enter this compose
    assert 'You are the Chatty assistant' not in prompt


async def test_decline_runs_normal_path_with_the_original_question(client, app, session_factory):
    seed_schedule(session_factory)
    provider = bot_ready(
        app,
        ScriptedProvider(answers=['Обычный ответ ассистента про оформление отпуска.']),
    )
    await register(client, 'decline-user@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)

    await say(client, chat_id, 'Как правильно оформить отпуск?')
    assert await last_bot_reply(client, chat_id, bot) == OFFER

    await say(client, chat_id, 'нет')
    reply = await last_bot_reply(client, chat_id, bot)
    assert reply == 'Обычный ответ ассистента про оформление отпуска.'
    # the normal path ran EXACTLY once and its prompt carries the ORIGINAL
    # question, not the word «нет»
    assert len(provider.calls) == 1
    prompt = '\n'.join(part['content'] for part in provider.calls[0])
    assert 'Как правильно оформить отпуск?' in prompt
    assert not prompt.endswith('нет')


async def test_unrelated_message_resets_and_vacation_reoffer_and_cancel(client, app, session_factory):
    seed_schedule(session_factory)
    provider = bot_ready(app, ScriptedProvider(answers=['Ответ про погоду.']))
    await register(client, 'reset-user@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)

    await say(client, chat_id, 'Хочу в отпуск')
    assert await last_bot_reply(client, chat_id, bot) == OFFER

    # a repeated vacation question during awaiting_yes re-offers (the user
    # restated the topic, the origin refreshes)
    await say(client, chat_id, 'А как быть с отпуском летом?')
    assert await last_bot_reply(client, chat_id, bot) == OFFER

    # unrelated NON-vacation message resets the state and takes the normal path
    await say(client, chat_id, 'как погода?')
    assert await last_bot_reply(client, chat_id, bot) == 'Ответ про погоду.'
    assert len(provider.calls) == 1

    # after the reset a fresh vacation message offers again
    await say(client, chat_id, 'Хочу в отпуск')
    assert await last_bot_reply(client, chat_id, bot) == OFFER

    # cancel words exit the surname prompt without burning an attempt
    await say(client, chat_id, 'да')
    assert 'фамили' in await last_bot_reply(client, chat_id, bot)
    await say(client, chat_id, 'отмена')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'позже' in reply


async def test_two_failed_surnames_end_politely(client, app, session_factory):
    seed_schedule(session_factory)
    provider = bot_ready(app, ScriptedProvider())
    await register(client, 'attempts-user@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)

    await say(client, chat_id, 'покажи график отпусков')
    assert 'фамили' in await last_bot_reply(client, chat_id, bot)
    await say(client, chat_id, 'Зюганов')
    first = await last_bot_reply(client, chat_id, bot)
    assert 'нет' in first.lower()
    await say(client, chat_id, 'Зюганова')
    second = await last_bot_reply(client, chat_id, bot)
    assert 'HR' in second
    # the state cleared: the next vacation message offers again
    await say(client, chat_id, 'Хочу в отпуск')
    assert await last_bot_reply(client, chat_id, bot) == OFFER


async def test_stale_stored_surname_recovers_after_reingest(client, app, session_factory):
    seed_schedule(session_factory)
    provider = bot_ready(app, ScriptedProvider(error=BotProviderError('provider_unreachable', 'down')))
    await register(client, 'stale-user@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()

    with session_factory() as session:
        from app.vacations.store import VacationStore

        VacationStore(session).save_surname(user['id'], 'Абрикосов Т.П.')
        session.commit()

    # the schedule is re-ingested WITHOUT this person
    with session_factory() as session:
        session.execute(delete(VacationPeriod).where(VacationPeriod.full_name == 'Абрикосов Т.П.'))
        session.commit()

    await say(client, chat_id, 'Когда у меня отпуск по графику?')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'обновился' in reply
    assert 'фамили' in reply
    assert stored_surname(session_factory, user['id']) is None

    # the re-ask accepts a person who IS in the refreshed snapshot
    await say(client, chat_id, 'Вишневский')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'Вишневский О.Н. с 29.04.2026 на 14 дней' in reply


async def test_cancel_at_the_offer_and_ambiguous_surname_and_refreshed_origin(client, app, session_factory):
    seed_schedule(session_factory)
    provider = bot_ready(
        app,
        ScriptedProvider(
            answers=[
                'Ответ на переформулированный вопрос.',
                'Вишневский А.А., ваш отпуск начинается первого июля.',
            ]
        ),
    )
    await register(client, 'branches-user@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)

    # cancel works at the OFFER prompt too (AC-FLOW 5: «на любом шаге»)
    await say(client, chat_id, 'Хочу в отпуск')
    assert await last_bot_reply(client, chat_id, bot) == OFFER
    await say(client, chat_id, 'отмена')
    assert 'не буду' in await last_bot_reply(client, chat_id, bot)
    await say(client, chat_id, 'Хочу в отпуск')
    assert await last_bot_reply(client, chat_id, bot) == OFFER

    # a re-offer refreshes the origin: the decline must carry the RESTATEMENT
    await say(client, chat_id, 'Как оформить отпуск на май?')
    assert await last_bot_reply(client, chat_id, bot) == OFFER
    await say(client, chat_id, 'А как оформить отпуск на июль?')
    assert await last_bot_reply(client, chat_id, bot) == OFFER
    await say(client, chat_id, 'нет')
    assert await last_bot_reply(client, chat_id, bot) == 'Ответ на переформулированный вопрос.'
    prompt = '\n'.join(part['content'] for part in provider.calls[0])
    assert 'А как оформить отпуск на июль?' in prompt
    assert 'Как оформить отпуск на май?' not in prompt

    # the ambiguous surname branch lists candidates and resolves by initials
    with session_factory() as session:
        schedule = session.scalars(select(VacationSchedule)).one()
        session.add(
            VacationPeriod(
                schedule_id=schedule.id,
                full_name='Вишневский А.А.',
                department='Департамент Бета',
                position='Инженер',
                start_date=date(2026, 7, 1),
                days=7,
            )
        )
        session.commit()

    await say(client, chat_id, 'покажи график отпусков')
    assert 'фамили' in await last_bot_reply(client, chat_id, bot)
    await say(client, chat_id, 'Вишневский')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'Вишневский О.Н. (Департамент Альфа)' in reply
    assert 'Вишневский А.А. (Департамент Бета)' in reply
    await say(client, chat_id, 'Вишневский А.А.')
    reply = await last_bot_reply(client, chat_id, bot)
    assert reply == 'Вишневский А.А., ваш отпуск начинается первого июля.'
    assert 'Вишневский О.Н.' not in reply


async def test_third_party_vacation_question_gets_own_dates_offer_only(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    provider = bot_ready(app, ScriptedProvider())
    await register(client, 'privacy-user@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)

    await say(client, chat_id, 'Когда отпуск у Иванова?')
    assert await last_bot_reply(client, chat_id, bot) == OFFER

    # no lookup by the third-party surname ever happened: spy on the service
    find_calls: list[str] = []
    original_find = VacationService.find

    def spy_find(self, query: str):
        find_calls.append(query)
        return original_find(self, query)

    monkeypatch.setattr(VacationService, 'find', spy_find)
    from app.vacations.skill import VacationSkill

    with session_factory() as session:
        outcome = VacationSkill(session, provider).handle(content='отпуск Иванова, покажи', user_id=999999)
    assert outcome is not None and outcome.reply == OFFER
    assert find_calls == []
