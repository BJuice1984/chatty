from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.models.contact import Contact

pytestmark = pytest.mark.anyio

PASSWORD = 'correct horse battery staple'


async def register(client, email: str) -> dict:
    response = await client.post(
        '/api/v1/auth/register',
        json={'email': email, 'password': PASSWORD},
    )
    assert response.status_code == 201
    return response.json()


async def list_contacts(client) -> list:
    response = await client.get('/api/v1/contacts')
    assert response.status_code == 200
    return response.json()


async def add_contact(client, user_id: int):
    return await client.post('/api/v1/contacts', json={'user_id': user_id})


def contact_rows(app, owner_id: int) -> int:
    with app.state.session_factory() as session:
        return session.scalar(
            select(func.count()).select_from(Contact).where(Contact.owner_id == owner_id)
        )


async def test_empty_list_for_fresh_user(client):
    await register(client, 'fresh@example.com')

    assert await list_contacts(client) == []


async def test_add_then_listed_with_user_search_shape(client, app):
    cookie_name = app.state.settings.access_cookie_name
    await register(client, 'alice@example.com')
    alice_cookie = client.cookies.get(cookie_name)
    bob = await register(client, 'bob@example.com')
    client.cookies.set(cookie_name, alice_cookie)

    added = await add_contact(client, bob['id'])
    assert added.status_code == 201
    body = added.json()
    # id is the CONTACT user's id; login/display_name follow the
    # UserSearchItem.from_user rule (lower email, local part)
    assert set(body) == {'id', 'login', 'display_name', 'avatar_url', 'created_at'}
    assert body['id'] == bob['id']
    assert body['login'] == 'bob@example.com'
    assert body['display_name'] == 'bob'
    assert body['avatar_url'] is None
    assert body['created_at'] is not None

    listed = await list_contacts(client)
    assert [item['id'] for item in listed] == [bob['id']]
    assert listed[0] == body


async def test_re_add_is_idempotent_single_row(client, app):
    cookie_name = app.state.settings.access_cookie_name
    alice = await register(client, 'alice@example.com')
    alice_cookie = client.cookies.get(cookie_name)
    bob = await register(client, 'bob@example.com')
    client.cookies.set(cookie_name, alice_cookie)

    first = await add_contact(client, bob['id'])
    second = await add_contact(client, bob['id'])

    # 201 on create AND on existing — the same row comes back, never a duplicate
    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json() == first.json()
    assert contact_rows(app, alice['id']) == 1


async def test_self_add_is_forbidden(client):
    alice = await register(client, 'alice@example.com')

    response = await add_contact(client, alice['id'])

    assert response.status_code == 400
    assert response.json() == {'detail': 'contact_self_forbidden'}


async def test_unknown_user_is_not_found(client):
    await register(client, 'alice@example.com')

    response = await add_contact(client, 999999)

    assert response.status_code == 404
    assert response.json() == {'detail': 'user_not_found'}


async def test_delete_then_repeat_is_not_found(client, app):
    cookie_name = app.state.settings.access_cookie_name
    await register(client, 'alice@example.com')
    alice_cookie = client.cookies.get(cookie_name)
    bob = await register(client, 'bob@example.com')
    client.cookies.set(cookie_name, alice_cookie)
    await add_contact(client, bob['id'])

    first = await client.delete(f"/api/v1/contacts/{bob['id']}")
    second = await client.delete(f"/api/v1/contacts/{bob['id']}")

    assert first.status_code == 204
    assert second.status_code == 404
    assert second.json() == {'detail': 'contact_not_found'}
    assert await list_contacts(client) == []


async def test_requires_authentication(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver') as anon:
        assert (await anon.get('/api/v1/contacts')).status_code == 401
        assert (await anon.post('/api/v1/contacts', json={'user_id': 1})).status_code == 401
        assert (await anon.delete('/api/v1/contacts/1')).status_code == 401


async def test_owner_isolation(client, app):
    cookie_name = app.state.settings.access_cookie_name
    await register(client, 'alice@example.com')
    alice_cookie = client.cookies.get(cookie_name)
    bob = await register(client, 'bob@example.com')
    bob_cookie = client.cookies.get(cookie_name)
    carol = await register(client, 'carol@example.com')
    client.cookies.set(cookie_name, alice_cookie)
    assert (await add_contact(client, bob['id'])).status_code == 201
    assert (await add_contact(client, carol['id'])).status_code == 201

    # B never sees A's contacts: the book is one-directional and owner-scoped
    client.cookies.set(cookie_name, bob_cookie)
    assert [item['id'] for item in await list_contacts(client)] == []


async def test_implicit_capture_on_member_add(client, app):
    cookie_name = app.state.settings.access_cookie_name
    await register(client, 'alice@example.com')
    alice_cookie = client.cookies.get(cookie_name)
    bob = await register(client, 'bob@example.com')
    bob_cookie = client.cookies.get(cookie_name)
    client.cookies.set(cookie_name, alice_cookie)

    chat = await client.post('/api/v1/chats', json={'title': 'capture room'})
    assert chat.status_code == 201
    chat_id = chat.json()['id']

    member = await client.post(f"/api/v1/chats/{chat_id}/members", json={'user_id': bob['id']})
    assert member.status_code == 201
    # members endpoint response stays unchanged: the membership shape only
    assert set(member.json()) == {'chat_id', 'user_id', 'joined_at'}

    # capture is one-directional: the adder gets the contact, the added user does not
    assert [item['id'] for item in await list_contacts(client)] == [bob['id']]
    client.cookies.set(cookie_name, bob_cookie)
    assert await list_contacts(client) == []


async def test_implicit_capture_survives_idempotent_re_add(client, app):
    """The early-return path captures too (review F-4): a deleted contact
    row comes back on the second, idempotent POST /members call."""
    cookie_name = app.state.settings.access_cookie_name
    await register(client, 'alice@example.com')
    alice_cookie = client.cookies.get(cookie_name)
    bob = await register(client, 'bob@example.com')
    client.cookies.set(cookie_name, alice_cookie)

    chat_id = (await client.post('/api/v1/chats', json={'title': 'capture twice'})).json()['id']
    assert (await client.post(f"/api/v1/chats/{chat_id}/members", json={'user_id': bob['id']})).status_code == 201
    assert [item['id'] for item in await list_contacts(client)] == [bob['id']]

    removed = await client.delete(f"/api/v1/contacts/{bob['id']}")
    assert removed.status_code == 204
    assert await list_contacts(client) == []

    repeat = await client.post(f"/api/v1/chats/{chat_id}/members", json={'user_id': bob['id']})
    assert repeat.status_code == 201
    assert [item['id'] for item in await list_contacts(client)] == [bob['id']]
