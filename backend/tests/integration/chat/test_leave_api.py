"""Self-leave (archived membership) and owner-kick (hard delete): the two
exit semantics, the read/write guard split and the archived-filtered WS
fan-out. READ paths accept a membership row (active OR archived), WRITE
paths demand an ACTIVE row, mark_read silently no-ops for archived rows,
and live pushes reach active sockets only (the two-socket pin)."""

from __future__ import annotations

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from starlette.websockets import WebSocketDisconnect

from tests.integration.chat.test_media_api import MemoryStorage

pytestmark = pytest.mark.anyio

PASSWORD = 'correct horse battery staple'
ORIGIN = {'Origin': 'http://localhost:3000'}


class OfflineProviders:
    """Stand-ins for the bot run path: the archived guard must fire before
    any provider call, so a call here fails the test loudly."""

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise AssertionError('embedding provider must not be called for an archived member')

    def complete(self, messages: list[dict]) -> str:
        raise AssertionError('bot provider must not be called for an archived member')


async def register(client, email: str) -> dict:
    response = await client.post(
        '/api/v1/auth/register',
        json={'email': email, 'password': PASSWORD},
    )
    assert response.status_code == 201
    return response.json()


def user_client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')


async def make_chat(client, title: str, *, is_ai: bool = False) -> int:
    response = await client.post('/api/v1/chats', json={'title': title, 'is_ai': is_ai})
    assert response.status_code == 201
    return response.json()['id']


async def add_member(client, chat_id: int, user_id: int) -> dict:
    response = await client.post(f'/api/v1/chats/{chat_id}/members', json={'user_id': user_id})
    assert response.status_code == 201
    return response.json()


async def post_message(client, chat_id: int, content: str) -> dict:
    response = await client.post(f'/api/v1/chats/{chat_id}/messages', json={'content': content})
    assert response.status_code == 201
    return response.json()


async def chat_list(client) -> dict[int, dict]:
    response = await client.get('/api/v1/chats')
    assert response.status_code == 200
    return {chat['id']: chat for chat in response.json()}


async def leave(client, chat_id: int):
    return await client.post(f'/api/v1/chats/{chat_id}/leave')


async def kick(client, chat_id: int, user_id: int):
    return await client.delete(f'/api/v1/chats/{chat_id}/members/{user_id}')


def assert_alive(websocket) -> None:
    """The NEXT frame on the socket must be the pong: an earlier live push
    (wrongly delivered) would sit in the queue ahead of it."""

    websocket.send_json({'type': 'ping', 'content': {}})
    assert websocket.receive_json() == {'type': 'pong', 'content': {}}


# --- leave: archive semantics -------------------------------------------------


async def test_leave_archives_membership_and_list_carries_left_at(client, app):
    owner = await register(client, 'leave-owner@example.com')
    chat_id = await make_chat(client, 'Archive me')
    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'leave-bob@example.com')
        await add_member(client, chat_id, bob['id'])

        # active member: the additive list field is present and null
        assert (await chat_list(bob_client))[chat_id]['left_at'] is None

        assert (await leave(bob_client, chat_id)).status_code == 204

        # archived: the chat STAYS in the list, now carrying left_at
        chats = await chat_list(bob_client)
        assert chat_id in chats
        assert chats[chat_id]['left_at'] is not None

        # repeat leave is idempotent: still 204, still archived (not deleted)
        assert (await leave(bob_client, chat_id)).status_code == 204
        chats = await chat_list(bob_client)
        assert chat_id in chats
        assert chats[chat_id]['left_at'] is not None

        # caller-relative: the owner's own row is untouched
        assert (await chat_list(client))[chat_id]['left_at'] is None

        # the single-chat GET keeps null by design (no membership context)
        single = await bob_client.get(f'/api/v1/chats/{chat_id}')
        assert single.status_code == 200
        assert single.json()['left_at'] is None

        assert owner['id'] != bob['id']


async def test_leave_rejects_never_member_anonymous_and_unknown_chat(client, app):
    await register(client, 'leave-guard-owner@example.com')
    chat_id = await make_chat(client, 'Guarded')

    async with user_client(app) as stranger_client:
        await register(stranger_client, 'leave-stranger@example.com')
        denied = await leave(stranger_client, chat_id)
        assert denied.status_code == 403
        assert denied.json() == {'detail': 'chat_membership_required'}

    async with user_client(app) as anon:
        assert (await anon.post(f'/api/v1/chats/{chat_id}/leave')).status_code == 401

    response = await client.post('/api/v1/chats/999999/leave')
    assert response.status_code == 404
    assert response.json() == {'detail': 'chat_not_found'}


