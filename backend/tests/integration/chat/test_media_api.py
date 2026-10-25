from __future__ import annotations

from io import BytesIO

import pytest
from httpx import ASGITransport, AsyncClient

from app.services.files import DownloadedObject


class MemoryStorage:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}

    def upload(self, object_key: str, body: bytes, content_type: str) -> None:
        self.objects[object_key] = (body, content_type)

    def download(self, object_key: str) -> DownloadedObject:
        body, content_type = self.objects[object_key]
        return DownloadedObject(BytesIO(body), content_type, len(body))

    def delete(self, object_key: str) -> None:
        self.objects.pop(object_key, None)


pytestmark = pytest.mark.anyio


async def register(client, email: str) -> dict:
    response = await client.post(
        '/api/v1/auth/register',
        json={'email': email, 'password': 'correct horse battery staple'},
    )
    assert response.status_code == 201
    return response.json()


async def upload_user_avatar(client, user_id: int) -> dict:
    uploaded = await client.post(
        '/api/v1/files/avatars',
        data={'kind': 'user'},
        files={'uploaded': ('me.png', b'avatar-bytes', 'image/png')},
    )
    assert uploaded.status_code == 201
    return uploaded.json()


async def test_user_avatar_flows_into_auth_me_and_members(client, app):
    owner = await register(client, 'owner@example.com')

    other = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    member = await register(other, 'member@example.com')

    storage = MemoryStorage()
    app.state.object_storage = storage

    avatar = await upload_user_avatar(client, owner['id'])
    assert avatar['status'] == 'ready'
    assert avatar['chat_id'] is None
    assert avatar['avatar_url'] == f"{avatar['file_id']}/download"

    me = await client.get('/api/v1/auth/me')
    assert me.status_code == 200
    assert me.json()['avatar_url'] == avatar['avatar_url']

    created = await client.post('/api/v1/chats', json={'title': 'With avatar'})
    chat_id = created.json()['id']
    await client.post(f'/api/v1/chats/{chat_id}/members', json={'user_id': member['id']})

    members = await other.get(f'/api/v1/chats/{chat_id}/members')
    assert members.status_code == 200
    by_id = {item['id']: item for item in members.json()}
    assert by_id[owner['id']]['avatar_url'] == avatar['avatar_url']
    assert by_id[member['id']]['avatar_url'] is None
    await other.aclose()


async def test_chat_avatar_owner_only_and_chat_list(client, app):
    owner = await register(client, 'owner@example.com')

    outsider_client = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    outsider = await register(outsider_client, 'outsider@example.com')

    storage = MemoryStorage()
    app.state.object_storage = storage

    created = await client.post('/api/v1/chats', json={'title': 'Project'})
    chat_id = created.json()['id']

    denied = await outsider_client.post(
        f'/api/v1/files/avatars',
        data={'kind': 'chat', 'chat_id': str(chat_id)},
        files={'uploaded': ('ava.png', b'chat-avatar', 'image/png')},
    )
    assert denied.status_code == 403

    uploaded = await client.post(
        '/api/v1/files/avatars',
        data={'kind': 'chat', 'chat_id': str(chat_id)},
        files={'uploaded': ('ava.png', b'chat-avatar', 'image/png')},
    )
    assert uploaded.status_code == 201
    avatar_url = uploaded.json()['avatar_url']

    chats = await client.get('/api/v1/chats')
    assert chats.status_code == 200
    target = next(item for item in chats.json() if item['id'] == chat_id)
    assert target['avatar_url'] == avatar_url
    # состав в списке: форма members-эндпоинта, chat-аватар не подменяет
    # аватар участника (у owner нет user-аватара)
    assert [member['id'] for member in target['members']] == [owner['id']]
    assert target['members'][0]['login'] == 'owner@example.com'
    assert target['members'][0]['display_name'] == 'owner'
    assert target['members'][0]['avatar_url'] is None
    await outsider_client.aclose()


async def test_user_avatar_flows_into_chats_list_members(client, app):
    owner = await register(client, 'owner@example.com')

    other = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    member = await register(other, 'member@example.com')

    storage = MemoryStorage()
    app.state.object_storage = storage

    avatar = await upload_user_avatar(client, owner['id'])

    created = await client.post('/api/v1/chats', json={'title': 'Duo'})
    chat_id = created.json()['id']
    await client.post(f'/api/v1/chats/{chat_id}/members', json={'user_id': member['id']})

    # диалог: реальный avatar_url собеседника приезжает прямо в список
    chats = await other.get('/api/v1/chats')
    assert chats.status_code == 200
    target = next(item for item in chats.json() if item['id'] == chat_id)
    by_id = {item['id']: item for item in target['members']}
    assert by_id[owner['id']]['avatar_url'] == avatar['avatar_url']
    assert by_id[member['id']]['avatar_url'] is None

    # members-эндпоинт не меняется: полный состав, форма та же
    members = await other.get(f'/api/v1/chats/{chat_id}/members')
    assert members.status_code == 200
    assert {item['id']: item['avatar_url'] for item in members.json()} == {
        owner['id']: avatar['avatar_url'],
        member['id']: None,
    }
    await other.aclose()


