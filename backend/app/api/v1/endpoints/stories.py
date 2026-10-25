"""Authenticated story feed endpoints: upload, feed, idempotent views."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, File as UploadFileMarker, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, get_settings
from app.core.config import Settings
from app.models.user import User
from app.schemas.story import StoryResponse
from app.services.files import FileService, get_object_storage
from app.services.stories import StoryService
from app.ws.hub import stories_hub

router = APIRouter(prefix='/stories', tags=['stories'])


@router.post('', response_model=StoryResponse, status_code=status.HTTP_201_CREATED)
async def create_story(
    request: Request,
    uploaded: UploadFile = UploadFileMarker(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> StoryResponse:
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
    story_service = StoryService(db, settings)
    story = story_service.create(owner_id=current_user.id, file=prepared.file)
    feed = story_service.list_feed(current_user.id)
    # фан-аут после коммита (прецедент chat_deleted/reaction): фиксированная
    # форма без пересчёта per-viewer — у всех не-владельцев новая история
    # непросмотренная и чужая; аплоадер исключён: его клиент сходится рефетчем
    await stories_hub.broadcast(
        {
            'type': 'story_created',
            'content': story_service.to_broadcast_response(story, current_user).model_dump(mode='json'),
        },
        exclude_user_id=current_user.id,
    )
    return next(item for item in feed if item.id == story.id)


@router.get('', response_model=list[StoryResponse])
async def list_stories(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> list[StoryResponse]:
    return StoryService(db, settings).list_feed(current_user.id)


@router.post('/{story_id}/view', status_code=status.HTTP_204_NO_CONTENT)
async def view_story(
    story_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    StoryService(db, settings).mark_viewed(story_id, current_user.id)

@router.delete('/{story_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_story(
    story_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    storage = get_object_storage(settings, request.app.state)
    StoryService(db, settings).delete(story_id, current_user.id, storage)
    # удаление — всем без исключения: убрать кольцо идемпотентно на клиенте,
    # а другие вкладки владельца тоже выигрывают
    await stories_hub.broadcast(
        {'type': 'story_deleted', 'content': {'story_id': story_id}}
    )
