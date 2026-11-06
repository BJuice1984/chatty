"""Extended PUT /chats/{id} (013): the is_ai toggle with the NEW
'chat_ai_toggled' broadcast, the empty-payload 422 and the auto_titled
clearing on a manual rename. The service-layer fan-out rule is pinned
structurally: no file under app/services imports app.ws.hub (review F-5)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.anyio

PASSWORD = 'correct horse battery staple'
ORIGIN = {'Origin': 'http://localhost:3000'}


async def register(client, email: str) -> dict:
    response = await client.post(
        '/api/v1/auth/register',
        json={'email': email, 'password': PASSWORD},
    )
    assert response.status_code == 201
    return response.json()


async def chat_list(client) -> dict[int, dict]:
    response = await client.get('/api/v1/chats')
    assert response.status_code == 200
    return {chat['id']: chat for chat in response.json()}


def user_client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')


def assert_alive(websocket) -> None:
    websocket.send_json({'type': 'ping', 'content': {}})
    assert websocket.receive_json() == {'type': 'pong', 'content': {}}


def set_display_name(session_factory, user_id: int, display_name: str) -> None:
    from app.models.user import User

    session = session_factory()
    try:
        user = session.get(User, user_id)
        assert user is not None
        user.display_name = display_name
        session.commit()
    finally:
        session.close()


def test_no_service_imports_ws_hub():
    """The repo fan-out rule as a structural pin (review F-5): every
    hub.broadcast call lives in endpoints; a service importing app.ws.hub
    would break the layering the 013 plan relies on."""
    services_dir = Path(__file__).resolve().parents[2] / 'app' / 'services'
    offenders = [
        path.name
        for path in services_dir.glob('*.py')
        if 'app.ws.hub' in path.read_text(encoding='utf-8') or 'from app.ws' in path.read_text(encoding='utf-8')
    ]
    assert offenders == []


async def test_ai_toggle_flips_flag_and_broadcasts(client):
    await register(client, 'ai-owner@example.com')
    chat_id = (await client.post('/api/v1/chats', json={'title': 'Чат с', 'auto_titled': True})).json()['id']

    response = await client.put(f'/api/v1/chats/{chat_id}', json={'is_ai': True})
    assert response.status_code == 200
    body = response.json()
    assert body['is_ai'] is True
    assert body['auto_titled'] is True  # an is_ai flip never touches the title mode
    assert (await chat_list(client))[chat_id]['is_ai'] is True

    # a value-equal repeat: 200, no state change, no second broadcast
    repeat = await client.put(f'/api/v1/chats/{chat_id}', json={'is_ai': True})
    assert repeat.status_code == 200
    assert repeat.json()['is_ai'] is True


async def test_ai_toggle_guards_and_payload_validation(client, app):
    await register(client, 'ai-guard-owner@example.com')
    chat_id = (await client.post('/api/v1/chats', json={'title': 'Guarded'})).json()['id']

    # empty payload 422 (at least one field required)
    assert (await client.put(f'/api/v1/chats/{chat_id}', json={})).status_code == 422
    # blank title 422 (the MessageCreate nonblank precedent)
    assert (await client.put(f'/api/v1/chats/{chat_id}', json={'title': '   '})).status_code == 422

    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'ai-guard-bob@example.com')
        assert (await client.post(f"/api/v1/chats/{chat_id}/members", json={'user_id': bob['id']})).status_code == 201

        # non-member 403
        async with user_client(app) as stranger_client:
            await register(stranger_client, 'ai-guard-stranger@example.com')
            denied = await stranger_client.put(f'/api/v1/chats/{chat_id}', json={'is_ai': True})
            assert denied.status_code == 403
            assert denied.json() == {'detail': 'chat_membership_required'}

        # anonymous 401
        async with user_client(app) as anon:
            assert (await anon.put(f'/api/v1/chats/{chat_id}', json={'is_ai': True})).status_code == 401

        # archived membership is read-only: 403
        assert (await bob_client.post(f'/api/v1/chats/{chat_id}/leave')).status_code == 204
        denied = await bob_client.put(f'/api/v1/chats/{chat_id}', json={'is_ai': True})
        assert denied.status_code == 403
        assert denied.json() == {'detail': 'chat_membership_required'}

    # unknown chat 404
    assert (await client.put('/api/v1/chats/999999', json={'is_ai': True})).status_code == 404


async def test_manual_rename_clears_auto_titled_and_freezes_title(client, app, session_factory):
    """A manual rename permanently disables the auto mode: the flag clears
    on the response, and a follow-up member addition leaves the title
    untouched (the FUTURE-LLM-NAMING precondition)."""
    await register(client, 'manual-owner@example.com')
    chat_id = (await client.post('/api/v1/chats', json={'title': 'Чат с', 'auto_titled': True})).json()['id']

    renamed = await client.put(f'/api/v1/chats/{chat_id}', json={'title': 'Проект X'})
    assert renamed.status_code == 200
    assert renamed.json()['auto_titled'] is False
    assert renamed.json()['title'] == 'Проект X'

    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'manual-bob@example.com')
        set_display_name(session_factory, bob['id'], 'Боб')
        added = await client.post(f"/api/v1/chats/{chat_id}/members", json={'user_id': bob['id']})
        assert added.status_code == 201
        # the manual name is untouchable from now on
        assert (await chat_list(client))[chat_id]['title'] == 'Проект X'


def test_ai_toggle_broadcasts_to_active_members(app):
    """The NEW event: 'chat_ai_toggled' {chat_id, is_ai} reaches ACTIVE
    sockets only; the archived member's socket stays silent, and a
    value-equal repeat broadcasts nothing to anyone."""

    def register_sync(client: TestClient, email: str) -> dict:
        response = client.post(
            '/api/v1/auth/register',
            json={'email': email, 'password': PASSWORD},
        )
        assert response.status_code == 201
        return response.json()

    with TestClient(app) as owner_client, TestClient(app) as bob_client, \
            TestClient(app) as archived_client:
        register_sync(owner_client, 'ai-ws-owner@example.com')
        bob = register_sync(bob_client, 'ai-ws-bob@example.com')
        archived = register_sync(archived_client, 'ai-ws-archived@example.com')
        chat_id = owner_client.post('/api/v1/chats', json={'title': 'AI toggle WS'}).json()['id']
        for user in (bob, archived):
            assert owner_client.post(f"/api/v1/chats/{chat_id}/members", json={'user_id': user['id']}).status_code == 201
        assert archived_client.post(f'/api/v1/chats/{chat_id}/leave').status_code == 204

        with owner_client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as owner_ws, \
                bob_client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as bob_ws, \
                archived_client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as archived_ws:

            response = owner_client.put(f'/api/v1/chats/{chat_id}', json={'is_ai': True})
            assert response.status_code == 200

            for websocket in (owner_ws, bob_ws):
                event = websocket.receive_json()
                assert event == {
                    'type': 'chat_ai_toggled',
                    'content': {'chat_id': chat_id, 'is_ai': True},
                }

            # the archived socket received nothing; a value-equal repeat
            # stays silent for everyone
            assert (owner_client.put(f'/api/v1/chats/{chat_id}', json={'is_ai': True})).status_code == 200
            assert_alive(owner_ws)
            assert_alive(bob_ws)
            assert_alive(archived_ws)


async def test_ai_toggle_seats_the_bot_and_appends_seed(client, app, session_factory):
    """2026-11-06-quick: включение AI сажает бота в участники сразу (не после
    первого ответа), пустой display_name бота становится «AI», а auto_titled
    сид дополняется — «Чат с» -> «Чат с AI» (013-append через display_name)."""
    await register(client, 'toggle-bot-owner@example.com')
    async with user_client(app) as bot_client:
        await register(bot_client, 'bot@chatty.local')

    chat = (await client.post('/api/v1/chats', json={'title': 'Чат с', 'auto_titled': True})).json()

    enabled = await client.put(f"/api/v1/chats/{chat['id']}", json={'is_ai': True})
    assert enabled.status_code == 200
    assert enabled.json()['is_ai'] is True

    members = (await client.get(f"/api/v1/chats/{chat['id']}/members")).json()
    bot_rows = [row for row in members if row['login'] == 'bot@chatty.local']
    assert len(bot_rows) == 1
    assert bot_rows[0]['display_name'] == 'AI'

    listed = await chat_list(client)
    assert listed[chat['id']]['title'] == 'Чат с AI'


async def test_adding_the_bot_member_enables_ai(client, app):
    """2026-11-06-quick: бот, добавленный кнопкой «+», включает чату is_ai —
    «то же самое», что «+AI»: карточка получает ✦AI, участники — бота."""
    await register(client, 'plus-owner@example.com')
    async with user_client(app) as bot_client:
        bot = await register(bot_client, 'bot@chatty.local')

    chat = (await client.post('/api/v1/chats', json={'title': 'Проект', 'is_ai': False})).json()
    added = await client.post(f"/api/v1/chats/{chat['id']}/members", json={'user_id': bot['id']})
    assert added.status_code == 201

    listed = await chat_list(client)
    assert listed[chat['id']]['is_ai'] is True
    assert listed[chat['id']]['title'] == 'Проект'
