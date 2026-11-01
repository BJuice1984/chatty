"""Authenticated private file upload and streaming download endpoints."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterable
from typing import BinaryIO
from urllib.parse import quote

from fastapi import APIRouter, Depends, File as UploadFileMarker, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, get_settings
from app.core.config import Settings
from app.models.user import User
from app.repositories.files import FileRepository
from app.schemas.file import AvatarUploadResponse, FileResponse
from app.services.chats import ChatService
from app.services.files import FileService, get_object_storage


router = APIRouter(prefix='/files', tags=['files'])


class FileUsageResponse(BaseModel):
    """GET /files/usage shape: the caller's stored-file footprint in one
    aggregate query. Lives here (not in schemas/file.py) to keep the
    settings-wave ownership surface minimal — a one-endpoint contract."""

    total_bytes: int
    file_count: int


@router.post('', response_model=FileResponse, status_code=201)
async def upload_file(
    request: Request,
    chat_id: int = Form(...),
    uploaded: UploadFile = UploadFileMarker(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    body = await uploaded.read(settings.max_upload_bytes + 1)
    storage = get_object_storage(settings, request.app.state)
    service = FileService(db, storage, settings)
    prepared = service.prepare_upload(
        chat_id=chat_id,
        owner_id=current_user.id,
        original_name=uploaded.filename or '',
        content_type=uploaded.content_type,
        body=body,
    )
    try:
        await asyncio.to_thread(storage.upload, prepared.file.object_key, body, prepared.content_type)
    except Exception as exc:
        service.mark_upload_failed(prepared.file)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail='file_storage_upload_failed') from exc
    service.mark_upload_ready(prepared.file)
    return service.response(prepared.file)


@router.post('/avatars', response_model=AvatarUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_avatar(
    request: Request,
    kind: str = Form('user'),
    chat_id: int | None = Form(None),
    uploaded: UploadFile = UploadFileMarker(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AvatarUploadResponse:
    """User/chat avatar upload into global media storage (images only)."""

    if kind not in {'user', 'chat'}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='invalid_avatar_kind')
    if kind == 'chat' and chat_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='chat_id_required')

    # владение чатом проверяем ДО загрузки: 403/404 не должны расходовать
    # объектное хранилище и оставлять осиротевшую File-строку
    chat = ChatService(db).require_owned(chat_id, current_user.id) if kind == 'chat' else None

    body = await uploaded.read(settings.max_upload_bytes + 1)
    storage = get_object_storage(settings, request.app.state)
    files = FileService(db, storage, settings)
    prepared = files.prepare_media_upload(
        owner_id=current_user.id,
        original_name=uploaded.filename or '',
        content_type=uploaded.content_type,
        body=body,
    )
    try:
        await asyncio.to_thread(storage.upload, prepared.file.object_key, body, prepared.content_type)
    except Exception as exc:
        files.mark_upload_failed(prepared.file)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail='file_storage_upload_failed') from exc
    files.mark_upload_ready(prepared.file)

    if kind == 'chat':
        files.set_chat_avatar(chat, prepared.file)
    else:
        files.set_user_avatar(current_user, prepared.file)

    return files.avatar_response(prepared.file)


@router.get('/usage', response_model=FileUsageResponse)
async def files_usage(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileUsageResponse:
    """The caller's storage footprint: every file row they uploaded (chat
    attachments and global media alike) in one SUM/COUNT. The literal
    'usage' segment cannot collide with the int routes — the only GET
    pattern is the two-segment /{file_id}/download, so no path parameter
    ever sees the literal."""
    total_bytes, file_count = FileRepository(db).user_usage(current_user.id)
    return FileUsageResponse(total_bytes=total_bytes, file_count=file_count)


@router.get('/{file_id}/download')
async def download_file(
    file_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    storage = get_object_storage(settings, request.app.state)
    file, downloaded = await asyncio.to_thread(FileService(db, storage, settings).download, file_id=file_id, user_id=current_user.id)
    filename = quote(file.original_name, safe='')
    headers = {
        'Content-Disposition': f"attachment; filename*=UTF-8''{filename}",
        'Content-Length': str(file.size_bytes),
    }
    return StreamingResponse(_stream_download(downloaded.body), media_type=downloaded.content_type, headers=headers)


async def _stream_download(body: BinaryIO | Iterable[bytes]) -> AsyncIterator[bytes]:
    reader = getattr(body, 'read', None)
    try:
        if callable(reader):
            while True:
                chunk = await asyncio.to_thread(reader, 64 * 1024)
                if not chunk:
                    break
                yield chunk
            return

        iterator = iter(body)
        sentinel = object()
        while True:
            chunk = await asyncio.to_thread(next, iterator, sentinel)
            if chunk is sentinel:
                break
            yield chunk
    finally:
        close = getattr(body, 'close', None)
        if callable(close):
            await asyncio.to_thread(close)
