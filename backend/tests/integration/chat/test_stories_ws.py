"""Global stories WS channel: auth, keepalive, created/deleted fan-out."""

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

    def delete(self, object_key: str) -> None:
        self.objects.pop(object_key, None)


ORIGIN = {'Origin': 'http://localhost:3000'}


def register(client: TestClient, email: str) -> dict:
    response = client.post(
        '/api/v1/auth/register',
        json={'email': email, 'password': 'correct horse battery staple'},
    )
    assert response.status_code == 201
    return response.json()


def upload_story(client: TestClient) -> dict:
    uploaded = client.post(
        '/api/v1/stories',
        files={'uploaded': ('story.png', b'story-image', 'image/png')},
    )
    assert uploaded.status_code == 201
    return uploaded.json()


def test_stories_socket_rejects_anonymous_and_foreign_origin(app):
    with TestClient(app) as client:
        register(client, 'stories-ws-guard@example.com')
        # валидная cookie, но чужой Origin -> 1008, как у чат-сокета
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/api/v1/ws/stories', headers={'Origin': 'http://evil.example'}):
                pass
        # без cookie аутентификация не проходит
        client.cookies.clear()
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/api/v1/ws/stories', headers=ORIGIN):
                pass


def test_stories_socket_answers_keepalive_ping(app):
    with TestClient(app) as client:
        register(client, 'stories-ws-ping@example.com')
        with client.websocket_connect('/api/v1/ws/stories', headers=ORIGIN) as websocket:
            websocket.send_json({'type': 'ping', 'content': {}})
            assert websocket.receive_json() == {'type': 'pong', 'content': {}}
            # прочие события молча игнорируются: канал только для пушей
            websocket.send_json({'type': 'history', 'content': {'limit': 5}})
            websocket.send_json({'type': 'ping', 'content': {}})
            assert websocket.receive_json() == {'type': 'pong', 'content': {}}


def test_story_created_fans_out_to_everyone_then_deleted_reaches_all(app):
    app.state.object_storage = MemoryStorage()
    with TestClient(app) as owner_client, \
            TestClient(app) as second_client, \
            TestClient(app) as third_client:
        owner = register(owner_client, 'stories-ws-owner@example.com')
        register(second_client, 'stories-ws-second@example.com')
        register(third_client, 'stories-ws-third@example.com')

        with second_client.websocket_connect('/api/v1/ws/stories', headers=ORIGIN) as second, \
                third_client.websocket_connect('/api/v1/ws/stories', headers=ORIGIN) as third, \
                owner_client.websocket_connect('/api/v1/ws/stories', headers=ORIGIN) as owner_socket:
            story = upload_story(owner_client)

            # владелец тоже получает кадр (его другие вкладки не ждут
            # рефетча); фиксированная форма остаётся — is_own=false даже
            # автору, владелецская вкладка правит по owner_id на клиенте
            for recipient in (second, third, owner_socket):
                event = recipient.receive_json()
                assert event['type'] == 'story_created'
                content = event['content']
                assert content['id'] == story['id']
                assert content['owner_id'] == owner['id']
                # фиксированная форма: новая история всем чужая и непросмотрена
                assert content['viewed'] is False
                assert content['is_own'] is False
                assert content['image_url'].endswith('/download')

            # порядок кадров на сокете владельца: за story_created идёт pong
            owner_socket.send_json({'type': 'ping', 'content': {}})
            assert owner_socket.receive_json() == {'type': 'pong', 'content': {}}

            deleted = owner_client.delete(f"/api/v1/stories/{story['id']}")
            assert deleted.status_code == 204
            deletion = {'type': 'story_deleted', 'content': {'story_id': story['id']}}
            assert second.receive_json() == deletion
            assert third.receive_json() == deletion


def test_story_events_skip_disconnected_recipient(app):
    app.state.object_storage = MemoryStorage()
    with TestClient(app) as owner_client, \
            TestClient(app) as second_client, \
            TestClient(app) as third_client:
        register(owner_client, 'stories-ws-gone-owner@example.com')
        register(second_client, 'stories-ws-gone-second@example.com')
        register(third_client, 'stories-ws-gone-third@example.com')

        with second_client.websocket_connect('/api/v1/ws/stories', headers=ORIGIN):
            pass  # сразу закрыли: получатель отпал до события

        with third_client.websocket_connect('/api/v1/ws/stories', headers=ORIGIN) as third:
            upload_story(owner_client)
            assert third.receive_json()['type'] == 'story_created'