# --- the write guard: archived membership is read-only ------------------------


async def test_archived_member_cannot_write_message_reaction_or_file(client, app):
    app.state.object_storage = MemoryStorage()
    await register(client, 'write-owner@example.com')
    chat_id = await make_chat(client, 'Read-only')
    message = await post_message(client, chat_id, 'history stays')

    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'write-bob@example.com')
        await add_member(client, chat_id, bob['id'])
        assert (await leave(bob_client, chat_id)).status_code == 204

        posted = await bob_client.post(
            f'/api/v1/chats/{chat_id}/messages',
            json={'content': 'archived cannot write'},
        )
        assert posted.status_code == 403
        assert posted.json() == {'detail': 'chat_membership_required'}

        reacted = await bob_client.post(
            f"/api/v1/chats/{chat_id}/messages/{message['id']}/reactions",
            json={'emoji': '👍'},
        )
        assert reacted.status_code == 403
        assert reacted.json() == {'detail': 'chat_membership_required'}

        uploaded = await bob_client.post(
            '/api/v1/files',
            data={'chat_id': str(chat_id)},
            files={'uploaded': ('notes.txt', b'archived bytes', 'text/plain')},
        )
        assert uploaded.status_code == 403
        assert uploaded.json() == {'detail': 'chat_membership_required'}


async def test_archived_member_cannot_run_the_bot(client, app):
    app.state.bot_provider = OfflineProviders()
    app.state.embedding_provider = OfflineProviders()
    await register(client, 'bot-owner@example.com')
    chat_id = await make_chat(client, 'AI corner', is_ai=True)
    message = await post_message(client, chat_id, 'What is the fixture about?')

    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'bot-bob@example.com')
        await add_member(client, chat_id, bob['id'])
        assert (await leave(bob_client, chat_id)).status_code == 204

        run = await bob_client.post(
            f'/api/v1/chats/{chat_id}/bot/runs',
            json={'message_id': message['id']},
        )
        assert run.status_code == 403
        assert run.json() == {'detail': 'chat_membership_required'}


async def test_archived_member_reads_still_pass(client, app):
    await register(client, 'read-owner@example.com')
    chat_id = await make_chat(client, 'Readable')
    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'read-bob@example.com')
        await add_member(client, chat_id, bob['id'])
        assert (await leave(bob_client, chat_id)).status_code == 204
        await post_message(client, chat_id, 'posted after the leave')
        await post_message(client, chat_id, 'second after the leave')

        assert (await bob_client.get(f'/api/v1/chats/{chat_id}')).status_code == 200
        history = await bob_client.get(f'/api/v1/chats/{chat_id}/messages')
        assert history.status_code == 200
        assert [item['content'] for item in history.json()['messages']] == [
            'second after the leave',
            'posted after the leave',
        ]
        # pagination (cursor pages) stays a READ for archived members too
        first_page = await bob_client.get(f'/api/v1/chats/{chat_id}/messages', params={'limit': 1})
        assert first_page.status_code == 200
        cursor = first_page.json()['next_before_id']
        assert cursor is not None
        older_page = await bob_client.get(
            f'/api/v1/chats/{chat_id}/messages',
            params={'before_id': cursor, 'limit': 1},
        )
        assert older_page.status_code == 200
        assert [item['content'] for item in older_page.json()['messages']] == ['posted after the leave']
        members = await bob_client.get(f'/api/v1/chats/{chat_id}/members')
        assert members.status_code == 200
        assert len(members.json()) >= 1


async def test_archived_owner_can_still_delete_the_chat(client, app):
    """delete-chat stays owner-only by owner_id regardless of the owner's
    own archived state (require_owned is untouched by the guard split)."""

    await register(client, 'del-owner@example.com')
    chat_id = await make_chat(client, 'Deletable')
    assert (await leave(client, chat_id)).status_code == 204
    assert (await client.delete(f'/api/v1/chats/{chat_id}')).status_code == 204
    assert chat_id not in await chat_list(client)


