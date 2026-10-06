"""Durable bot run endpoints."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.bot.config import bot_settings_from_env
from app.bot.provider import get_bot_provider
from app.core.config import Settings
from app.core.deps import get_current_user, get_db, get_settings
from app.ingestion.config import rag_settings_from_env
from app.ingestion.embeddings import get_provider
from app.models.user import User
from app.schemas.bot import BotRunCreate, BotRunResponse
from app.services.bot import BotService

router = APIRouter(tags=['bot'])


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
            'import app.main, not app.api.v1.router: the bot domain '
            'registers itself while the endpoints package initializes'
        ) from exc
    register_domain_router(router)


@router.post('/chats/{chat_id}/bot/runs', response_model=BotRunResponse)
async def create_bot_run(
    chat_id: int,
    payload: BotRunCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> BotRunResponse:
    bot = bot_settings_from_env()
    rag = rag_settings_from_env()
    service = BotService(
        db,
        settings,
        bot,
        rag,
        provider=get_bot_provider(request.app.state, bot),
        rag_provider=get_provider(request.app.state, rag),
    )
    run = await asyncio.to_thread(
        service.run,
        chat_id=chat_id,
        user_id=current_user.id,
        message_id=payload.message_id,
    )
    return BotRunResponse.model_validate(run)
