from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.anyio


async def register(client, email: str) -> dict:
    response = await client.post(
        '/api/v1/auth/register',
        json={'email': email, 'password': 'correct horse battery staple'},
    )
    assert response.status_code == 201
    return response.json()


async def make_chat(client, title: str) -> int:
    response = await client.post('/api/v1/chats', json={'title': title})
    assert response.status_code == 201
    return response.json()['id']


async def post_message(client, chat_id: int, content: str) -> dict:
    response = await client.post(f'/api/v1/chats/{chat_id}/messages', json={'content': content})
    assert response.status_code == 201
    return response.json()


async def search(client, q: str) -> dict:
    # сам 200 (а не 422 от /{chat_id}) пинит порядок регистрации: /search
    # объявлен раньше int-маршрута
    response = await client.get('/api/v1/chats/search', params={'q': q})
    assert response.status_code == 200
    return response.json()


async def test_search_matches_title_message_and_both(client):
    owner = await register(client, 'owner@example.com')

    title_only = await make_chat(client, 'Release Notes')
    message_only = await make_chat(client, 'Watercooler')
    both = await make_chat(client, 'notes sync')
    unrelated = await make_chat(client, 'Random')
    await post_message(client, unrelated, 'hello there')

    # message-only: свежайшее совпадающее сообщение даёт сниппет, окно 32/32
    await post_message(client, message_only, 'first notes occurrence draft')
    freshest = await post_message(client, message_only, 'a' * 40 + 'Notes' + 'b' * 40)

    # both: сниппет из сообщения (первое вхождение, сырые подстроки)
    await post_message(client, both, 'old notes draft')
    both_freshest = await post_message(client, both, 'notes first notes second')

    body = await search(client, 'notes')

    assert body['query'] == 'notes'
    by_chat = {item['chat_id']: item for item in body['results']}
    assert set(by_chat) == {title_only, message_only, both}

    assert by_chat[title_only] == {
        'chat_id': title_only,
        'matched_in': 'title',
        'snippet': None,
        'last_match_at': None,
    }

    message_row = by_chat[message_only]
    assert message_row['matched_in'] == 'message'
    assert message_row['snippet'] == {
        'before': 'a' * 32,
        'match': 'Notes',  # сырая подстрока оригинала, без смены регистра
        'after': 'b' * 32,
    }
    assert message_row['last_match_at'] == freshest['created_at']

    both_row = by_chat[both]
    assert both_row['matched_in'] == 'both'
    # первое вхождение (не второе), до/после не обрезаны
    assert both_row['snippet'] == {'before': '', 'match': 'notes', 'after': ' first notes second'}
    assert both_row['last_match_at'] == both_freshest['created_at']


async def test_search_snippet_parts_are_raw_substrings(client):
    owner = await register(client, 'owner@example.com')
    chat = await make_chat(client, 'Markup talk')
    # разметка в контенте должна проехать как сырой текст: сервер не
    # экранирует (единственный XSS-шов — клиент)
    await post_message(client, chat, 'echo <script>alert(1)</script> tail')

    body = await search(client, 'script')
    assert body['results'][0]['snippet'] == {
        'before': 'echo <',
        'match': 'script',
        'after': '>alert(1)</script> tail',
    }


async def test_search_is_case_insensitive_for_ascii(client):
    # ASCII-образцы только: SQLite в тестах сворачивает регистр лишь для
    # ASCII, кириллический фолдинг — поведение PostgreSQL-рантайма
    owner = await register(client, 'owner@example.com')
    upper_title = await make_chat(client, 'Project CHAT')
    await make_chat(client, 'unrelated')

    by_title = await search(client, 'project chat')
    assert [item['chat_id'] for item in by_title['results']] == [upper_title]

    lower_title = await make_chat(client, 'quiet room')
    chat = lower_title
    await post_message(client, chat, 'hello WORLD from the test')

    by_message = await search(client, 'world')
    assert [item['chat_id'] for item in by_message['results']] == [chat]
    assert by_message['results'][0]['matched_in'] == 'message'


async def test_search_escapes_like_wildcards(client):
    owner = await register(client, 'owner@example.com')

    percent = await make_chat(client, 'progress 100% done')
    await make_chat(client, 'progress 100x done')  # ловушка: % — не wildcard
    underscore = await make_chat(client, 'a_b')
    await make_chat(client, 'axb')  # ловушка: _ — не «любой символ»
    backslash = await make_chat(client, 'path C:\\Temp note')
    await make_chat(client, 'path CTemp note')  # ловушка: \ не гасит T
    message_chat = await make_chat(client, 'shop talk')
    await post_message(client, message_chat, 'rate 50% off today')
    decoy_chat = await make_chat(client, 'decoy talk')
    await post_message(client, decoy_chat, 'rate 50 off today')

    assert [item['chat_id'] for item in (await search(client, '100%'))['results']] == [percent]
    assert [item['chat_id'] for item in (await search(client, 'a_b'))['results']] == [underscore]
    assert [item['chat_id'] for item in (await search(client, 'C:\\Temp'))['results']] == [backslash]
    assert [item['chat_id'] for item in (await search(client, '50%'))['results']] == [message_chat]


