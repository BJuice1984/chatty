"""POST /chats/{id}/rejoin — the leave twin: the caller's OWN archived
membership row reactivates (left_at -> NULL on the same row, joined_at
kept), writes resume, and the guard matrix holds — a kicked user has no
row (403, the membership error), an already-active membership is an
idempotent 204, an unknown chat is the usual 404, anonymous is 401."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.anyio

PASSWORD = 'correct horse battery staple'


async def register(client, email: str) -> dict:
    response = await client.post(
        '/api/v1/auth/register',
        json={'email': email, 'password': PASSWORD},
    )
    assert response.status_code == 201
    return response.json()


def user_client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')


async def make_chat(client, title: str) -> int:
    response = await client.post('/api/v1/chats', json={'title': title})
    assert response.status_code == 201
    return response.json()['id']


async def add_member(client, chat_id: int, user_id: int) -> dict:
    response = await client.post(f'/api/v1/chats/{chat_id}/members', json={'user_id': user_id})
    assert response.status_code == 201
    return response.json()


async def leave(client, chat_id: int):
    return await client.post(f'/api/v1/chats/{chat_id}/leave')


async def rejoin(client, chat_id: int):
    return await client.post(f'/api/v1/chats/{chat_id}/rejoin')


async def chat_list(client) -> dict[int, dict]:
    response = await client.get('/api/v1/chats')
    assert response.status_code == 200
    return {chat['id']: chat for chat in response.json()}


async def test_rejoin_reactivates_own_archived_row_and_writes_resume(client, app):
    await register(client, 'rejoin-owner@example.com')
    chat_id = await make_chat(client, 'Rejoinable')

    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'rejoin-bob@example.com')
        first_add = await add_member(client, chat_id, bob['id'])

        assert (await leave(bob_client, chat_id)).status_code == 204
        assert (await chat_list(bob_client))[chat_id]['left_at'] is not None

        # archived membership is read-only: the write guard still refuses
        denied = await bob_client.post(
            f'/api/v1/chats/{chat_id}/messages',
            json={'content': 'archived cannot write'},
        )
        assert denied.status_code == 403

        assert (await rejoin(bob_client, chat_id)).status_code == 204

        # active again on the SAME row: archive flag cleared, and a later
        # idempotent re-add still sees the ORIGINAL joined_at (a rejoin
        # never starts a fresh row — that is the kick's semantics)
        chats = await chat_list(bob_client)
        assert chats[chat_id]['left_at'] is None
        readded = await add_member(client, chat_id, bob['id'])
        assert readded['joined_at'] == first_add['joined_at']

        # writes resume (writes and live pushes ride the active filter)
        posted = await bob_client.post(
            f'/api/v1/chats/{chat_id}/messages',
            json={'content': 'back after rejoin'},
        )
        assert posted.status_code == 201


async def test_rejoin_on_active_membership_is_idempotent(client, app):
    await register(client, 'rejoin-active-owner@example.com')
    chat_id = await make_chat(client, 'Still in')

    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'rejoin-active-bob@example.com')
        await add_member(client, chat_id, bob['id'])

        assert (await rejoin(bob_client, chat_id)).status_code == 204
        assert (await rejoin(bob_client, chat_id)).status_code == 204
        assert (await chat_list(bob_client))[chat_id]['left_at'] is None


async def test_rejoin_refuses_kicked_and_never_member(client, app):
    await register(client, 'rejoin-kick-owner@example.com')
    chat_id = await make_chat(client, 'Kicked room')

    async with user_client(app) as bob_client, user_client(app) as stranger_client:
        bob = await register(bob_client, 'rejoin-kicked-bob@example.com')
        await add_member(client, chat_id, bob['id'])
        kicked = await client.delete(f"/api/v1/chats/{chat_id}/members/{bob['id']}")
        assert kicked.status_code == 204

        # the kick HARD-deleted the row: no archive to come back to
        denied = await rejoin(bob_client, chat_id)
        assert denied.status_code == 403
        assert denied.json() == {'detail': 'chat_membership_required'}

        # a never-member gets the same membership 403
        await register(stranger_client, 'rejoin-stranger@example.com')
        stranger_denied = await rejoin(stranger_client, chat_id)
        assert stranger_denied.status_code == 403
        assert stranger_denied.json() == {'detail': 'chat_membership_required'}


async def test_rejoin_unknown_chat_and_anonymous(client, app):
    await register(client, 'rejoin-guards@example.com')

    unknown = await client.post('/api/v1/chats/999999/rejoin')
    assert unknown.status_code == 404
    assert unknown.json() == {'detail': 'chat_not_found'}

    async with user_client(app) as anon:
        anonymous = await anon.post('/api/v1/chats/1/rejoin')
        assert anonymous.status_code == 401
