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


async def create_dm(client, user_id: int):
    return await client.post('/api/v1/chats/dm', json={'user_id': user_id})


async def chat_list(client) -> dict:
    response = await client.get('/api/v1/chats')
    assert response.status_code == 200
    return {chat['id']: chat for chat in response.json()}


async def test_create_returns_dm_shape_with_both_members(client, app):
    cookie_name = app.state.settings.access_cookie_name
    alice = await register(client, 'alice@example.com')
    alice_cookie = client.cookies.get(cookie_name)
    bob = await register(client, 'bob@example.com')
    client.cookies.set(cookie_name, alice_cookie)

    response = await create_dm(client, bob['id'])

    assert response.status_code == 201
    dm = response.json()
    assert dm['is_dm'] is True
    assert dm['is_ai'] is False
    # title is the target email local part, denormalized at creation
    assert dm['title'] == 'bob'
    assert dm['owner_id'] == alice['id']
    # POST fills members through model_validate (empty default) — the exact
    # two members are pinned through GET /chats
    assert dm['members'] == []
    chats = await chat_list(client)
    assert {member['id'] for member in chats[dm['id']]['members']} == {alice['id'], bob['id']}


async def test_repeat_returns_same_chat_with_200(client, app):
    cookie_name = app.state.settings.access_cookie_name
    await register(client, 'alice@example.com')
    alice_cookie = client.cookies.get(cookie_name)
    bob = await register(client, 'bob@example.com')
    client.cookies.set(cookie_name, alice_cookie)

    first = await create_dm(client, bob['id'])
    second = await create_dm(client, bob['id'])

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()['id'] == first.json()['id']


async def test_self_dm_is_forbidden(client):
    alice = await register(client, 'alice@example.com')

    response = await create_dm(client, alice['id'])

    assert response.status_code == 400
    assert response.json() == {'detail': 'dm_self_forbidden'}


async def test_unknown_target_is_not_found(client):
    await register(client, 'alice@example.com')

    response = await create_dm(client, 999999)

    assert response.status_code == 404
    assert response.json() == {'detail': 'user_not_found'}


async def test_requires_authentication(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver') as anon:
        response = await anon.post('/api/v1/chats/dm', json={'user_id': 1})
    assert response.status_code == 401


async def test_plain_two_member_group_is_never_reused(client, app):
    """A DM is defined only by is_dm — a group with exactly two members must
    not be promoted: POST /chats/dm still creates a NEW chat."""
    cookie_name = app.state.settings.access_cookie_name
    alice = await register(client, 'alice@example.com')
    alice_cookie = client.cookies.get(cookie_name)
    bob = await register(client, 'bob@example.com')
    client.cookies.set(cookie_name, alice_cookie)

    group = await client.post('/api/v1/chats', json={'title': 'duo group'})
    assert group.status_code == 201
    group_id = group.json()['id']
    assert (await client.post(f"/api/v1/chats/{group_id}/members", json={'user_id': bob['id']})).status_code == 201

    dm = await create_dm(client, bob['id'])

    assert dm.status_code == 201
    assert dm.json()['id'] != group_id
    assert dm.json()['is_dm'] is True

    chats = await chat_list(client)
    assert chats[group_id]['is_dm'] is False
    # the decoy really is a two-member group, yet it was not reused
    assert {member['id'] for member in chats[group_id]['members']} == {alice['id'], bob['id']}


async def test_chat_list_carries_is_dm(client, app):
    cookie_name = app.state.settings.access_cookie_name
    await register(client, 'alice@example.com')
    alice_cookie = client.cookies.get(cookie_name)
    bob = await register(client, 'bob@example.com')
    client.cookies.set(cookie_name, alice_cookie)

    group = await client.post('/api/v1/chats', json={'title': 'plain group'})
    group_id = group.json()['id']
    dm = await create_dm(client, bob['id'])
    dm_id = dm.json()['id']

    chats = await chat_list(client)
    # every entry carries the additive field; values split by the flag
    assert all('is_dm' in chat for chat in chats.values())
    assert chats[dm_id]['is_dm'] is True
    assert chats[group_id]['is_dm'] is False