async def test_mark_read_is_noop_for_archived_rows(client, app):
    await register(client, 'marker-owner@example.com')
    chat_id = await make_chat(client, 'Markers')
    async with user_client(app) as bob_client, user_client(app) as dave_client:
        bob = await register(bob_client, 'marker-bob@example.com')
        dave = await register(dave_client, 'marker-dave@example.com')
        await add_member(client, chat_id, bob['id'])
        await add_member(client, chat_id, dave['id'])
        await leave(bob_client, chat_id)
        await post_message(client, chat_id, 'unread for the archived')

        assert (await chat_list(bob_client))[chat_id]['unread_count'] == 1

        # the history read itself passes; the inline mark_read is a no-op
        assert (await bob_client.get(f'/api/v1/chats/{chat_id}/messages')).status_code == 200
        assert (await chat_list(bob_client))[chat_id]['unread_count'] == 1

        # contrast: the active member's history read moves the marker to 0
        assert (await dave_client.get(f'/api/v1/chats/{chat_id}/messages')).status_code == 200
        assert (await chat_list(dave_client))[chat_id]['unread_count'] == 0
        assert bob['id'] != dave['id']


# --- kick: hard delete semantics ----------------------------------------------


async def test_kick_is_owner_only_and_kicked_user_loses_the_chat(client, app):
    owner = await register(client, 'kick-owner@example.com')
    chat_id = await make_chat(client, 'Kickable')

    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'kick-bob@example.com')
        first_add = await add_member(client, chat_id, bob['id'])
        async with user_client(app) as carol_client:
            carol = await register(carol_client, 'kick-carol@example.com')

            # non-owner member: 403; anonymous: 401
            assert (await kick(bob_client, chat_id, carol['id'])).status_code == 403
            async with user_client(app) as anon:
                response = await anon.delete(f'/api/v1/chats/{chat_id}/members/{bob["id"]}')
                assert response.status_code == 401

        # unknown chat 404; membership row missing 404
        assert (await kick(client, 999999, bob['id'])).status_code == 404
        assert (await kick(client, chat_id, carol['id'])).status_code == 404

        assert (await kick(client, chat_id, bob['id'])).status_code == 204

        # the kicked user loses the chat entirely
        assert chat_id not in await chat_list(bob_client)
        assert (await bob_client.get(f'/api/v1/chats/{chat_id}')).status_code == 403
        denied = await bob_client.post(
            f'/api/v1/chats/{chat_id}/messages',
            json={'content': 'no'},
        )
        assert denied.status_code == 403

        # re-add after kick = FRESH row (new joined_at), active again
        readded = await add_member(client, chat_id, bob['id'])
        assert datetime.fromisoformat(readded['joined_at']) > datetime.fromisoformat(
            first_add['joined_at']
        )
        assert (await chat_list(bob_client))[chat_id]['left_at'] is None
        await post_message(bob_client, chat_id, 'back in')
        assert owner['id'] != bob['id']


async def test_readd_after_leave_reactivates_the_same_row(client, app):
    await register(client, 'react-owner@example.com')
    chat_id = await make_chat(client, 'Reactivation')
    async with user_client(app) as bob_client, user_client(app) as carol_client, \
            user_client(app) as dave_client:
        bob = await register(bob_client, 'react-bob@example.com')
        carol = await register(carol_client, 'react-carol@example.com')
        dave = await register(dave_client, 'react-dave@example.com')
        first_add = await add_member(client, chat_id, bob['id'])
        await add_member(client, chat_id, carol['id'])
        await leave(bob_client, chat_id)
        await leave(carol_client, chat_id)

        # the re-add ACTOR must be active: an archived member cannot add anyone
        denied = await carol_client.post(
            f'/api/v1/chats/{chat_id}/members',
            json={'user_id': dave['id']},
        )
        assert denied.status_code == 403
        assert denied.json() == {'detail': 'chat_membership_required'}

        # re-adding a LEFT member reactivates the SAME row (joined_at kept)
        readded = await add_member(client, chat_id, bob['id'])
        assert readded['joined_at'] == first_add['joined_at']

        # active again: archive flag cleared, writes resumed
        assert (await chat_list(bob_client))[chat_id]['left_at'] is None
        await post_message(bob_client, chat_id, 'reactivated')

        # idempotent 201 semantics and the implicit contact capture hold on
        # the reactivation path too
        assert (await add_member(client, chat_id, bob['id']))['user_id'] == bob['id']
        contacts = await client.get('/api/v1/contacts')
        assert contacts.status_code == 200
        assert bob['id'] in {contact['id'] for contact in contacts.json()}


# --- WebSocket: refusal, send guard, filtered fan-out, user-scoped close ------