async def test_search_ignores_file_only_messages(client, app):
    from tests.integration.chat.test_media_api import MemoryStorage

    owner = await register(client, 'owner@example.com')
    app.state.object_storage = MemoryStorage()

    file_chat = await make_chat(client, 'Files')
    uploaded = await client.post(
        '/api/v1/files',
        data={'chat_id': str(file_chat)},
        files={'uploaded': ('notes.txt', b'private notes', 'text/plain')},
    )
    assert uploaded.status_code == 201
    file_only = await client.post(
        f'/api/v1/chats/{file_chat}/messages',
        json={'file_id': uploaded.json()['file_id']},
    )
    assert file_only.status_code == 201
    assert file_only.json()['content'] is None

    text_chat = await make_chat(client, 'Letters')
    await post_message(client, text_chat, 'text notes here')

    # NULL-content никогда не совпадает: имя файла не ищется, чат с
    # файловым сообщением не появляется по «notes»
    body = await search(client, 'notes')
    assert [item['chat_id'] for item in body['results']] == [text_chat]
    assert (await search(client, 'notes.txt'))['results'] == []


async def test_search_scopes_to_membership(client, app):
    owner = await register(client, 'owner@example.com')

    outsider_client = AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver')
    outsider = await register(outsider_client, 'outsider@example.com')

    owner_chat = await make_chat(client, 'secret keyword project')
    await post_message(client, owner_chat, 'hidden keyword treasure')
    outsider_chat = await make_chat(outsider_client, 'my keyword diary')

    # каждый видит только свои чаты — чужие никогда не появляются
    owner_results = await search(client, 'keyword')
    assert [item['chat_id'] for item in owner_results['results']] == [owner_chat]

    outsider_results = await search(outsider_client, 'keyword')
    assert [item['chat_id'] for item in outsider_results['results']] == [outsider_chat]
    await outsider_client.aclose()


async def test_search_orders_title_group_first_then_messages_by_freshness(client):
    owner = await register(client, 'owner@example.com')

    title_first = await make_chat(client, 'aaa goal')  # title-only
    same_title_older = await make_chat(client, 'mid goal')  # title-only
    same_title_newer = await make_chat(client, 'mid goal')  # both
    title_last = await make_chat(client, 'zzz goal sync')  # both
    await post_message(client, same_title_newer, 'goal in message')
    await post_message(client, title_last, 'goal in message too')

    # только-сообщения: свежее совпадение раньше (M2 отправлено позже M1)
    message_later = await make_chat(client, 'quiet one')
    message_earlier = await make_chat(client, 'quiet two')
    await post_message(client, message_earlier, 'goal earlier')
    await post_message(client, message_later, 'goal later')
    await make_chat(client, 'unrelated')

    body = await search(client, 'goal')

    assert [item['chat_id'] for item in body['results']] == [
        title_first,  # группа title: title ASC...
        same_title_older,  # ...одинаковые title — chat_id ASC
        same_title_newer,
        title_last,
        message_later,  # группа сообщений: last_match_at DESC
        message_earlier,
    ]
    matched = {item['chat_id']: item['matched_in'] for item in body['results']}
    assert matched[title_first] == 'title'
    assert matched[same_title_older] == 'title'
    assert matched[same_title_newer] == 'both'
    assert matched[title_last] == 'both'
    assert matched[message_later] == 'message'
    assert matched[message_earlier] == 'message'


async def test_search_caps_results_at_50(client):
    owner = await register(client, 'owner@example.com')

    chat_ids = [await make_chat(client, f'bulk {index:02d}') for index in range(55)]

    body = await search(client, 'bulk')
    # cap применяется после сортировки: остаются первые 50 по title ASC
    assert [item['chat_id'] for item in body['results']] == chat_ids[:50]


async def test_search_validates_query_length(client):
    owner = await register(client, 'owner@example.com')

    assert (await client.get('/api/v1/chats/search', params={'q': ''})).status_code == 422
    assert (await client.get('/api/v1/chats/search')).status_code == 422
    assert (await client.get('/api/v1/chats/search', params={'q': 'x' * 201})).status_code == 422

    boundary = await client.get('/api/v1/chats/search', params={'q': 'x' * 200})
    assert boundary.status_code == 200
    assert boundary.json()['results'] == []


async def test_search_requires_authentication(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver') as anon:
        response = await anon.get('/api/v1/chats/search', params={'q': 'anything'})
    assert response.status_code == 401
