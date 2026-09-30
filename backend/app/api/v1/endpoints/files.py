"""Authenticated private file upload and streaming download endpoints."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterable
from typing import BinaryIO
from urllib.parse import quote

from fastapi import APIRouter, Depends, File as UploadFileMarker, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, get_settings
from app.core.config import Settings
from app.models.user import User
from app.schemas.file import FileResponse
from app.services.files import FileService, get_object_storage


router = APIRouter(prefix='/files', tags=['files'])


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
