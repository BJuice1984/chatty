"""Stage-8 composition: the documents domain mounts through the router seam."""

from __future__ import annotations

from app.main import app


def test_documents_routes_are_mounted_on_the_application():
    paths = {route.path for route in app.routes}

    assert '/api/v1/documents/{file_id}/ingest' in paths
    assert '/api/v1/chats/{chat_id}/documents/search' in paths


def test_ingest_route_is_registered_exactly_once():
    ingest_paths = [route.path for route in app.routes if route.path.endswith('/ingest')]

    assert ingest_paths == ['/api/v1/documents/{file_id}/ingest']
