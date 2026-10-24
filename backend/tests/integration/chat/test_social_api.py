"""Social contracts: user search, chat deletion, reactions and replies."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from starlette.websockets import WebSocketDisconnect

from app.models.bot_run import BotRun
from app.models.chat import Chat, ChatMember
from app.models.doc_chunk import DocChunk
from app.models.document import Document
from app.models.file import File
from app.models.message import Message
from app.models.reaction import Reaction

pytestmark = pytest.mark.anyio

PASSWORD = 'correct horse battery staple'
ORIGIN = {'Origin': 'http://localhost:3000'}


async def register(client, email: str) -> dict:
    response = await client.post('/api/v1/auth/register', json={'email': email, 'password': PASSWORD})
    assert response.status_code == 201
    return response.json()


def register_sync(client: TestClient, email: str) -> dict:
    response = client.post('/api/v1/auth/register', json={'email': email, 'password': PASSWORD})
    assert response.status_code == 201
    return response.json()


def enable_sqlite_foreign_keys(app) -> None:
    """Включает FK-принуждение на единственном соединении StaticPool.

    Каскады удаления чата — уровень БД, поэтому без pragma SQLite их не выполнит.
    """

    with app.state.session_factory() as session:
        session.execute(text('PRAGMA foreign_keys=ON'))


def count_rows(session, model, *predicates) -> int:
    statement = select(func.count()).select_from(model)
    if predicates:
        statement = statement.where(*predicates)
    return session.scalar(statement)


def seed_chat_dependencies(app, chat_id: int, owner_id: int) -> int:
    """Прямая посадка зависимых строк: file/document/chunks/message/reaction/bot_run."""

    with app.state.session_factory() as session:
        file = File(
            chat_id=chat_id,
            owner_id=owner_id,
            object_key=f'chat/{chat_id}/seed.bin',
            original_name='seed.bin',
            content_type='application/octet-stream',
            size_bytes=9,
            status='ready',
        )
        session.add(file)
        session.flush()
        message = Message(chat_id=chat_id, user_id=owner_id, content='doomed message')
        session.add(message)
        session.flush()
        session.add(Reaction(message_id=message.id, user_id=owner_id, emoji='👍'))
        document = Document(file_id=file.id, chat_id=chat_id, owner_id=owner_id, status='ready', chunk_count=1)
        session.add(document)
        session.flush()
        session.add(
            DocChunk(
                document_id=document.id,
                chat_id=chat_id,
                file_id=file.id,
                ordinal=0,
                content='doomed chunk',
                embedding=[0.5],
            ),
        )
        session.add(BotRun(chat_id=chat_id, message_id=message.id, status='succeeded'))
        session.commit()
        return message.id


async def test_users_search_rules_and_shape(client, app):
    cookie_name = app.state.settings.access_cookie_name
    owner = await register(client, 'searcher@example.com')
    owner_cookie = client.cookies.get(cookie_name)
    alice = await register(client, 'alice@example.com')
    await register(client, 'bob@example.com')
    await register(client, 'bobby@example.com')
    for index in range(12):
        await register(client, f'crowd{index:02d}@example.com')
    # после регистраций jar держит последнего созданного — возвращаем владельца
    client.cookies.set(cookie_name, owner_cookie)

    # анонимный поиск запрещён
    anonymous = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    assert (await anonymous.get('/api/v1/users', params={'login': 'a'})).status_code == 401
    await anonymous.aclose()

    # параметр обязателен
    assert (await client.get('/api/v1/users')).status_code == 422

    # собственная запись исключена: email владельца начинается с "search", других таких нет
    mine = await client.get('/api/v1/users', params={'login': 'search'})
    assert mine.status_code == 200
    assert mine.json() == []

    # регистронезависимый префикс и форма ответа: login — полный email, display_name — local-part
    found = await client.get('/api/v1/users', params={'login': 'ALI'})
    assert found.status_code == 200
    assert found.json() == [
        {'id': alice['id'], 'login': 'alice@example.com', 'display_name': 'alice'},
    ]

    # несколько совпадений, детерминированный порядок
    bob = await client.get('/api/v1/users', params={'login': 'bob'})
    assert [item['login'] for item in bob.json()] == ['bob@example.com', 'bobby@example.com']
    assert all(item['display_name'] == item['login'].split('@')[0] for item in bob.json())

    # префикс матчится и по доменной части полного email
    domain = await client.get('/api/v1/users', params={'login': 'alice@ex'})
    assert [item['login'] for item in domain.json()] == ['alice@example.com']

    # лимит 10 при 12 кандидатах
    crowd = await client.get('/api/v1/users', params={'login': 'crowd'})
    logins = [item['login'] for item in crowd.json()]
    assert len(logins) == 10
    assert logins == sorted(logins)
    assert logins[0] == 'crowd00@example.com'

    # LIKE-спецсимволы в префиксе трактуются буквально
    assert (await client.get('/api/v1/users', params={'login': 'b%b'})).json() == []
    assert (await client.get('/api/v1/users', params={'login': 'a_ice'})).json() == []

    assert owner['id'] != alice['id']


def test_chat_delete_policy_broadcast_close_and_cascades(app):
    enable_sqlite_foreign_keys(app)
    cookie_name = app.state.settings.access_cookie_name

    with TestClient(app) as client:
        owner = register_sync(client, 'delete-owner@example.com')
        owner_cookie = client.cookies.get(cookie_name)
        chat = client.post('/api/v1/chats', json={'title': 'Doomed'}).json()
        chat_id = chat['id']

        client.cookies.clear()
        member = register_sync(client, 'delete-member@example.com')
        member_cookie = client.cookies.get(cookie_name)

        # приглашение участника и зависимые строки — от владельца
        client.cookies.set(cookie_name, owner_cookie)
        assert client.post(f'/api/v1/chats/{chat_id}/members', json={'user_id': member['id']}).status_code == 201
        message_id = seed_chat_dependencies(app, chat_id, owner['id'])

        # аноним — 401
        client.cookies.clear()
        assert client.delete(f'/api/v1/chats/{chat_id}').status_code == 401

        # участник, но не владелец — 403
        client.cookies.set(cookie_name, member_cookie)
        refused = client.delete(f'/api/v1/chats/{chat_id}')
        assert refused.status_code == 403
        assert refused.json()['detail'] == 'chat_owner_required'

        # несуществующий чат — 404
        client.cookies.set(cookie_name, owner_cookie)
        assert client.delete('/api/v1/chats/999999').status_code == 404

        # живой сокет участника: сначала событие, затем закрытие сервером
        client.cookies.set(cookie_name, member_cookie)
        with client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as websocket:
            client.cookies.set(cookie_name, owner_cookie)
            assert client.delete(f'/api/v1/chats/{chat_id}').status_code == 204
            assert websocket.receive_json() == {'type': 'chat_deleted', 'content': {'chat_id': chat_id}}
            with pytest.raises(WebSocketDisconnect):
                websocket.receive_json()

        assert client.get(f'/api/v1/chats/{chat_id}').status_code == 404

        # каскады БД сняли все зависимые строки; пользователи (RESTRICT) целы
        with app.state.session_factory() as session:
            assert session.get(Chat, chat_id) is None
            assert session.get(Message, message_id) is None
            assert count_rows(session, ChatMember, ChatMember.chat_id == chat_id) == 0
            assert count_rows(session, Message, Message.chat_id == chat_id) == 0
            assert count_rows(session, File, File.chat_id == chat_id) == 0
            assert count_rows(session, Document, Document.chat_id == chat_id) == 0
            assert count_rows(session, DocChunk, DocChunk.chat_id == chat_id) == 0
            assert count_rows(session, BotRun, BotRun.chat_id == chat_id) == 0
            assert count_rows(session, Reaction) == 0


def test_reactions_toggle_validation_broadcast_and_summaries(app):
    cookie_name = app.state.settings.access_cookie_name

    with TestClient(app) as client:
        owner = register_sync(client, 'reaction-owner@example.com')
        owner_cookie = client.cookies.get(cookie_name)
        chat = client.post('/api/v1/chats', json={'title': 'Reactions'}).json()
        chat_id = chat['id']

        client.cookies.clear()
        member = register_sync(client, 'reaction-member@example.com')
        member_cookie = client.cookies.get(cookie_name)

        client.cookies.set(cookie_name, owner_cookie)
        assert client.post(f'/api/v1/chats/{chat_id}/members', json={'user_id': member['id']}).status_code == 201
        message = client.post(
            f'/api/v1/chats/{chat_id}/messages',
            json={'content': 'react to me'},
        ).json()
        # сообщение чужого чата — для проверки 404
        other_chat = client.post('/api/v1/chats', json={'title': 'Other'}).json()
        other_message = client.post(
            f"/api/v1/chats/{other_chat['id']}/messages",
            json={'content': 'foreign'},
        ).json()

        reactions_url = f"/api/v1/chats/{chat_id}/messages/{message['id']}/reactions"

        # фиксированный набор: произвольный эмодзи отклонён
        client.cookies.set(cookie_name, member_cookie)
        invalid = client.post(reactions_url, json={'emoji': '🔥'})
        assert invalid.status_code == 400
        assert invalid.json()['detail'] == 'emoji_not_allowed'

        # сообщение из другого чата — 404
        assert (
            client.post(
                f"/api/v1/chats/{chat_id}/messages/{other_message['id']}/reactions",
                json={'emoji': '👍'},
            ).status_code == 404
        )

        # не-участник — 403, аноним — 401
        client.cookies.clear()
        outsider = register_sync(client, 'reaction-outsider@example.com')
        outsider_cookie = client.cookies.get(cookie_name)
        assert client.post(reactions_url, json={'emoji': '👍'}).status_code == 403
        client.cookies.clear()
        assert client.post(reactions_url, json={'emoji': '👍'}).status_code == 401

        # toggle по живому сокету участника
        client.cookies.set(cookie_name, member_cookie)
        with client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as websocket:
            client.cookies.set(cookie_name, owner_cookie)
            first = client.post(reactions_url, json={'emoji': '👍'})
            assert first.status_code == 200
            body = first.json()
            assert body['message_id'] == message['id']
            assert body['active'] is True
            assert body['reactions'] == [{'emoji': '👍', 'count': 1, 'mine': True}]
            assert websocket.receive_json() == {
                'type': 'reaction',
                'content': {
                    'chat_id': chat_id,
                    'message_id': message['id'],
                    'user_id': owner['id'],
                    'emoji': '👍',
                    'active': True,
                },
            }

            # тот же эмодзи от другого участника: count растёт, mine у каждого свой
            client.cookies.set(cookie_name, member_cookie)
            second = client.post(reactions_url, json={'emoji': '👍'})
            assert second.json()['active'] is True
            assert second.json()['reactions'] == [{'emoji': '👍', 'count': 2, 'mine': True}]
            event = websocket.receive_json()
            assert event['type'] == 'reaction'
            assert event['content']['user_id'] == member['id']
            assert event['content']['active'] is True

            # повторный toggle того же пользователя снимает реакцию
            off = client.post(reactions_url, json={'emoji': '👍'})
            assert off.json()['active'] is False
            assert off.json()['reactions'] == [{'emoji': '👍', 'count': 1, 'mine': False}]
            assert websocket.receive_json()['content']['active'] is False

        # сводки едут вместе с историей и зависят от зрителя:
        # осталась реакция владельца, значит mine=True только в его выдаче
        client.cookies.set(cookie_name, owner_cookie)
        owner_view = client.get(f'/api/v1/chats/{chat_id}/messages').json()['messages']
        assert owner_view[0]['reactions'] == [{'emoji': '👍', 'count': 1, 'mine': True}]
        client.cookies.set(cookie_name, member_cookie)
        member_view = client.get(f'/api/v1/chats/{chat_id}/messages').json()['messages']
        assert member_view[0]['reactions'] == [{'emoji': '👍', 'count': 1, 'mine': False}]

        # и в WS-истории
        with client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as websocket:
            websocket.send_json({'type': 'history', 'content': {'limit': 10}})
            history = websocket.receive_json()
            assert history['type'] == 'history'
            assert history['content']['messages'][0]['reactions'] == [
                {'emoji': '👍', 'count': 1, 'mine': False},
            ]

        assert outsider_cookie is not None


def test_replies_validation_snippet_and_ws_contract(app):
    cookie_name = app.state.settings.access_cookie_name

    with TestClient(app) as client:
        owner = register_sync(client, 'reply-owner@example.com')
        chat = client.post('/api/v1/chats', json={'title': 'Replies'}).json()
        chat_id = chat['id']
        parent_content = 'x' * 100
        parent = client.post(
            f'/api/v1/chats/{chat_id}/messages',
            json={'content': parent_content},
        ).json()

        # HTTP-реплай: сниппет — первые 80 символов, посчитанные сервером
        reply = client.post(
            f'/api/v1/chats/{chat_id}/messages',
            json={'content': 'answer', 'reply_to_id': parent['id']},
        )
        assert reply.status_code == 201
        body = reply.json()
        assert body['reply_to_id'] == parent['id']
        assert body['reply_to'] == {
            'id': parent['id'],
            'user_id': owner['id'],
            'snippet': parent_content[:80],
        }
        assert len(body['reply_to']['snippet']) == 80

        # цель реплая обязана быть в том же чате
        other_chat = client.post('/api/v1/chats', json={'title': 'Other'}).json()
        foreign = client.post(
            f"/api/v1/chats/{other_chat['id']}/messages",
            json={'content': 'foreign'},
        ).json()
        cross = client.post(
            f'/api/v1/chats/{chat_id}/messages',
            json={'content': 'bad', 'reply_to_id': foreign['id']},
        )
        assert cross.status_code == 400
        assert cross.json()['detail'] == 'reply_target_invalid'

        # несуществующая цель — тоже 400
        assert (
            client.post(
                f'/api/v1/chats/{chat_id}/messages',
                json={'content': 'bad', 'reply_to_id': 999999},
            ).status_code
            == 400
        )

        # обычное сообщение без реплая несёт null/[]
        history_view = client.get(f'/api/v1/chats/{chat_id}/messages').json()['messages']
        parent_view = next(item for item in history_view if item['id'] == parent['id'])
        assert parent_view['reply_to'] is None
        assert parent_view['reply_to_id'] is None
        assert parent_view['reactions'] == []

        # WS-путь: поле протекает через WebSocketMessageContent и возвращается в broadcast
        with client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as websocket:
            websocket.send_json(
                {
                    'type': 'message',
                    'content': {'content': 'socket reply', 'reply_to_id': parent['id']},
                },
            )
            event = websocket.receive_json()
            assert event['type'] == 'message'
            assert event['content']['reply_to_id'] == parent['id']
            assert event['content']['reply_to']['snippet'] == parent_content[:80]
            assert event['content']['reply_to']['user_id'] == owner['id']

            websocket.send_json({'type': 'history', 'content': {'limit': 10}})
            history = websocket.receive_json()
            assert history['type'] == 'history'
            replied = history['content']['messages'][0]
            assert replied['reply_to']['id'] == parent['id']
            assert replied['reactions'] == []

        assert chat['owner_id'] == owner['id']
