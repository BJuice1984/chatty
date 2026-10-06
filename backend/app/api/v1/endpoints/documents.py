"""Admin document ingestion and membership-scoped retrieval endpoints."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, get_settings, require_roles
from app.core.config import Settings
from app.ingestion.config import rag_settings_from_env
from app.ingestion.embeddings import get_provider
from app.models.user import User
from app.schemas.document import DocumentChunkResponse, DocumentResponse, DocumentSearchRequest
from app.services.documents import DocumentService
from app.services.files import get_object_storage

router = APIRouter(tags=['documents'])


def register_domain() -> None:
    """Mount this router through the stage-5 composition seam.

    Called at the end of ``app.api.v1.endpoints`` package init. The import is
    local because ``router.py`` imports that package while it is still
    initializing; every entry point in the repository reaches the router
    through ``app.main``, which imports ``endpoints.health`` first.
    """
    try:
        from app.api.v1.router import register_domain_router
    except ImportError as exc:
        raise ImportError(
            'import app.main, not app.api.v1.router: the documents domain '
            'registers itself while the endpoints package initializes'
        ) from exc
    register_domain_router(router)


@router.post('/documents/{file_id}/ingest', response_model=DocumentResponse)
async def ingest_document(
    file_id: int,
    request: Request,
    admin: User = Depends(require_roles('admin')),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> DocumentResponse:
    storage = get_object_storage(settings, request.app.state)
    rag = rag_settings_from_env()
    service = DocumentService(db, settings, rag, storage=storage, provider=get_provider(request.app.state, rag))
    document = await asyncio.to_thread(service.ingest, file_id=file_id, admin_id=admin.id)
    return DocumentResponse.model_validate(document)


@router.post('/chats/{chat_id}/documents/search', response_model=list[DocumentChunkResponse])
async def search_documents(
    chat_id: int,
    payload: DocumentSearchRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> list[DocumentChunkResponse]:
    rag = rag_settings_from_env()
    service = DocumentService(db, settings, rag, provider=get_provider(request.app.state, rag))
    results = await asyncio.to_thread(
        service.search,
        chat_id=chat_id,
        user_id=current_user.id,
        query=payload.query,
        top_k=payload.top_k,
    )
    return [
        DocumentChunkResponse(
            document_id=chunk.document_id,
            file_id=chunk.file_id,
            ordinal=chunk.ordinal,
            content=chunk.content,
            score=score,
        )
        for chunk, score in results
    ]
