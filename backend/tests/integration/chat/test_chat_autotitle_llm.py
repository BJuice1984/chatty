"""One-shot LLM chat auto-naming integration (2026-11-06-llm-chat-autotitle).

Both frontend send paths trigger the background rename: the chat WS message
event and HTTP POST /chats/{id}/messages (the AI-assistant askBot seam).
The rename is quiet (no kind='chat_renamed' row) and one-shot (auto_titled
clears atomically); a manual rename that landed first makes the CAS lose
silently. Single TestClient per test — extra client contexts run
lifespan-shutdown and dispose the shared in-memory engine (the
test_bot_ws_broadcast.py lesson); background waits pump the loop with
history pings instead of fixed sleeps.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.models.chat import Chat

pytestmark = pytest.mark.anyio

PASSWORD = 'correct horse battery staple'
ORIGIN = {'Origin': 'http://localhost:3000'}

LONG_A = 'Подскажи, как настроить Webpack publicPath для CDN-хостинга статики проекта?'
LONG_B = 'Собираю проект, ассеты раздаются со S3, пути ломаются при каждом деплое'


class ScriptedTitleProvider:
    def __init__(self, answers: list[str]):
        self.answers = list(answers)
        self.calls: list[list[dict]] = []

    def complete(self, messages: list[dict]) -> str:
        self.calls.append(messages)
        if not self.answers:
            raise AssertionError('scripted provider ran out of answers')
        return self.answers.pop(0)



@pytest.fixture(autouse=True)
def _reset_autotitle_inflight(app):
    from app.ws.autotitle import _AUTOTITLE_INFLIGHT, _AUTOTITLE_RECHECK

    # тестовый шов: StaticPool даёт один connection на все потоки —
    # параллельный БД-доступ из to_thread и лупа роняет pysqlite; inline
    # сериализует шаги проверки в луп-потоке (прод остаётся на to_thread)
    app.state.autotitle_inline = True
    _AUTOTITLE_INFLIGHT.clear()
    _AUTOTITLE_RECHECK.clear()
    yield
    _AUTOTITLE_INFLIGHT.clear()
    _AUTOTITLE_RECHECK.clear()


def chat_row(session_factory, chat_id: int) -> Chat:
    with session_factory() as session:
        return session.get(Chat, chat_id)


def renamed_rows(session_factory, chat_id: int) -> int:
    from app.models.message import Message

    with session_factory() as session:
        rows = session.execute(
            Message.__table__.select().where(Message.chat_id == chat_id, Message.kind.is_not(None)),
        ).all()
        return len(rows)


def pump_until_renamed(websocket, rounds: int = 12, *, expect_title: str | None = None) -> dict | None:
    """Прокачать loop history-пингами, вылавливая chat_renamed из очереди.

    Каждый пинг — полный оборот event-loop, фоновая задача успевает
    отработать и броадкастить; фиксированных sleep-ов нет. expect_title
    пропускает ЧУЖИЕ переименования (например, фан-аут ручного PUT-rename)
    и ждёт именно указанный титул."""
    for _ in range(rounds):
        websocket.send_json({'type': 'history', 'content': {'limit': 1}})
        while True:
            event = websocket.receive_json()
            if event['type'] == 'chat_renamed':
                if expect_title is None or event['content']['title'] == expect_title:
                    return event['content']
            if event['type'] == 'history':
                break
    return None


def test_ws_path_renames_once_quietly(app, session_factory):
    app.state.bot_provider = ScriptedTitleProvider(answers=['Настройка Webpack CDN'])

    with TestClient(app) as client:
        client.post('/api/v1/auth/register', json={'email': 'ws-owner@example.com', 'password': PASSWORD})
        chat = client.post('/api/v1/chats', json={'title': 'Чат с', 'auto_titled': True}).json()
        chat_id = chat['id']

        with client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as websocket:
            # до порога: одна реплика — прокачка loop не приносит chat_renamed
            websocket.send_json({'type': 'message', 'content': {'content': LONG_A}})
            assert pump_until_renamed(websocket, rounds=6) is None

            # пороговая вторая реплика — фоновое переименование приезжает в сокет
            websocket.send_json({'type': 'message', 'content': {'content': LONG_B}})
            event = pump_until_renamed(websocket)
            assert event is not None
            assert event['chat_id'] == chat_id
            assert event['title'] == 'Настройка Webpack CDN'

            # больше не переименовывается: флаг погашен, scripted-ответов нет
            websocket.send_json({'type': 'message', 'content': {'content': 'Ещё вопрос по теме сборки проекта'}})
            assert pump_until_renamed(websocket, rounds=4) is None

        row = chat_row(session_factory, chat_id)
        assert row.title == 'Настройка Webpack CDN'
        assert row.auto_titled is False
        # тихое переименование: никаких kind-bearing системных строк
        assert renamed_rows(session_factory, chat_id) == 0


def test_http_post_path_triggers_the_same_rename(app, session_factory):
    app.state.bot_provider = ScriptedTitleProvider(answers=['Деплой на S3'])

    with TestClient(app) as client:
        client.post('/api/v1/auth/register', json={'email': 'http-owner@example.com', 'password': PASSWORD})
        chat = client.post('/api/v1/chats', json={'title': 'AI ассистент', 'is_ai': True, 'auto_titled': True}).json()
        chat_id = chat['id']

        with client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as websocket:
            # askBot-сейм ассистента: HTTP POST /messages, а не WS-кадр
            first = client.post(f'/api/v1/chats/{chat_id}/messages', json={'content': LONG_A})
            assert first.status_code == 201
            assert pump_until_renamed(websocket, rounds=6) is None

            second = client.post(f'/api/v1/chats/{chat_id}/messages', json={'content': LONG_B})
            assert second.status_code == 201
            event = pump_until_renamed(websocket)
            assert event is not None
            assert event['title'] == 'Деплой на S3'

        row = chat_row(session_factory, chat_id)
        assert row.title == 'Деплой на S3'
        assert row.auto_titled is False


def test_none_answer_keeps_the_flag_and_later_answer_renames(app, session_factory):
    app.state.bot_provider = ScriptedTitleProvider(answers=['NONE', 'Тема сборки'])

    with TestClient(app) as client:
        client.post('/api/v1/auth/register', json={'email': 'none-owner@example.com', 'password': PASSWORD})
        chat = client.post('/api/v1/chats', json={'title': 'Чат с', 'auto_titled': True}).json()
        chat_id = chat['id']

        with client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as websocket:
            websocket.send_json({'type': 'message', 'content': {'content': LONG_A}})
            assert pump_until_renamed(websocket, rounds=6) is None

            websocket.send_json({'type': 'message', 'content': {'content': LONG_B}})
            # первый ответ NONE — события нет, флаг жив
            assert pump_until_renamed(websocket, rounds=6) is None
            assert chat_row(session_factory, chat_id).auto_titled is True

            # поздний валидный ответ на следующем сообщении переименовывает
            websocket.send_json({'type': 'message', 'content': {'content': 'Расскажи подробнее про деплой сборки'}})
            event = pump_until_renamed(websocket)
            assert event is not None
            assert event['title'] == 'Тема сборки'

        assert chat_row(session_factory, chat_id).auto_titled is False


def test_manual_rename_wins_the_race(app, session_factory):
    app.state.bot_provider = ScriptedTitleProvider(answers=['LLM вариант'])

    with TestClient(app) as client:
        client.post('/api/v1/auth/register', json={'email': 'race-owner@example.com', 'password': PASSWORD})
        chat = client.post('/api/v1/chats', json={'title': 'Чат с', 'auto_titled': True}).json()
        chat_id = chat['id']

        with client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as websocket:
            websocket.send_json({'type': 'message', 'content': {'content': LONG_A}})
            assert pump_until_renamed(websocket, rounds=4) is None

            # ручной rename до порога гасит флаг (013-семантика PUT); его
            # собственный фан-аут chat_renamed приходит в сокет — это НЕ LLM
            renamed = client.put(f'/api/v1/chats/{chat_id}', json={'title': 'Моё название'})
            assert renamed.status_code == 200
            assert renamed.json()['auto_titled'] is False
            manual_event = pump_until_renamed(websocket, rounds=4, expect_title='Моё название')
            assert manual_event is not None, 'manual rename must fan out'

            # пороговая реплика при погашенном флаге: LLM-переименования нет
            websocket.send_json({'type': 'message', 'content': {'content': LONG_B}})
            assert pump_until_renamed(websocket, rounds=6) is None

        row = chat_row(session_factory, chat_id)
        assert row.title == 'Моё название'
        assert row.auto_titled is False


def test_ai_rename_broadcasts_the_notice_message(app, session_factory):
    """2026-11-06-quick: при зарегистрированном бот-юзере переименование
    сопровождается служебной строкой ленты («AI назвал чат …», kind ручного
    rename) — рядом с chat_renamed в сокет приезжает и message-событие."""
    app.state.bot_provider = ScriptedTitleProvider(answers=['Webpack CDN'])
    from app.core.security import hash_password
    from app.models.user import User

    with session_factory() as session:
        session.add(User(email='bot@chatty.local', password_hash=hash_password('not-a-real-login-hash')))
        session.commit()

    with TestClient(app) as client:
        client.post('/api/v1/auth/register', json={'email': 'notice-owner@example.com', 'password': PASSWORD})
        chat = client.post('/api/v1/chats', json={'title': 'Чат с', 'auto_titled': True}).json()
        chat_id = chat['id']

        with client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as websocket:
            websocket.send_json({'type': 'message', 'content': {'content': LONG_A}})
            assert pump_until_renamed(websocket, rounds=6) is None
            websocket.send_json({'type': 'message', 'content': {'content': LONG_B}})

            # собираем ОБА кадра фоновой пары: message(kind) приезжает ДО
            # chat_renamed (порядок броадкастов планировщика)
            notice = None
            renamed = None
            for _ in range(12):
                websocket.send_json({'type': 'history', 'content': {'limit': 1}})
                while True:
                    payload = websocket.receive_json()
                    if payload['type'] == 'message' and payload['content'].get('kind') == 'chat_renamed':
                        notice = payload['content']
                    if payload['type'] == 'chat_renamed':
                        renamed = payload['content']
                    if payload['type'] == 'history':
                        break
                if notice is not None and renamed is not None:
                    break
            assert renamed is not None
            assert renamed['title'] == 'Webpack CDN'
            assert notice is not None
            assert notice['content'] == 'AI назвал чат «Webpack CDN» по теме диалога'

        assert renamed_rows(session_factory, chat_id) == 1