def test_kicked_user_ws_connect_is_refused(app):
    with TestClient(app) as owner_client, TestClient(app) as bob_client:
        owner_client.post(
            '/api/v1/auth/register',
            json={'email': 'ws-kick-owner@example.com', 'password': PASSWORD},
        )
        chat = owner_client.post('/api/v1/chats', json={'title': 'WS kick'}).json()
        bob = bob_client.post(
            '/api/v1/auth/register',
            json={'email': 'ws-kick-bob@example.com', 'password': PASSWORD},
        ).json()
        owner_client.post(f"/api/v1/chats/{chat['id']}/members", json={'user_id': bob['id']})
        owner_client.delete(f"/api/v1/chats/{chat['id']}/members/{bob['id']}")

        # the membership row is gone: the existing connect guard refuses
        with pytest.raises(WebSocketDisconnect):
            with bob_client.websocket_connect(f"/api/v1/ws/chats/{chat['id']}", headers=ORIGIN):
                pass


def test_two_sockets_active_receives_archived_silent_and_close_is_user_scoped(app):
    """THE integration fan-out pin: one active + one archived client in the
    same chat (the test_stories_ws multi-client precedent)."""

    def register_sync(client: TestClient, email: str) -> dict:
        response = client.post(
            '/api/v1/auth/register',
            json={'email': email, 'password': PASSWORD},
        )
        assert response.status_code == 201
        return response.json()

    with TestClient(app) as owner_client, TestClient(app) as active_client, \
            TestClient(app) as archived_client, TestClient(app) as dave_client:
        register_sync(owner_client, 'fanout-owner@example.com')
        active = register_sync(active_client, 'fanout-active@example.com')
        archived = register_sync(archived_client, 'fanout-archived@example.com')
        dave = register_sync(dave_client, 'fanout-dave@example.com')

        chat_id = owner_client.post('/api/v1/chats', json={'title': 'Fanout'}).json()['id']
        for user_id in (active['id'], archived['id'], dave['id']):
            added = owner_client.post(f'/api/v1/chats/{chat_id}/members', json={'user_id': user_id})
            assert added.status_code == 201
        assert archived_client.post(f'/api/v1/chats/{chat_id}/leave').status_code == 204
        assert owner_client.post(
            f'/api/v1/chats/{chat_id}/messages',
            json={'content': 'seed'},
        ).status_code == 201

        # the archived member still connects (read) and pages through history
        with active_client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as active_ws, \
                archived_client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as archived_ws, \
                dave_client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as dave_ws:

            archived_ws.send_json({'type': 'history', 'content': {'limit': 10}})
            history = archived_ws.receive_json()
            assert history['type'] == 'history'
            assert [item['content'] for item in history['content']['messages']] == ['seed']

            # WS send guard: archived write gets an explicit error, no broadcast
            archived_ws.send_json(
                {
                    'type': 'message',
                    'content': {'content': 'from archived', 'client_message_id': 'arch-1'},
                }
            )
            assert archived_ws.receive_json() == {
                'type': 'error',
                'content': {'code': 'chat_membership_required', 'message': 'chat_membership_required'},
            }
            assert_alive(active_ws)
            assert_alive(dave_ws)

            # WS write by an ACTIVE member: every active socket receives
            # its own broadcast (the sender included), the archived one
            # stays silent
            dave_ws.send_json(
                {
                    'type': 'message',
                    'content': {'content': 'live update', 'client_message_id': 'fanout-1'},
                }
            )
            live = dave_ws.receive_json()
            assert live['type'] == 'message'
            assert live['content']['content'] == 'live update'
            assert active_ws.receive_json()['content']['content'] == 'live update'
            assert_alive(archived_ws)

            # reaction fan-out (REST) follows the same filter
            assert owner_client.post(
                f"/api/v1/chats/{chat_id}/messages/{live['content']['id']}/reactions",
                json={'emoji': '👍'},
            ).status_code == 200
            reaction = active_ws.receive_json()
            assert reaction['type'] == 'reaction'
            assert reaction['content']['emoji'] == '👍'
            assert dave_ws.receive_json()['type'] == 'reaction'
            assert_alive(archived_ws)

            # kick closes ONLY the kicked user's socket
            assert owner_client.delete(f"/api/v1/chats/{chat_id}/members/{active['id']}").status_code == 204
            with pytest.raises(WebSocketDisconnect):
                active_ws.receive_json()
            assert_alive(archived_ws)
            assert_alive(dave_ws)

            # leave closes ONLY the leaver's socket
            assert dave_client.post(f'/api/v1/chats/{chat_id}/leave').status_code == 204
            with pytest.raises(WebSocketDisconnect):
                dave_ws.receive_json()
            assert_alive(archived_ws)