async def test_chats_list_members_cap_keeps_dialogs_and_full_members_endpoint(client, app):
    owner = await register(client, 'owner@example.com')
    created = await client.post('/api/v1/chats', json={'title': 'Crowd'})
    chat_id = created.json()['id']

    joined_ids = [owner['id']]
    for index in range(11):
        helper = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
        user = await register(helper, f'u{index:02d}@example.com')
        await helper.aclose()
        added = await client.post(f'/api/v1/chats/{chat_id}/members', json={'user_id': user['id']})
        assert added.status_code == 201
        joined_ids.append(user['id'])

    chats = await client.get('/api/v1/chats')
    target = next(item for item in chats.json() if item['id'] == chat_id)
    # cap 10 по joined_at ASC (порядок вступления), диалоги не режутся
    assert len(target['members']) == 10
    assert [member['id'] for member in target['members']] == joined_ids[:10]

    # members-эндпоинт остаётся полным и без cap, user_id ASC
    full = await client.get(f'/api/v1/chats/{chat_id}/members')
    assert full.status_code == 200
    assert len(full.json()) == 12
    assert [member['id'] for member in full.json()] == sorted(joined_ids)


async def test_avatar_upload_rejects_non_images(client, app):
    await register(client, 'owner@example.com')
    app.state.object_storage = MemoryStorage()

    rejected = await client.post(
        '/api/v1/files/avatars',
        data={'kind': 'user'},
        files={'uploaded': ('notes.txt', b'private notes', 'text/plain')},
    )
    assert rejected.status_code == 400
    assert rejected.json()['detail'] == 'invalid_content_type'

    wrong_kind = await client.post(
        '/api/v1/files/avatars',
        data={'kind': 'group'},
        files={'uploaded': ('me.png', b'avatar-bytes', 'image/png')},
    )
    assert wrong_kind.status_code == 400
    assert wrong_kind.json()['detail'] == 'invalid_avatar_kind'

    chat_avatar_without_id = await client.post(
        '/api/v1/files/avatars',
        data={'kind': 'chat'},
        files={'uploaded': ('me.png', b'avatar-bytes', 'image/png')},
    )
    assert chat_avatar_without_id.status_code == 400
    assert chat_avatar_without_id.json()['detail'] == 'chat_id_required'


async def test_avatar_upload_rejects_oversize(client, app):
    await register(client, 'owner@example.com')
    app.state.object_storage = MemoryStorage()

    oversized = b'x' * (10 * 1024 * 1024 + 1)
    rejected = await client.post(
        '/api/v1/files/avatars',
        data={'kind': 'user'},
        files={'uploaded': ('big.png', oversized, 'image/png')},
    )
    assert rejected.status_code == 413


async def test_global_media_download_vs_chat_attachments(client, app):
    owner = await register(client, 'owner@example.com')

    outsider_client = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    outsider = await register(outsider_client, 'outsider@example.com')

    storage = MemoryStorage()
    app.state.object_storage = storage

    created = await client.post('/api/v1/chats', json={'title': 'Project'})
    chat_id = created.json()['id']

    attachment = await client.post(
        '/api/v1/files',
        data={'chat_id': str(chat_id)},
        files={'uploaded': ('notes.txt', b'private notes', 'text/plain')},
    )
    assert attachment.status_code == 201
    attachment_id = attachment.json()['file_id']

    avatar = await upload_user_avatar(client, owner['id'])
    avatar_id = avatar['file_id']

    # regression: chat attachments stay participant-only...
    assert (await outsider_client.get(f'/api/v1/files/{attachment_id}/download')).status_code == 403
    # ...while global media (avatars, stories) is open to any authenticated user
    downloaded = await outsider_client.get(f'/api/v1/files/{avatar_id}/download')
    assert downloaded.status_code == 200
    assert downloaded.content == b'avatar-bytes'

    anonymous = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    assert (await anonymous.get(f'/api/v1/files/{avatar_id}/download')).status_code == 401
    await anonymous.aclose()
    await outsider_client.aclose()
