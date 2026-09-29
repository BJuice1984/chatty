import pytest

from app.core.config import Settings
from app.seed import seed_admin


pytestmark = pytest.mark.anyio


def register_payload(email='user@example.com'):
    return {'email': email, 'password': 'correct horse battery staple'}


async def test_register_login_me_and_refresh_rotation(client):
    registered = await client.post('/api/v1/auth/register', json=register_payload())

    assert registered.status_code == 201
    assert registered.json()['role'] == 'user'
    old_refresh = client.cookies.get('chatty_refresh')
    csrf = client.cookies.get('chatty_csrf')
    assert old_refresh
    assert csrf

    me = await client.get('/api/v1/auth/me')
    assert me.status_code == 200
    assert me.json()['email'] == 'user@example.com'

    refreshed = await client.post('/api/v1/auth/refresh', headers={'X-CSRF-Token': csrf})

    assert refreshed.status_code == 200
    assert client.cookies.get('chatty_refresh') != old_refresh


async def test_refresh_requires_csrf_and_logout_clears_session(client):
    await client.post('/api/v1/auth/register', json=register_payload())

    rejected = await client.post('/api/v1/auth/refresh')
    assert rejected.status_code == 403

    csrf = client.cookies.get('chatty_csrf')
    logged_out = await client.post('/api/v1/auth/logout', headers={'X-CSRF-Token': csrf})

    assert logged_out.status_code == 200
    assert (await client.get('/api/v1/auth/me')).status_code == 401


async def test_origin_and_duplicate_email_are_rejected(client):
    forbidden = await client.post(
        '/api/v1/auth/register',
        json=register_payload(),
        headers={'Origin': 'https://unexpected.example'},
    )
    assert forbidden.status_code == 403

    assert (await client.post('/api/v1/auth/register', json=register_payload())).status_code == 201
    assert (await client.post('/api/v1/auth/register', json=register_payload())).status_code == 409


async def test_login_and_environment_only_admin_seed(client, session_factory):
    settings = Settings(
        environment='test',
        jwt_secret='test-secret-that-is-long-enough-for-jwt-signing',
        seed_admin_email='admin@example.com',
        seed_admin_password='another secure admin password',
    )
    with session_factory() as session:
        assert seed_admin(session, settings) is True

    logged_in = await client.post(
        '/api/v1/auth/login',
        json={'email': 'admin@example.com', 'password': 'another secure admin password'},
    )

    assert logged_in.status_code == 200
    assert logged_in.json()['role'] == 'admin'
