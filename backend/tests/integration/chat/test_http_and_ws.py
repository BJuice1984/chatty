from __future__ import annotations

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.services.files import DownloadedObject


class MemoryStorage:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}

    def upload(self, object_key: str, body: bytes, content_type: str) -> None:
        self.objects[object_key] = (body, content_type)

    def download(self, object_key: str) -> DownloadedObject:
        body, content_type = self.objects[object_key]
        return DownloadedObject(BytesIO(body), content_type, len(body))


pytestmark = pytest.mark.anyio


async def register(client, email: str) -> dict:
    response = await client.post(
        '/api/v1/auth/register',
        json={'email': email, 'password': 'correct horse battery staple'},
    )
    assert response.status_code == 201
    return response.json()


async def test_chat_membership_messages_history_and_private_file(client, app):
    owner = await register(client, 'owner@example.com')

    from httpx import ASGITransport, AsyncClient

    outsider_client = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    member = await register(outsider_client, 'member@example.com')
    outsider_client_2 = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    outsider = await register(outsider_client_2, 'outsider@example.com')

    created = await client.post('/api/v1/chats', json={'title': 'Project'})
    assert created.status_code == 201
    chat_id = created.json()['id']

    added = await client.post(f'/api/v1/chats/{chat_id}/members', json={'user_id': member['id']})
    assert added.status_code == 201

    first = await client.post(
        f'/api/v1/chats/{chat_id}/messages',
        json={'content': 'hello', 'client_message_id': 'http-1'},
    )
    duplicate = await client.post(
        f'/api/v1/chats/{chat_id}/messages',
        json={'content': 'different text', 'client_message_id': 'http-1'},
    )
    assert first.status_code == 201
    assert duplicate.status_code == 201
    assert duplicate.json()['id'] == first.json()['id']

    for index in range(2):
        response = await client.post(
            f'/api/v1/chats/{chat_id}/messages',
            json={'content': f'message-{index}', 'client_message_id': f'http-{index + 2}'},
        )
        assert response.status_code == 201

    history = await client.get(f'/api/v1/chats/{chat_id}/messages', params={'limit': 2})
    assert history.status_code == 200
    assert len(history.json()['messages']) == 2
    assert history.json()['next_before_id'] is not None

    storage = MemoryStorage()
    app.state.object_storage = storage
    uploaded = await client.post(
        '/api/v1/files',
        data={'chat_id': str(chat_id)},
        files={'uploaded': ('notes.txt', b'private notes', 'text/plain')},
    )
    assert uploaded.status_code == 201
    file_data = uploaded.json()
    assert file_data['status'] == 'ready'
    assert file_data['object_key'].startswith(f'chat/{chat_id}/')

    downloaded = await client.get(f"/api/v1/files/{file_data['file_id']}/download")
    assert downloaded.status_code == 200
    assert downloaded.content == b'private notes'
    assert 'attachment' in downloaded.headers['content-disposition']

    assert (await outsider_client_2.get(f'/api/v1/chats/{chat_id}')).status_code == 403
    assert (await outsider_client_2.post(f'/api/v1/chats/{chat_id}/messages', json={'content': 'nope'})).status_code == 403
    assert (await outsider_client_2.get(f"/api/v1/files/{file_data['file_id']}/download")).status_code == 403

    anonymous = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    assert (await anonymous.get(f'/api/v1/chats/{chat_id}')).status_code == 401
    await anonymous.aclose()
    await outsider_client.aclose()
    await outsider_client_2.aclose()

    assert outsider['id'] != owner['id']


def test_websocket_uses_cookie_auth_and_typed_events(app):
    with TestClient(app) as client:
        registered = client.post(
            '/api/v1/auth/register',
            json={'email': 'socket-owner@example.com', 'password': 'correct horse battery staple'},
        )
        chat = client.post('/api/v1/chats', json={'title': 'Socket'}).json()

        with client.websocket_connect(
            f"/api/v1/ws/chats/{chat['id']}",
            headers={'Origin': 'http://localhost:3000'},
        ) as websocket:
            websocket.send_json(
                {
                    'type': 'message',
                    'content': {'content': 'over socket', 'client_message_id': 'socket-1'},
                }
            )
            event = websocket.receive_json()
            assert event['type'] == 'message'
            assert event['content']['content'] == 'over socket'

            websocket.send_json({'type': 'history', 'content': {'limit': 10}})
            history = websocket.receive_json()
            assert history['type'] == 'history'
            assert history['content']['messages'][0]['content'] == 'over socket'

        assert registered.status_code == 201

        client.cookies.clear()
        outsider = client.post(
            '/api/v1/auth/register',
            json={'email': 'socket-outsider@example.com', 'password': 'correct horse battery staple'},
        )
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                f"/api/v1/ws/chats/{chat['id']}",
                headers={'Origin': 'http://localhost:3000'},
            ):
                pass
