"""Auto-titled chats (013): POST /chats auto_titled contract, the
members-append rule and its exclusions. The append runs ONLY on the
fresh-membership insert branch — the existing/reactivated early return
keeps the title untouched (a repeated add must not duplicate the name).
The name rule is to_member_brief's: display_name with the email local
part as the fallback; the seed 'Чат с' gains the first name with a space,
longer titles append ', name'; a >200 result is a silent skip with the
addition still 201. NOT-auto_titled and is_dm chats keep their titles.
The WS fan-out reuses 'chat_renamed' and lives in the ENDPOINT (no
service imports app.ws.hub — the grep pin lives in
test_chat_ai_toggle_api.py)."""

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


def make_dm_auto_titled(session_factory, owner_id: int, target_id: int) -> int:
    """An is_dm chat force-flagged auto_titled straight through the ORM —
    the situation the frontend never creates, pinned here so the service
    guard stays honest regardless of the client."""
    from app.models.chat import Chat, ChatMember

    session = session_factory()
    try:
        chat = Chat(
            title='DM seed',
            owner_id=owner_id,
            is_ai=False,
            is_dm=True,
            auto_titled=True,
        )
        session.add(chat)
        session.flush()
        session.add(ChatMember(chat_id=chat.id, user_id=owner_id))
        session.add(ChatMember(chat_id=chat.id, user_id=target_id))
        session.commit()
        return chat.id
    finally:
        session.close()


async def chat_list(client) -> dict[int, dict]:
    response = await client.get('/api/v1/chats')
    assert response.status_code == 200
    return {chat['id']: chat for chat in response.json()}


def user_client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')


async def test_create_with_auto_titled_flag_is_echoed(client):
    await register(client, 'auto-owner@example.com')

    response = await client.post('/api/v1/chats', json={'title': 'Чат с', 'auto_titled': True})
    assert response.status_code == 201
    body = response.json()
    assert body['auto_titled'] is True

    # a title-only creation keeps the default False (the old payload shape)
    plain = await client.post('/api/v1/chats', json={'title': 'Plain'})
    assert plain.status_code == 201
    assert plain.json()['auto_titled'] is False

    # GET /chats carries the field
    listed = await chat_list(client)
    assert listed[body['id']]['auto_titled'] is True
    assert listed[plain.json()['id']]['auto_titled'] is False


async def test_members_append_names_to_auto_title(client, app, session_factory):
    await register(client, 'append-owner@example.com')
    chat = (await client.post('/api/v1/chats', json={'title': 'Чат с', 'auto_titled': True})).json()

    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'append-bob@example.com')
        set_display_name(session_factory, bob['id'], 'Боб')

        added = await client.post(f"/api/v1/chats/{chat['id']}/members", json={'user_id': bob['id']})
        assert added.status_code == 201
        # the seed gains the first name with a space
        assert (await chat_list(client))[chat['id']]['title'] == 'Чат с Боб'

        async with user_client(app) as carol_client:
            # no display_name — the email local part fallback
            carol = await register(carol_client, 'append-carol@example.com')
            added = await client.post(f"/api/v1/chats/{chat['id']}/members", json={'user_id': carol['id']})
            assert added.status_code == 201
            # longer titles append ', name'
            assert (await chat_list(client))[chat['id']]['title'] == 'Чат с Боб, append-carol'


async def test_repeated_member_add_keeps_title_unchanged(client, app, session_factory):
    """The fresh-insert-only rule (review F-4): both the already-active
    repeat and the archived/reactivation path leave the title alone."""
    await register(client, 'repeat-owner@example.com')
    chat = (await client.post('/api/v1/chats', json={'title': 'Чат с', 'auto_titled': True})).json()

    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'repeat-bob@example.com')
        set_display_name(session_factory, bob['id'], 'Боб')

        first = await client.post(f"/api/v1/chats/{chat['id']}/members", json={'user_id': bob['id']})
        assert first.status_code == 201
        assert (await chat_list(client))[chat['id']]['title'] == 'Чат с Боб'

        # already-active membership: the early return, no second append
        repeat = await client.post(f"/api/v1/chats/{chat['id']}/members", json={'user_id': bob['id']})
        assert repeat.status_code == 201
        assert (await chat_list(client))[chat['id']]['title'] == 'Чат с Боб'

        # archived membership reactivates through the SAME early return
        assert (await bob_client.post(f"/api/v1/chats/{chat['id']}/leave")).status_code == 204
        reactivated = await client.post(f"/api/v1/chats/{chat['id']}/members", json={'user_id': bob['id']})
        assert reactivated.status_code == 201
        assert (await chat_list(client))[chat['id']]['title'] == 'Чат с Боб'


async def test_auto_title_exclusions_and_cap(client, app, session_factory):
    owner = await register(client, 'exclude-owner@example.com')

    # NOT-auto_titled chat: the title is untouchable
    plain = (await client.post('/api/v1/chats', json={'title': 'Ручной'})).json()
    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'exclude-bob@example.com')
        added = await client.post(f"/api/v1/chats/{plain['id']}/members", json={'user_id': bob['id']})
        assert added.status_code == 201
        assert (await chat_list(client))[plain['id']]['title'] == 'Ручной'

    # is_dm chat force-flagged auto_titled: the DM exclusion holds
    async with user_client(app) as carol_client:
        carol = await register(carol_client, 'exclude-carol@example.com')
        dm_id = make_dm_auto_titled(session_factory, owner['id'], carol['id'])
        added = await client.post(f"/api/v1/chats/{dm_id}/members", json={'user_id': carol['id']})
        # carol is already a member — the early return; the title survives
        assert added.status_code == 201
        assert (await chat_list(client))[dm_id]['title'] == 'DM seed'

    # >200 cap: a title already at the column cap leaves no room for an
    # append — the addition still succeeds, the title stays as it was
    long_chat = (await client.post('/api/v1/chats', json={'title': 'Ч' * 200, 'auto_titled': True})).json()
    added = await client.post(f"/api/v1/chats/{long_chat['id']}/members", json={'user_id': carol['id']})
    assert added.status_code == 201
    assert (await chat_list(client))[long_chat['id']]['title'] == 'Ч' * 200


def test_auto_title_append_broadcasts_chat_renamed(app):
    """The append rides the EXISTING 'chat_renamed' event (no new type):
    an active socket receives it right after the member addition."""

    def register_sync(client: TestClient, email: str) -> dict:
        response = client.post(
            '/api/v1/auth/register',
            json={'email': email, 'password': PASSWORD},
        )
        assert response.status_code == 201
        return response.json()

    with TestClient(app) as owner_client, TestClient(app) as bob_client:
        register_sync(owner_client, 'append-ws-owner@example.com')
        bob = register_sync(bob_client, 'append-ws-bob@example.com')
        chat_id = owner_client.post('/api/v1/chats', json={'title': 'Чат с', 'auto_titled': True}).json()['id']

        with owner_client.websocket_connect(f'/api/v1/ws/chats/{chat_id}', headers=ORIGIN) as owner_ws:
            added = owner_client.post(f"/api/v1/chats/{chat_id}/members", json={'user_id': bob['id']})
            assert added.status_code == 201

            renamed = owner_ws.receive_json()
            assert renamed == {
                'type': 'chat_renamed',
                'content': {'chat_id': chat_id, 'title': 'Чат с append-ws-bob'},
            }
