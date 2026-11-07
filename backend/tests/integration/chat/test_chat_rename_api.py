"""PUT /chats/{id}: active-member rename with a persisted system message
(kind='chat_renamed') and the two-payload fan-out — the kind-bearing
'message' event plus 'chat_renamed' — to ACTIVE members only (the
delete_chat filter precedent). Guards: archived member 403 (read-only),
non-member 403, anonymous 401, blank/oversized title 422, identical title
idempotent no-op WITHOUT a second system message."""

from __future__ import annotations

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


async def make_chat(client, title: str) -> int:
    response = await client.post('/api/v1/chats', json={'title': title})
    assert response.status_code == 201
    return response.json()['id']


async def rename(client, chat_id: int, title: str):
    return await client.put(f'/api/v1/chats/{chat_id}', json={'title': title})


async def chat_list(client) -> dict[int, dict]:
    response = await client.get('/api/v1/chats')
    assert response.status_code == 200
    return {chat['id']: chat for chat in response.json()}


async def history(client, chat_id: int) -> dict:
    response = await client.get(f'/api/v1/chats/{chat_id}/messages')
    assert response.status_code == 200
    return response.json()


def assert_alive(websocket) -> None:
    """The NEXT frame on the socket must be the pong: an earlier live push
    (wrongly delivered) would sit in the queue ahead of it."""

    websocket.send_json({'type': 'ping', 'content': {}})
    assert websocket.receive_json() == {'type': 'pong', 'content': {}}


def user_client(app) -> AsyncClient:
    """Fresh cookie jar per user (the test_leave_api idiom)."""
    return AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')


async def test_rename_updates_title_and_persists_system_message(client):
    owner = await register(client, 'rename-owner@example.com')
    chat_id = await make_chat(client, 'Draft title')

    response = await rename(client, chat_id, 'Final title')
    assert response.status_code == 200
    body = response.json()
    assert body['id'] == chat_id
    assert body['title'] == 'Final title'

    # the chat list carries the new title
    assert (await chat_list(client))[chat_id]['title'] == 'Final title'

    # the system message persists in history with the marker, actor and time
    page = await history(client, chat_id)
    assert len(page['messages']) == 1
    system = page['messages'][0]
    assert system['kind'] == 'chat_renamed'
    assert system['user_id'] == owner['id']
    assert 'Final title' in system['content']
    assert 'rename-owner' in system['content']  # actor display_name (email local part)
    assert system['created_at'] is not None


async def test_rename_same_title_is_idempotent_noop_without_second_message(client):
    await register(client, 'rename-idem@example.com')
    chat_id = await make_chat(client, 'Stable')

    once = await rename(client, chat_id, 'Stable')
    assert once.status_code == 200
    assert once.json()['title'] == 'Stable'

    page = await history(client, chat_id)
    assert page['messages'] == []


async def test_rename_guards(client, app):
    await register(client, 'rename-guard-owner@example.com')
    chat_id = await make_chat(client, 'Guarded')

    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'rename-guard-bob@example.com')
        added = await client.post(f'/api/v1/chats/{chat_id}/members', json={'user_id': bob['id']})
        assert added.status_code == 201

        # blank title 422 (strip -> empty), oversized 422
        assert (await rename(client, chat_id, '   ')).status_code == 422
        assert (await rename(client, chat_id, 'x' * 201)).status_code == 422

        # non-member 403; anonymous 401; unknown chat 404
        async with user_client(app) as stranger_client:
            await register(stranger_client, 'rename-stranger@example.com')
            denied = await rename(stranger_client, chat_id, 'Hijack')
            assert denied.status_code == 403
            assert denied.json() == {'detail': 'chat_membership_required'}
        async with user_client(app) as anon:
            assert (await anon.put(f'/api/v1/chats/{chat_id}', json={'title': 'Anon'})).status_code == 401
        assert (await rename(client, 999999, 'Ghost')).status_code == 404

        # any ACTIVE member may rename — not just the owner
        renamed = await rename(bob_client, chat_id, 'Bob was here')
        assert renamed.status_code == 200
        assert renamed.json()['title'] == 'Bob was here'

        # archived membership is read-only: 403, no message
        assert (await bob_client.post(f'/api/v1/chats/{chat_id}/leave')).status_code == 204
        denied = await rename(bob_client, chat_id, 'Archived edit')
        assert denied.status_code == 403
        assert denied.json() == {'detail': 'chat_membership_required'}
        page = await history(client, chat_id)
        # 2026-11-07: строки состава («добавил bob», «bob удалился») + строка
        # переименования Боба — переименованной остаётся одна из трёх
        assert len(page['messages']) == 3
        assert [item['kind'] for item in page['messages']] == [
            'chat_member_left',
            'chat_renamed',
            'chat_member_added',
        ]


