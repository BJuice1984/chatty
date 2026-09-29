from __future__ import annotations

import os

os.environ['CHATTY_ENVIRONMENT'] = 'test'
os.environ['CHATTY_JWT_SECRET'] = 'test-secret-that-is-long-enough-for-jwt-signing'

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.db.base import Base
from app.main import create_app
from app.db.session import create_session_factory


@pytest.fixture()
def test_settings() -> Settings:
    return Settings(
        environment='test',
        database_url='sqlite://',
        jwt_secret='test-secret-that-is-long-enough-for-jwt-signing',
        allowed_origins=['http://localhost:3000'],
        cookie_secure=False,
    )


@pytest.fixture()
def anyio_backend():
    return 'asyncio'


@pytest.fixture()
def app(test_settings: Settings):
    engine = create_engine(
        test_settings.database_url,
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    application = create_app(test_settings, engine=engine)
    yield application
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://testserver') as test_client:
        yield test_client


@pytest.fixture()
def session_factory(app):
    return app.state.session_factory
