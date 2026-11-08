"""Vacation forms dialog scenarios through the real bot pipeline (AC-WIZARD/AC-DELIVER).

The pipeline runs with the FakeBotProvider seam (the test_vacation_skill_flow
precedent) plus a Memory object storage: the generated RTF travels through
the REAL FileService (upload + chat-scoped file row + MessageCreate file_id)
and the wizard texts are fully deterministic — the LLM never runs.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from app.models import AssistantDialogState, User, VacationName, VacationPeriod, VacationSchedule
from app.vacations.forms.rtf import escape_rtf_text
from app.vacations.forms.skill import MAX_STATE_LEN, STEP_DICTIONARY
from app.vacations.store import VacationStore

BOT_EMAIL = 'bot@chatty.local'
ORG = 'ООО «Альфа-Тех»'
ADDRESSEE = 'Смирнову А.А.'


class MemoryStorage:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}

    def upload(self, object_key: str, body: bytes, content_type: str) -> None:
        self.objects[object_key] = (body, content_type)

    def download(self, object_key: str):
        raise AssertionError('forms tests never download')

    def delete(self, object_key: str) -> None:
        self.objects.pop(object_key, None)


class HashEmbeddingProvider:
    def embed(self, texts: list[str]) -> list[list[float]]:
        import hashlib

        return [[float(byte) for byte in hashlib.sha256(text.encode()).digest()[:32]] for text in texts]


class ScriptedProvider:
    def __init__(self, answers: list[str] | None = None):
        self.answers = list(answers or [])
        self.calls: list[list[dict]] = []

    def complete(self, messages: list[dict]) -> str:
        self.calls.append(messages)
        if not self.answers:
            return 'Обычный ответ ассистента.'
        return self.answers.pop(0)


pytestmark = pytest.mark.anyio


def seed_schedule(session_factory) -> None:
    with session_factory() as session:
        schedule = VacationSchedule(source_name='график отпусков 2026.xlsx', year=2026, row_count=4)
        session.add(schedule)
        session.flush()
        session.add_all(
            VacationPeriod(
                schedule_id=schedule.id,
                full_name='Абрикосов Т.П.',
                department='Департамент Альфа',
                position='Финансовый менеджер',
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


def requisites_ready(monkeypatch) -> None:
    monkeypatch.setenv('CHATTY_VACATION_ORG_NAME', ORG)
    monkeypatch.setenv('CHATTY_VACATION_ADDRESSEE_NAME', ADDRESSEE)


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
        json={'content': content, 'client_message_id': f'f-{chat_id}-{content[:12]}-{say.counter}'},
    )
    say.counter += 1
    assert message.status_code == 201, message.text
    run = await client.post(f'/api/v1/chats/{chat_id}/bot/runs', json={'message_id': message.json()['id']})
    assert run.status_code == 200, run.text
    return run.json()


say.counter = 0


async def last_bot_message(client: AsyncClient, chat_id: int, bot_id: int) -> dict:
    page = await client.get(f'/api/v1/chats/{chat_id}/messages', params={'limit': 100})
    assert page.status_code == 200
    messages = [message for message in page.json()['messages'] if message['user_id'] == bot_id]
    assert messages, 'the bot did not answer'
    return max(messages, key=lambda message: message['id'])


async def last_bot_reply(client: AsyncClient, chat_id: int, bot_id: int) -> str:
    return (await last_bot_message(client, chat_id, bot_id))['content']


def bot_id(session_factory) -> int:
    with session_factory() as session:
        return session.scalars(select(User.id).where(User.email == BOT_EMAIL)).one()


def save_surname(session_factory, user_id: int, name: str) -> None:
    with session_factory() as session:
        VacationStore(session).save_surname(user_id, name)
        session.commit()


def dialog_state(session_factory, user_id: int):
    with session_factory() as session:
        row = session.get(AssistantDialogState, user_id)
        return (row.state, row.payload) if row is not None else None


def only_uploaded_body(storage: MemoryStorage) -> bytes:
    assert len(storage.objects) == 1, storage.objects.keys()
    body, content_type = next(iter(storage.objects.values()))
    assert content_type == 'application/rtf'
    return body


# --- unit-level pins -------------------------------------------------------------


def test_step_dictionary_fits_the_state_column() -> None:
    # D-F-11/F-R1-5: the dictionary is closed and every step fits String(32)
    assert len(STEP_DICTIONARY) == 18  # 3 kinds x 6 steps
    for state in STEP_DICTIONARY:
        assert len(state) <= MAX_STATE_LEN, state


# --- dialogs ----------------------------------------------------------------------


async def test_vacation_wizard_single_period_full_flow(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    requisites_ready(monkeypatch)
    storage = bot_ready(app, ScriptedProvider())
    await register(client, 'forms-vacation@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()

    await say(client, chat_id, 'оформи заявление на отпуск')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'фамили' in reply  # no stored surname -> the shared surname step

    await say(client, chat_id, 'Вишневский')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'с 29.04.2026 на 14 дней' in reply
    assert 'да' in reply

    await say(client, chat_id, 'да')  # confirm the period
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'с 29.04' in reply and 'Оформить' in reply

    run = await say(client, chat_id, 'да')  # the summary confirm
    assert run['status'] == 'succeeded'
    assert run['attachment_file_id'] is not None
    message = await last_bot_message(client, chat_id, bot)
    assert message['file_id'] is not None
    assert message['file_name'] == 'Заявление на отпуск — Вишневский О.Н..rtf'
    body = only_uploaded_body(app.state.object_storage)
    text = body.decode('latin-1')
    assert escape_rtf_text(ORG) in text
    assert escape_rtf_text(ADDRESSEE) in text
    assert escape_rtf_text('Вишневский О.Н.') in text
    assert escape_rtf_text('Инженер') in text
    assert '29.04' in text and '2026' in text and '14' in text
    # the wizard finished and the surname persisted
    assert dialog_state(session_factory, user['id']) is None
    with session_factory() as session:
        assert session.get(VacationName, user['id']).schedule_name == 'Вишневский О.Н.'


async def test_vacation_wizard_multi_period_choice(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    requisites_ready(monkeypatch)
    bot_ready(app, ScriptedProvider())
    await register(client, 'forms-choice@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()
    save_surname(session_factory, user['id'], 'Абрикосов Т.П.')

    await say(client, chat_id, 'нужно заявление на отпуск')
    reply = await last_bot_reply(client, chat_id, bot)
    assert '1)' in reply and '2)' in reply and '3)' in reply

    await say(client, chat_id, '2')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'с 03.08' in reply and 'Оформить' in reply  # straight to the summary

    run = await say(client, chat_id, 'да')
    assert run['status'] == 'succeeded'
    body = only_uploaded_body(app.state.object_storage).decode('latin-1')
    assert '03.08' in body and '14' in body


async def test_vacation_wizard_custom_dates(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    requisites_ready(monkeypatch)
    bot_ready(app, ScriptedProvider())
    await register(client, 'forms-custom@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()
    save_surname(session_factory, user['id'], 'Вишневский О.Н.')

    await say(client, chat_id, 'оформи заявление на отпуск')
    await last_bot_reply(client, chat_id, bot)  # the period question
    await say(client, chat_id, 'с 05.02.2026 на 10 дней')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'с 05.02' in reply and '10 календарных дней' in reply

    run = await say(client, chat_id, 'да')
    assert run['status'] == 'succeeded'
    body = only_uploaded_body(app.state.object_storage).decode('latin-1')
    assert '05.02' in body and '10' in body


async def test_transfer_wizard_days_default_to_old(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    requisites_ready(monkeypatch)
    bot_ready(app, ScriptedProvider())
    await register(client, 'forms-transfer@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()
    save_surname(session_factory, user['id'], 'Абрикосов Т.П.')

    await say(client, chat_id, 'хочу перенести отпуск')
    reply = await last_bot_reply(client, chat_id, bot)
    assert '1)' in reply  # the old period comes from the schedule first

    await say(client, chat_id, '1')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'по умолчанию 7' in reply

    await say(client, chat_id, 'с 05.02.2026')  # days omitted -> default 7
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'вместо' in reply and 'с 05.02.2026' in reply and '7 календарных дней' in reply

    run = await say(client, chat_id, 'да')
    assert run['status'] == 'succeeded'
    body = only_uploaded_body(app.state.object_storage).decode('latin-1')
    assert '20.04.2026' in body  # the old period rendered DD.MM.YYYY
    assert '05.02.2026' in body  # the new period is a full date


async def test_unpaid_wizard_requires_days_and_morphology(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    requisites_ready(monkeypatch)
    bot_ready(app, ScriptedProvider())
    await register(client, 'forms-unpaid@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()
    save_surname(session_factory, user['id'], 'Абрикосов Т.П.')

    await say(client, chat_id, 'нужен отпуск за свой счёт')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'календарных дней' in reply

    await say(client, chat_id, 'с 16.11.2026')  # days missing -> ask again
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'календарных дней' in reply or 'Не понял дату' in reply

    await say(client, chat_id, 'с 16.11.2026 на 3 дня')
    reply = await last_bot_reply(client, chat_id, bot)
    assert '3 календарных дня' in reply  # F-R1-3: the agreed phrase

    run = await say(client, chat_id, 'да')
    assert run['status'] == 'succeeded'
    body = only_uploaded_body(app.state.object_storage).decode('latin-1')
    assert '16.11.2026' in body
    assert escape_rtf_text('календарных дня') in body


async def test_decline_at_final_confirm_posts_no_file(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    requisites_ready(monkeypatch)
    bot_ready(app, ScriptedProvider())
    await register(client, 'forms-decline@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()
    save_surname(session_factory, user['id'], 'Вишневский О.Н.')

    await say(client, chat_id, 'оформи заявление на отпуск')
    await say(client, chat_id, 'да')  # accept the only schedule period
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'Оформить' in reply  # the summary confirm
    run = await say(client, chat_id, 'нет')  # declined at the summary
    assert run['status'] == 'succeeded'
    assert run['attachment_file_id'] is None
    assert app.state.object_storage.objects == {}
    assert dialog_state(session_factory, user['id']) is None


async def test_cancel_mid_wizard_then_normal_path(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    requisites_ready(monkeypatch)
    provider = bot_ready(app, ScriptedProvider())
    await register(client, 'forms-cancel@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()
    save_surname(session_factory, user['id'], 'Абрикосов Т.П.')

    await say(client, chat_id, 'нужно заявление на отпуск')
    await say(client, chat_id, 'отмена')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'отменяю' in reply
    assert dialog_state(session_factory, user['id']) is None

    # the very next ordinary question takes the normal RAG path (AC-WIZARD 7)
    await say(client, chat_id, 'какая сейчас погода на Марсе?')
    reply = await last_bot_reply(client, chat_id, bot)
    assert provider.calls  # the normal path ran
    prompt = '\n'.join(part['content'] for part in provider.calls[-1])
    assert 'погода' in prompt


async def test_form_message_pivots_parent_awaiting_yes(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    requisites_ready(monkeypatch)
    bot_ready(app, ScriptedProvider())
    await register(client, 'forms-pivot@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()

    await say(client, chat_id, 'Хочу в отпуск')
    assert await last_bot_reply(client, chat_id, bot) == 'Хотите узнать свои даты по графику отпусков?'

    # a wizard phrasing during awaiting_yes starts the wizard and clears the parent state
    await say(client, chat_id, 'оформи заявление на отпуск')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'фамили' in reply  # the wizard owns the dialog now
    state, payload = dialog_state(session_factory, user['id'])
    assert state == 'form:vacation:surname'


async def test_missing_surname_resolves_inside_the_wizard(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    requisites_ready(monkeypatch)
    bot_ready(app, ScriptedProvider())
    await register(client, 'forms-surname@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()

    await say(client, chat_id, 'заявление на отпуск')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'фамили' in reply

    await say(client, chat_id, 'Абрикосов')
    reply = await last_bot_reply(client, chat_id, bot)
    assert '1)' in reply  # the periods list — the wizard continued
    with session_factory() as session:
        assert session.get(VacationName, user['id']).schedule_name == 'Абрикосов Т.П.'


async def test_two_bad_dates_end_the_wizard_politely(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    requisites_ready(monkeypatch)
    bot_ready(app, ScriptedProvider())
    await register(client, 'forms-baddate@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()
    save_surname(session_factory, user['id'], 'Абрикосов Т.П.')

    await say(client, chat_id, 'отпуск без сохранения зарплаты')
    await say(client, chat_id, 'абракадабра')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'Не понял дату' in reply
    await say(client, chat_id, 'ещё раз абракадабра')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'Начните заново' in reply
    assert dialog_state(session_factory, user['id']) is None


async def test_ttl_expired_state_behaves_as_absent(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    requisites_ready(monkeypatch)
    bot_ready(app, ScriptedProvider())
    await register(client, 'forms-ttl@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()
    save_surname(session_factory, user['id'], 'Абрикосов Т.П.')

    await say(client, chat_id, 'нужно заявление на отпуск')
    with session_factory() as session:
        stale = datetime.now(UTC) - timedelta(seconds=3600)
        session.execute(
            update(AssistantDialogState)
            .where(AssistantDialogState.user_id == user['id'])
            .values(updated_at=stale)
        )
        session.commit()

    # a fresh ordinary message: no wizard continuation, the normal path runs
    await say(client, chat_id, 'расскажи анекдот')
    reply = await last_bot_reply(client, chat_id, bot)
    assert '1)' not in reply  # not the periods list


async def test_third_party_phrasing_gets_only_the_own_flow(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    requisites_ready(monkeypatch)
    bot_ready(app, ScriptedProvider())
    await register(client, 'forms-third@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()

    await say(client, chat_id, 'заявление на отпуск для Иванова')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'фамили' in reply  # the OWN surname question, never Иванов's dates
    with session_factory() as session:
        assert session.get(VacationName, user['id']) is None


async def test_unset_requisites_refuse_without_state(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    monkeypatch.delenv('CHATTY_VACATION_ORG_NAME', raising=False)
    monkeypatch.delenv('CHATTY_VACATION_ADDRESSEE_NAME', raising=False)
    bot_ready(app, ScriptedProvider())
    await register(client, 'forms-noreq@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)
    user = (await client.get('/api/v1/auth/me')).json()

    await say(client, chat_id, 'оформи заявление на отпуск')
    reply = await last_bot_reply(client, chat_id, bot)
    assert 'реквизиты' in reply
    assert 'vacation-forms.md' in reply
    assert dialog_state(session_factory, user['id']) is None


async def test_parent_vacation_offer_still_works(client, app, session_factory, monkeypatch):
    seed_schedule(session_factory)
    requisites_ready(monkeypatch)
    provider = bot_ready(app, ScriptedProvider())
    await register(client, 'forms-regress@example.com')
    await register_bot(app)
    chat_id = await create_ai_chat(client)
    bot = bot_id(session_factory)

    # the parent flow is untouched: a generic vacation message offers dates
    await say(client, chat_id, 'Хочу в отпуск')
    assert await last_bot_reply(client, chat_id, bot) == 'Хотите узнать свои даты по графику отпусков?'
    # and the decline runs the normal path with the original question
    run = await say(client, chat_id, 'нет')
    assert run['status'] == 'succeeded'
    assert provider.calls
    prompt = '\n'.join(part['content'] for part in provider.calls[-1])
    assert 'Хочу в отпуск' in prompt
