from __future__ import annotations

from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from httpx import ASGITransport, AsyncClient

from app.models.story import Story, StoryView
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


async def upload_story(client, name: str = 'story.png') -> dict:
    uploaded = await client.post(
        '/api/v1/stories',
        files={'uploaded': (name, b'story-image', 'image/png')},
    )
    assert uploaded.status_code == 201
    return uploaded.json()


async def test_story_upload_feed_and_viewed_state(client, app, session_factory):
    owner = await register(client, 'owner@example.com')

    viewer_client = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    viewer = await register(viewer_client, 'viewer@example.com')

    app.state.object_storage = MemoryStorage()

    empty = await client.get('/api/v1/stories')
    assert empty.status_code == 200
    assert empty.json() == []

    story = await upload_story(client)
    assert story['viewed'] is False
    assert story['owner_display_name'] == 'owner'
    assert story['image_url'].endswith('/download')

    feed = await client.get('/api/v1/stories')
    assert feed.status_code == 200
    items = feed.json()
    assert len(items) == 1
    assert items[0]['id'] == story['id']
    assert items[0]['viewed'] is False

    viewer_feed = await viewer_client.get('/api/v1/stories')
    assert viewer_feed.json()[0]['viewed'] is False

    viewed = await viewer_client.post(f"/api/v1/stories/{story['id']}/view")
    assert viewed.status_code == 204
    assert (await viewer_client.get('/api/v1/stories')).json()[0]['viewed'] is True
    # the view belongs to the viewer only
    assert (await client.get('/api/v1/stories')).json()[0]['viewed'] is False

    # idempotent: repeat view stays 204 and adds no extra row
    repeat = await viewer_client.post(f"/api/v1/stories/{story['id']}/view")
    assert repeat.status_code == 204
    with session_factory() as session:
        rows = session.query(StoryView).all()
        assert len(rows) == 1

    missing = await viewer_client.post('/api/v1/stories/999999/view')
    assert missing.status_code == 404
    await viewer_client.aclose()


async def test_story_feed_ordering_own_first(client, app):
    await register(client, 'mine@example.com')

    other_client = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    other = await register(other_client, 'other@example.com')

    app.state.object_storage = MemoryStorage()

    other_story = await upload_story(other_client, 'other-old.png')
    mine_story = await upload_story(client, 'mine.png')
    # чужая загружена ПОСЛЕ своей (новее по created_at): свои всё равно
    # первыми — заказ own-first, а не просто newest-first
    newest_other = await upload_story(other_client, 'other-new.png')

    feed = await client.get('/api/v1/stories')
    items = feed.json()
    assert [item['id'] for item in items] == [mine_story['id'], newest_other['id'], other_story['id']]
    await other_client.aclose()


async def test_expired_story_leaves_feed_but_view_stays_204(client, app, session_factory):
    await register(client, 'owner@example.com')
    app.state.object_storage = MemoryStorage()

    story = await upload_story(client)

    with session_factory() as session:
        stored = session.get(Story, story['id'])
        stored.created_at = datetime.now(UTC) - timedelta(hours=25)
        session.commit()

    feed = await client.get('/api/v1/stories')
    assert feed.json() == []

    still_view = await client.post(f"/api/v1/stories/{story['id']}/view")
    assert still_view.status_code == 204


async def test_stories_require_authentication(client, app):
    app.state.object_storage = MemoryStorage()

    anonymous = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    assert (await anonymous.get('/api/v1/stories')).status_code == 401
    assert (
        await anonymous.post('/api/v1/stories', files={'uploaded': ('s.png', b'x', 'image/png')})
    ).status_code == 401
    await anonymous.aclose()

async def test_story_delete_own_only(client, app):
    owner = await register(client, 'owner@example.com')

    other_client = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    other = await register(other_client, 'other@example.com')

    storage = MemoryStorage()
    app.state.object_storage = storage

    story = await upload_story(client)

    assert (await other_client.delete(f"/api/v1/stories/{story['id']}")).status_code == 403
    assert (await other_client.delete('/api/v1/stories/999999')).status_code == 404

    deleted = await client.delete(f"/api/v1/stories/{story['id']}")
    assert deleted.status_code == 204
    assert (await client.get('/api/v1/stories')).json() == []

    anonymous = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    assert (await anonymous.delete('/api/v1/stories/1')).status_code == 401
    await anonymous.aclose()
    await other_client.aclose()
