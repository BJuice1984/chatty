"""The refresh-cookie contract behind silent session renewal: login issues
the access/refresh/csrf cookie triple, POST /auth/refresh rotates the
one-shot refresh token (the previous cookie dies with refresh_token_rotated,
the fresh one reissues all three cookies), csrf double-submit is enforced on
the rotation itself, protected routes answer the documented 401 details for
missing/corrupted access cookies and authorize again after a refresh, and
logout retires the refresh cookie via the token_version bump."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from fastapi import FastAPI

pytestmark = pytest.mark.anyio

PASSWORD = 'correct horse battery staple'

# httpx stores response cookies under this jar domain (base_url host mapping)
JAR_DOMAIN = 'testserver.local'


def force_cookie(client: AsyncClient, app: FastAPI, name: str, value: str) -> None:
    """Overwrite EXACTLY the jar record the server set (same domain+path), so
    no duplicate cookie shadows the substitution."""
    settings = app.state.settings
    path = f'{settings.api_prefix}/auth' if name == settings.refresh_cookie_name else '/'
    client.cookies.set(name, value, domain=JAR_DOMAIN, path=path)


async def register_user(app: FastAPI, email: str) -> None:
    """Register through a THROWAWAY client so the caller starts cookie-free
    (register itself sets a session — irrelevant for these flows)."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://testserver') as client:
        response = await client.post('/api/v1/auth/register', json={'email': email, 'password': PASSWORD})
        assert response.status_code == 201


def csrf_header(client: AsyncClient, app: FastAPI) -> dict[str, str]:
    return {'X-CSRF-Token': client.cookies.get(app.state.settings.csrf_cookie_name)}


async def login(client: AsyncClient, email: str) -> None:
    response = await client.post('/api/v1/auth/login', json={'email': email, 'password': PASSWORD})
    assert response.status_code == 200


async def make_chat(client: AsyncClient) -> int:
    response = await client.post('/api/v1/chats', json={'title': 'refresh-contract'})
    assert response.status_code == 201
    return response.json()['id']


# --- login issues the whole cookie triple --------------------------------------


async def test_login_issues_access_refresh_and_csrf_cookies(client, app):
    await register_user(app, 'fresh@example.com')
    await login(client, 'fresh@example.com')

    settings = app.state.settings
    assert client.cookies.get(settings.access_cookie_name)
    assert client.cookies.get(settings.refresh_cookie_name)
    assert client.cookies.get(settings.csrf_cookie_name)


# --- rotation is one-shot and reissues every cookie ----------------------------


async def test_refresh_rotates_and_reissues_cookies(client, app):
    await register_user(app, 'rotate@example.com')
    await login(client, 'rotate@example.com')
    settings = app.state.settings

    old_refresh = client.cookies.get(settings.refresh_cookie_name)
    old_access = client.cookies.get(settings.access_cookie_name)

    response = await client.post('/api/v1/auth/refresh', headers=csrf_header(client, app))

    assert response.status_code == 200
    body = response.json()
    assert body['email'] == 'rotate@example.com'
    assert client.cookies.get(settings.refresh_cookie_name) != old_refresh
    assert client.cookies.get(settings.access_cookie_name) != old_access
    assert client.cookies.get(settings.csrf_cookie_name)


async def test_previous_refresh_cookie_is_dead_after_rotation(client, app):
    await register_user(app, 'replay@example.com')
    await login(client, 'replay@example.com')
    settings = app.state.settings

    old_refresh = client.cookies.get(settings.refresh_cookie_name)
    first = await client.post('/api/v1/auth/refresh', headers=csrf_header(client, app))
    assert first.status_code == 200

    client.cookies.set(settings.refresh_cookie_name, old_refresh, domain=JAR_DOMAIN, path=f'{settings.api_prefix}/auth')
    replay = await client.post('/api/v1/auth/refresh', headers=csrf_header(client, app))

    assert replay.status_code == 401
    assert replay.json()['detail'] == 'refresh_token_rotated'


# --- refresh enforcement --------------------------------------------------------


async def test_refresh_without_cookie_is_rejected(client, app):
    """csrf passes (the cookie triple is issued by login), the refresh cookie
    itself is gone → 401 refresh_required (csrf runs first in the endpoint,
    so a header-less probe is covered by the 403 case below)."""
    await register_user(app, 'nocookie@example.com')
    await login(client, 'nocookie@example.com')
    settings = app.state.settings

    client.cookies.delete(settings.refresh_cookie_name, domain=JAR_DOMAIN, path=f'{settings.api_prefix}/auth')
    response = await client.post('/api/v1/auth/refresh', headers=csrf_header(client, app))

    assert response.status_code == 401
    assert response.json()['detail'] == 'refresh_required'


async def test_refresh_without_csrf_header_is_forbidden(client, app):
    await register_user(app, 'csrf@example.com')
    await login(client, 'csrf@example.com')

    response = await client.post('/api/v1/auth/refresh')

    assert response.status_code == 403
    assert response.json()['detail'] == 'csrf_failed'


# --- protected routes answer the documented 401 details ------------------------


async def test_chats_without_access_cookie_requires_authentication(client, app):
    await register_user(app, 'missing@example.com')
    await login(client, 'missing@example.com')
    settings = app.state.settings

    client.cookies.delete(settings.access_cookie_name)
    response = await client.get('/api/v1/chats')

    assert response.status_code == 401
    assert response.json()['detail'] == 'authentication_required'


async def test_chats_with_corrupted_access_cookie_reports_invalid_token(client, app):
    await register_user(app, 'corrupt@example.com')
    await login(client, 'corrupt@example.com')
    settings = app.state.settings

    force_cookie(client, app, settings.access_cookie_name, 'not-a-jwt')
    response = await client.get('/api/v1/chats')

    assert response.status_code == 401
    assert response.json()['detail'] == 'invalid_token'


async def test_refreshed_access_cookie_authorizes_again(client, app):
    await register_user(app, 'healed@example.com')
    await login(client, 'healed@example.com')
    settings = app.state.settings
    await make_chat(client)

    force_cookie(client, app, settings.access_cookie_name, 'not-a-jwt')
    blocked = await client.get('/api/v1/chats')
    assert blocked.status_code == 401

    refreshed = await client.post('/api/v1/auth/refresh', headers=csrf_header(client, app))
    assert refreshed.status_code == 200

    allowed = await client.get('/api/v1/chats')

    assert allowed.status_code == 200
    assert [chat['title'] for chat in allowed.json()] == ['refresh-contract']


# --- logout retires the refresh cookie ------------------------------------------


async def test_logout_kills_the_refresh_cookie(client, app):
    await register_user(app, 'gone@example.com')
    await login(client, 'gone@example.com')
    settings = app.state.settings

    old_refresh = client.cookies.get(settings.refresh_cookie_name)
    old_csrf = client.cookies.get(settings.csrf_cookie_name)
    response = await client.post('/api/v1/auth/logout', headers=csrf_header(client, app))
    assert response.status_code == 200

    # logout cleared every cookie; restore the csrf pair by hand so the
    # probe proves the REFRESH token died (token_version bump), not csrf
    client.cookies.set(settings.refresh_cookie_name, old_refresh, domain=JAR_DOMAIN, path=f'{settings.api_prefix}/auth')
    force_cookie(client, app, settings.csrf_cookie_name, old_csrf)
    replay = await client.post('/api/v1/auth/refresh', headers=csrf_header(client, app))

    assert replay.status_code == 401
    assert replay.json()['detail'] == 'refresh_token_rotated'
