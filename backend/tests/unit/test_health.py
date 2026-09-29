import pytest


pytestmark = pytest.mark.anyio


async def test_health_and_readiness(client):
    health_response = await client.get('/health')
    ready_response = await client.get('/ready')

    assert health_response.status_code == 200
    assert health_response.json() == {'status': 'ok'}
    assert ready_response.status_code == 200
    assert ready_response.json() == {'status': 'ready'}


async def test_health_is_available_under_api_prefix(client):
    response = await client.get('/api/v1/health')

    assert response.status_code == 200
    assert response.json() == {'status': 'ok'}
