"""The settings-wave auth surface: profile update (display_name/phone/
send_read_receipts), password change (revoke-all-refresh + current-session
reissue), logout-everywhere (the token_version comparison BUILT in
get_current_user), files usage, the viewer-own receipts gate, and the
display_name fallback across every name surface (user search, contacts,
chat members, new dm titles)."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from tests.integration.chat.test_media_api import MemoryStorage

pytestmark = pytest.mark.anyio

PASSWORD = 'correct horse battery staple'
NEW_PASSWORD = 'another secure password for tests'


async def register(client, email: str) -> dict:
    response = await client.post(
        '/api/v1/auth/register',
        json={'email': email, 'password': PASSWORD},
    )
    assert response.status_code == 201
    return response.json()


def user_client(app) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')


def csrf_header(client, app) -> dict[str, str]:
    return {'X-CSRF-Token': client.cookies.get(app.state.settings.csrf_cookie_name)}


async def make_chat(client, title: str) -> int:
    response = await client.post('/api/v1/chats', json={'title': title})
    assert response.status_code == 201
    return response.json()['id']


async def add_member(client, chat_id: int, user_id: int) -> None:
    response = await client.post(f'/api/v1/chats/{chat_id}/members', json={'user_id': user_id})
    assert response.status_code == 201


async def put_profile(client, app, payload: dict):
    return await client.put('/api/v1/auth/profile', json=payload, headers=csrf_header(client, app))


async def chat_list(client) -> dict[int, dict]:
    response = await client.get('/api/v1/chats')
    assert response.status_code == 200
    return {chat['id']: chat for chat in response.json()}


# --- auth responses grow the profile fields additively ------------------------


async def test_auth_responses_carry_the_new_profile_fields(client):
    user = await register(client, 'fields@example.com')

    assert user['display_name'] is None
    assert user['phone'] is None
    assert user['send_read_receipts'] is True

    me = await client.get('/api/v1/auth/me')
    assert me.status_code == 200
    assert me.json()['display_name'] is None
    assert me.json()['phone'] is None
    assert me.json()['send_read_receipts'] is True


# --- PUT /auth/profile ---------------------------------------------------------


async def test_profile_update_applies_carried_fields_and_keeps_the_rest(client, app):
    await register(client, 'profile@example.com')

    updated = await put_profile(
        client,
        app,
        {'display_name': 'Alice Profile', 'phone': '+7 900 000 0000', 'send_read_receipts': False},
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body['display_name'] == 'Alice Profile'
    assert body['phone'] == '+7 900 000 0000'
    assert body['send_read_receipts'] is False

    me = await client.get('/api/v1/auth/me')
    assert me.json()['display_name'] == 'Alice Profile'
    assert me.json()['phone'] == '+7 900 000 0000'
    assert me.json()['send_read_receipts'] is False

    # a partial payload (the Privacy toggle) applies ONLY its field — an
    # absent field never wipes its column
    partial = await put_profile(client, app, {'send_read_receipts': True})
    assert partial.status_code == 200
    assert partial.json()['display_name'] == 'Alice Profile'
    assert partial.json()['phone'] == '+7 900 000 0000'
    assert partial.json()['send_read_receipts'] is True


async def test_profile_display_name_is_trimmed_and_empty_clears_to_null(client, app):
    await register(client, 'trim@example.com')

    trimmed = await put_profile(client, app, {'display_name': '  Padded Name  '})
    assert trimmed.json()['display_name'] == 'Padded Name'

    cleared = await put_profile(client, app, {'display_name': '   '})
    assert cleared.status_code == 200
    assert cleared.json()['display_name'] is None

    me = await client.get('/api/v1/auth/me')
    assert me.json()['display_name'] is None


async def test_profile_validation_branches(client, app):
    await register(client, 'validate@example.com')

    too_long_name = await put_profile(client, app, {'display_name': 'x' * 121})
    assert too_long_name.status_code == 422

    boundary_name = await put_profile(client, app, {'display_name': 'x' * 120})
    assert boundary_name.status_code == 200

    short_phone = await put_profile(client, app, {'phone': 'ab'})
    assert short_phone.status_code == 422

    long_phone = await put_profile(client, app, {'phone': '5' * 31})
    assert long_phone.status_code == 422

    boundary_phone = await put_profile(client, app, {'phone': '555'})
    assert boundary_phone.status_code == 200
    assert boundary_phone.json()['phone'] == '555'

    # an emptied phone input clears the column instead of tripping the min
    cleared_phone = await put_profile(client, app, {'phone': ''})
    assert cleared_phone.status_code == 200
    assert cleared_phone.json()['phone'] is None


async def test_profile_requires_csrf_and_authentication(client, app):
    await register(client, 'csrf-profile@example.com')

    missing_csrf = await client.put('/api/v1/auth/profile', json={'display_name': 'No Csrf'})
    assert missing_csrf.status_code == 403
    assert missing_csrf.json() == {'detail': 'csrf_failed'}

    async with user_client(app) as anon:
        anonymous = await anon.put(
            '/api/v1/auth/profile',
            json={'display_name': 'Anon'},
            headers={'X-CSRF-Token': 'anything'},
        )
        assert anonymous.status_code == 401


# --- PUT /auth/password --------------------------------------------------------


async def test_password_change_revokes_other_sessions_and_keeps_the_current(client, app):
    settings = app.state.settings
    user = await register(client, 'password@example.com')
    old_refresh = client.cookies.get(settings.refresh_cookie_name)
    csrf = client.cookies.get(settings.csrf_cookie_name)

    wrong_old = await client.put(
        '/api/v1/auth/password',
        json={'old_password': 'not the old password', 'new_password': NEW_PASSWORD},
        headers={'X-CSRF-Token': csrf},
    )
    assert wrong_old.status_code == 401
    assert wrong_old.json() == {'detail': 'invalid_credentials'}
    # the failed attempt is not a session change: the current one stays alive
    assert (await client.get('/api/v1/auth/me')).status_code == 200

    missing_csrf = await client.put(
        '/api/v1/auth/password',
        json={'old_password': PASSWORD, 'new_password': NEW_PASSWORD},
    )
    assert missing_csrf.status_code == 403

    changed = await client.put(
        '/api/v1/auth/password',
        json={'old_password': PASSWORD, 'new_password': NEW_PASSWORD},
        headers={'X-CSRF-Token': csrf},
    )
    assert changed.status_code == 200
    assert changed.json()['email'] == user['email']
    # the SAME response reissued fresh cookies: the current session is alive
    assert client.cookies.get(settings.csrf_cookie_name) != csrf
    assert (await client.get('/api/v1/auth/me')).status_code == 200

    # every OTHER refresh token died with the token_version bump
    new_csrf = client.cookies.get(settings.csrf_cookie_name)
    async with user_client(app) as stale:
        stale.cookies.set(settings.refresh_cookie_name, old_refresh)
        stale.cookies.set(settings.csrf_cookie_name, new_csrf)
        refreshed = await stale.post('/api/v1/auth/refresh', headers={'X-CSRF-Token': new_csrf})
        assert refreshed.status_code == 401

    # the hash really changed: the new password logs in, the old one does not
    login_new = await client.post(
        '/api/v1/auth/login',
        json={'email': 'password@example.com', 'password': NEW_PASSWORD},
    )
    assert login_new.status_code == 200
    login_old = await client.post(
        '/api/v1/auth/login',
        json={'email': 'password@example.com', 'password': PASSWORD},
    )
    assert login_old.status_code == 401
    assert login_old.json() == {'detail': 'invalid_credentials'}

    # short new passwords never reach the service (the 12..256 policy)
    policy = await client.put(
        '/api/v1/auth/password',
        json={'old_password': NEW_PASSWORD, 'new_password': 'short'},
        headers={'X-CSRF-Token': client.cookies.get(settings.csrf_cookie_name)},
    )
    assert policy.status_code == 422


# --- POST /auth/logout-all -----------------------------------------------------


async def test_logout_all_retires_previously_issued_tokens(client, app):
    settings = app.state.settings
    await register(client, 'logout-all@example.com')
    old_access = client.cookies.get(settings.access_cookie_name)
    old_refresh = client.cookies.get(settings.refresh_cookie_name)
    csrf = client.cookies.get(settings.csrf_cookie_name)

    missing_csrf = await client.post('/api/v1/auth/logout-all')
    assert missing_csrf.status_code == 403
    assert missing_csrf.json() == {'detail': 'csrf_failed'}

    response = await client.post('/api/v1/auth/logout-all', headers={'X-CSRF-Token': csrf})
    assert response.status_code == 200
    assert response.json() == {'message': 'logged_out_everywhere'}

    # the current session's cookies were cleared
    assert (await client.get('/api/v1/auth/me')).status_code == 401

    # THE pin: a previously issued access token is stale — the comparison
    # built in get_current_user rejects it although it has not expired
    async with user_client(app) as stale:
        stale.cookies.set(settings.access_cookie_name, old_access)
        assert (await stale.get('/api/v1/auth/me')).status_code == 401
        # the refresh side died with the same token_version bump
        stale.cookies.set(settings.csrf_cookie_name, csrf)
        refreshed = await stale.post('/api/v1/auth/refresh', headers={'X-CSRF-Token': csrf})
        assert refreshed.status_code == 401

    async with user_client(app) as anon:
        anonymous = await anon.post('/api/v1/auth/logout-all', headers={'X-CSRF-Token': 'x'})
        assert anonymous.status_code == 401


# --- GET /files/usage ----------------------------------------------------------


async def test_files_usage_shape_and_owner_isolation(client, app):
    app.state.object_storage = MemoryStorage()
    await register(client, 'usage-owner@example.com')
    chat_id = await make_chat(client, 'Usage room')

    first = await client.post(
        '/api/v1/files',
        data={'chat_id': str(chat_id)},
        files={'uploaded': ('a.bin', b'a' * 100, 'application/octet-stream')},
    )
    assert first.status_code == 201
    second = await client.post(
        '/api/v1/files',
        data={'chat_id': str(chat_id)},
        files={'uploaded': ('b.bin', b'b' * 28, 'application/octet-stream')},
    )
    assert second.status_code == 201

    usage = await client.get('/api/v1/files/usage')
    assert usage.status_code == 200
    assert usage.json() == {'total_bytes': 128, 'file_count': 2}

    # global media (avatars) is owned by the uploader too and counts
    avatar = await client.post(
        '/api/v1/files/avatars',
        data={'kind': 'user'},
        files={'uploaded': ('me.png', b'avatar-bytes', 'image/png')},
    )
    assert avatar.status_code == 201
    usage = await client.get('/api/v1/files/usage')
    assert usage.json() == {'total_bytes': 140, 'file_count': 3}

    # isolation: another user sees only their own rows
    async with user_client(app) as bob_client:
        bob = await register(bob_client, 'usage-bob@example.com')
        assert (await bob_client.get('/api/v1/files/usage')).json() == {'total_bytes': 0, 'file_count': 0}
        await add_member(client, chat_id, bob['id'])
        uploaded = await bob_client.post(
            '/api/v1/files',
            data={'chat_id': str(chat_id)},
            files={'uploaded': ('c.bin', b'c' * 10, 'application/octet-stream')},
        )
        assert uploaded.status_code == 201
        assert (await bob_client.get('/api/v1/files/usage')).json() == {'total_bytes': 10, 'file_count': 1}

    async with user_client(app) as anon:
        assert (await anon.get('/api/v1/files/usage')).status_code == 401


# --- the receipts gate: viewer-own unread badge --------------------------------


async def test_receipts_off_keeps_own_unread_badge_after_history_load(client, app):
    await register(client, 'receipts-owner@example.com')
    chat_id = await make_chat(client, 'Receipts')

    async with user_client(app) as bob_client, user_client(app) as dave_client:
        bob = await register(bob_client, 'receipts-bob@example.com')
        dave = await register(dave_client, 'receipts-dave@example.com')
        await add_member(client, chat_id, bob['id'])
        await add_member(client, chat_id, dave['id'])

        receipts_off = await put_profile(bob_client, app, {'send_read_receipts': False})
        assert receipts_off.status_code == 200
        assert receipts_off.json()['send_read_receipts'] is False

        await client.post(f'/api/v1/chats/{chat_id}/messages', json={'content': 'one'})
        await client.post(f'/api/v1/chats/{chat_id}/messages', json={'content': 'two'})

        # both members start unread
        assert (await chat_list(bob_client))[chat_id]['unread_count'] == 2

        # the receipts-OFF viewer reads the history: the marker does NOT move,
        # their OWN unread badge stays (chat_last_reads has no peer consumer)
        history = await bob_client.get(f'/api/v1/chats/{chat_id}/messages')
        assert history.status_code == 200
        assert [item['content'] for item in history.json()['messages']] == ['two', 'one']
        assert (await chat_list(bob_client))[chat_id]['unread_count'] == 2

        # contrast: the receipts-ON viewer's history load clears their badge
        assert (await chat_list(dave_client))[chat_id]['unread_count'] == 2
        assert (await dave_client.get(f'/api/v1/chats/{chat_id}/messages')).status_code == 200
        assert (await chat_list(dave_client))[chat_id]['unread_count'] == 0

        # turning receipts back ON resumes advancing the viewer's own marker
        await put_profile(bob_client, app, {'send_read_receipts': True})
        assert (await bob_client.get(f'/api/v1/chats/{chat_id}/messages')).status_code == 200
        assert (await chat_list(bob_client))[chat_id]['unread_count'] == 0


# --- display_name fallback across the name surfaces ----------------------------


async def test_display_name_fallback_in_user_search(client, app):
    await register(client, 'searcher@example.com')
    async with user_client(app) as bob_client, user_client(app) as carol_client:
        await register(bob_client, 'fallback-bob@example.com')
        await register(carol_client, 'fallback-carol@example.com')
        renamed = await put_profile(carol_client, app, {'display_name': 'Carol K.'})
        assert renamed.status_code == 200

        no_name = await client.get('/api/v1/users', params={'login': 'fallback-bob'})
        assert [item['display_name'] for item in no_name.json()] == ['fallback-bob']
        with_name = await client.get('/api/v1/users', params={'login': 'fallback-carol'})
        assert [item['display_name'] for item in with_name.json()] == ['Carol K.']


async def test_display_name_fallback_in_contacts(client, app):
    await register(client, 'contact-alice@example.com')
    async with user_client(app) as bob_client, user_client(app) as carol_client:
        bob = await register(bob_client, 'contact-bob@example.com')
        carol = await register(carol_client, 'contact-carol@example.com')
        await put_profile(carol_client, app, {'display_name': 'Carol K.'})

        added_bob = await client.post('/api/v1/contacts', json={'user_id': bob['id']})
        assert added_bob.status_code == 201
        assert added_bob.json()['display_name'] == 'contact-bob'

        added_carol = await client.post('/api/v1/contacts', json={'user_id': carol['id']})
        assert added_carol.status_code == 201
        assert added_carol.json()['display_name'] == 'Carol K.'

        listed = await client.get('/api/v1/contacts')
        names = {item['id']: item['display_name'] for item in listed.json()}
        assert names == {bob['id']: 'contact-bob', carol['id']: 'Carol K.'}


async def test_display_name_fallback_in_chat_members_is_live(client, app):
    owner = await register(client, 'members-owner@example.com')
    chat_id = await make_chat(client, 'Names')

    async with user_client(app) as bob_client, user_client(app) as carol_client:
        bob = await register(bob_client, 'members-bob@example.com')
        carol = await register(carol_client, 'members-carol@example.com')
        await add_member(client, chat_id, bob['id'])
        await add_member(client, chat_id, carol['id'])
        await put_profile(carol_client, app, {'display_name': 'Carol K.'})

        members = await client.get(f'/api/v1/chats/{chat_id}/members')
        names = {item['id']: item['display_name'] for item in members.json()}
        assert names[owner['id']] == 'members-owner'
        assert names[bob['id']] == 'members-bob'
        assert names[carol['id']] == 'Carol K.'

        # the same shape in the batched GET /chats members
        chats = await chat_list(client)
        briefs = {item['id']: item['display_name'] for item in chats[chat_id]['members']}
        assert briefs == names

        # the brief is computed live: a later rename flows through immediately
        await put_profile(carol_client, app, {'display_name': 'Carol Second'})
        members = await client.get(f'/api/v1/chats/{chat_id}/members')
        names = {item['id']: item['display_name'] for item in members.json()}
        assert names[carol['id']] == 'Carol Second'


async def test_new_dm_title_prefers_target_display_name_and_stays_denormalized(client, app):
    await register(client, 'dm-alice@example.com')
    async with user_client(app) as bob_client, user_client(app) as carol_client:
        bob = await register(bob_client, 'dm-bob@example.com')
        carol = await register(carol_client, 'dm-carol@example.com')
        await put_profile(carol_client, app, {'display_name': 'Carol K.'})

        # NEW dms prefer the target display_name; the fallback stays the
        # email local part
        created = await client.post('/api/v1/chats/dm', json={'user_id': carol['id']})
        assert created.status_code == 201
        assert created.json()['title'] == 'Carol K.'
        fallback = await client.post('/api/v1/chats/dm', json={'user_id': bob['id']})
        assert fallback.status_code == 201
        assert fallback.json()['title'] == 'dm-bob'

        # an EXISTING dm keeps its creation-time title through later renames
        await put_profile(carol_client, app, {'display_name': 'Carol Second'})
        again = await client.post('/api/v1/chats/dm', json={'user_id': carol['id']})
        assert again.status_code == 200
        assert again.json()['id'] == created.json()['id']
        assert again.json()['title'] == 'Carol K.'
