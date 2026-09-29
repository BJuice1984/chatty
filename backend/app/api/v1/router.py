"""Stable API composition seam for later domain packages."""

from collections.abc import Iterable

from fastapi import APIRouter

from app.api.v1.endpoints import auth


_domain_routers: list[APIRouter] = []


def register_domain_router(router: APIRouter) -> None:
    """Register a later domain router before the application is created."""

    _domain_routers.append(router)


def build_api_router(domain_routers: Iterable[APIRouter] | None = None) -> APIRouter:
    router = APIRouter()
    router.include_router(auth.router)
    for domain_router in [*_domain_routers, *(domain_routers or [])]:
        router.include_router(domain_router)
    return router


router = build_api_router()

__all__ = ['build_api_router', 'register_domain_router', 'router']
