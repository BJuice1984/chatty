"""POST /chats/read-all: «Пометить всё прочитанными». The bulk upsert
covers every membership of the caller — active AND archived alike, exactly
the scope unread_counts aggregates — advancing each chat's marker to its
newest message; markers only ever move forward (the mark_read ON CONFLICT
guard); {updated} counts chats WITH messages (a chat without messages has
nothing to read and produces no row)."""

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


async def add_member(client, chat_id: int, user_id: int) -> None:
    response = await client.post(f'/api/v1/chats/{chat_id}/members', json={'user_id': user_id})
    assert response.status_code == 201


async def post_message(client, chat_id: int, content: str) -> dict:
    response = await client.post(f'/api/v1/chats/{chat_id}/messages', json={'content': content})
    assert response.status_code == 201
    return response.json()


async def chat_list(client) -> dict[int, dict]:
    response = await client.get('/api/v1/chats')
    assert response.status_code == 200
    return {chat['id']: chat for chat in response.json()}


async def read_all(client):
    return await client.post('/api/v1/chats/read-all')


async def test_read_all_zeroes_active_and_archived_and_counts_updated(client, app):
    await register(client, 'readall-owner@example.com')
    noisy = await make_chat(client, 'Noisy')
    quiet = await make_chat(client, 'Quiet')  # no messages at all
    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'readall-bob@example.com')
        archived = await make_chat(client, 'Archived noise')
        await add_member(client, noisy, bob['id'])
        await add_member(client, archived, bob['id'])
        await add_member(client, quiet, bob['id'])
        assert (await bob_client.post(f'/api/v1/chats/{archived}/leave')).status_code == 204

        await post_message(client, noisy, 'one')
        await post_message(client, noisy, 'two')
        await post_message(client, archived, 'missed while away')

        # unread present in both the active and the archived chat; 2026-11-07:
        # служебные строки состава — тоже сообщения (чужие для боба), quiet
        # теперь несёт строку добавления (своя leave-строка не в счёт)
        bob_chats = await chat_list(bob_client)
        assert bob_chats[noisy]['unread_count'] == 3  # one, two + «добавил bob»
        assert bob_chats[archived]['unread_count'] == 2  # missed + «добавил bob»
        assert bob_chats[quiet]['unread_count'] == 1  # только «добавил bob»

        # BOB's read-all covers all his three chats with messages
        response = await read_all(bob_client)
        assert response.status_code == 200
        assert response.json() == {'updated': 3}

        bob_chats = await chat_list(bob_client)
        assert bob_chats[noisy]['unread_count'] == 0
        assert bob_chats[archived]['unread_count'] == 0
        assert bob_chats[quiet]['unread_count'] == 0


async def test_read_all_is_forward_only_and_idempotent(client, app):
    await register(client, 'readall-forward-owner@example.com')
    chat_id = await make_chat(client, 'Forward')
    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'readall-forward-bob@example.com')
        await add_member(client, chat_id, bob['id'])
        await post_message(client, chat_id, 'first')
        await post_message(client, chat_id, 'second')

        # an ordinary history read already advanced the marker to the newest
        assert (await bob_client.get(f'/api/v1/chats/{chat_id}/messages')).status_code == 200
        assert (await chat_list(bob_client))[chat_id]['unread_count'] == 0

        # read-all cannot move the marker BACKWARD: unread stays 0, the
        # count still covers the chat (it has messages)
        response = await read_all(bob_client)
        assert response.json() == {'updated': 1}
        assert (await chat_list(bob_client))[chat_id]['unread_count'] == 0

        # a fresh message afterwards is unread again until the next read-all
        await post_message(client, chat_id, 'third')
        assert (await chat_list(bob_client))[chat_id]['unread_count'] == 1
        assert (await read_all(bob_client)).json() == {'updated': 1}
        assert (await chat_list(bob_client))[chat_id]['unread_count'] == 0


async def test_read_all_guards(client, app):
    await register(client, 'readall-guard@example.com')
    async with user_client(app) as anon:
        assert (await anon.post('/api/v1/chats/read-all')).status_code == 401
