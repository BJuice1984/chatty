"""FastAPI application factory and internal-network middleware."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.endpoints.health import router as health_router
from app.api.v1.router import build_api_router
from app.core.config import Settings, get_settings
from app.db.session import create_database_engine, create_session_factory


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.settings.require_runtime_security()
    yield
    app.state.engine.dispose()


def create_app(settings: Settings | None = None, *, engine=None) -> FastAPI:
    runtime_settings = settings or get_settings()
    database_engine = engine or create_database_engine(runtime_settings)
    application = FastAPI(title=runtime_settings.app_name, lifespan=lifespan)
    application.state.settings = runtime_settings
    application.state.engine = database_engine
    application.state.session_factory = create_session_factory(database_engine)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=runtime_settings.allowed_origins,
        allow_credentials=True,
        allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allow_headers=['Content-Type', runtime_settings.csrf_header_name],
    )

    @application.middleware('http')
    async def request_size_limit(request: Request, call_next) -> Response:
        content_length = request.headers.get('content-length')
        if content_length and content_length.isdigit() and int(content_length) > runtime_settings.max_upload_bytes:
            return Response('request_too_large', status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        return await call_next(request)

    application.include_router(health_router)
    application.include_router(health_router, prefix=runtime_settings.api_prefix)
    application.include_router(build_api_router(), prefix=runtime_settings.api_prefix)
    return application


app = create_app()