def test_rename_broadcasts_message_and_chat_renamed_to_active_only(app):
    """THE fan-out pin: two active sockets receive BOTH payloads (the
    kind-bearing message first, then chat_renamed); the archived member's
    socket stays silent (the two-socket precedent of test_leave_api)."""

    def register_sync(client: TestClient, email: str) -> dict:
        response = client.post(
            '/api/v1/auth/register',
            json={'email': email, 'password': PASSWORD},
        )
        assert response.status_code == 201
        return response.json()

    with TestClient(app) as owner_client, TestClient(app) as bob_client, \
            TestClient(app) as archived_client:
        owner = register_sync(owner_client, 'rename-ws-owner@example.com')
        bob = register_sync(bob_client, 'rename-ws-bob@example.com')
        archived = register_sync(archived_client, 'rename-ws-archived@example.com')
        chat_id = owner_client.post('/api/v1/chats', json={'title': 'WS rename'}).json()['id']
        for user in (bob, archived):
            added = owner_client.post(f'/api/v1/chats/{chat_id}/members', json={'user_id': user['id']})
            assert added.status_code == 201
        assert archived_client.post(f'/api/v1/chats/{chat_id}/leave').status_code == 204

        with owner_client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as owner_ws, \
                bob_client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as bob_ws, \
                archived_client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as archived_ws:

            response = owner_client.put(f'/api/v1/chats/{chat_id}', json={'title': 'Renamed live'})
            assert response.status_code == 200

            for websocket, viewer_id in ((owner_ws, owner['id']), (bob_ws, bob['id'])):
                message = websocket.receive_json()
                assert message['type'] == 'message'
                content = message['content']
                assert content['kind'] == 'chat_renamed'
                assert content['user_id'] == owner['id']
                assert 'Renamed live' in content['content']
                assert content['chat_id'] == chat_id
                # viewer-relative reaction summary shape stays intact
                assert content['reactions'] == []

                renamed = websocket.receive_json()
                assert renamed == {
                    'type': 'chat_renamed',
                    'content': {'chat_id': chat_id, 'title': 'Renamed live'},
                }
                del viewer_id

            # the archived socket received nothing
            assert_alive(archived_ws)


def test_rename_xss_title_stays_a_plain_field(app):
    """The system-message content embeds the caller-controlled title; the
    API is transport-only (escaping is the client's job) — the pin is that
    the title round-trips as a plain JSON string, never interpreted."""

    with TestClient(app) as client:
        client.post(
            '/api/v1/auth/register',
            json={'email': 'rename-xss@example.com', 'password': PASSWORD},
        )
        chat_id = client.post('/api/v1/chats', json={'title': 'Before'}).json()['id']
        payload = '<script>alert(1)</script>'
        response = client.put(f'/api/v1/chats/{chat_id}', json={'title': payload})
        assert response.status_code == 200
        assert response.json()['title'] == payload

        page = client.get(f'/api/v1/chats/{chat_id}/messages').json()
        assert page['messages'][0]['content'].endswith(f'«{payload}»')
