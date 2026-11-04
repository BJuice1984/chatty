"""Durable bot run endpoints."""

from __future__ import annotations

import asyncio
import concurrent.futures
import logging
from collections.abc import Callable

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.bot.config import bot_settings_from_env
from app.bot.provider import get_bot_provider
from app.core.config import Settings
from app.core.deps import get_current_user, get_db, get_settings
from app.ingestion.config import rag_settings_from_env
from app.ingestion.embeddings import get_provider
from app.models.user import User
from app.repositories.bot_runs import BotRunRepository
from app.repositories.messages import MessageRepository
from app.schemas.bot import BotRunCreate, BotRunResponse
from app.services.bot import BotService
from app.services.chats import ChatService
from app.services.messages import MessageService
from app.ws.hub import hub

router = APIRouter(tags=['bot'])

logger = logging.getLogger(__name__)


def _log_bridge_failure(future: concurrent.futures.Future) -> None:
    """Observe the scheduled broadcast so its failure is logged, never raised
    into (nor silently lost by) the worker thread."""
    try:
        exc = future.exception()
    except concurrent.futures.CancelledError:
        return
    if exc is not None:
        logger.warning('bot delta broadcast failed: %s', exc)


def _delta_bridge(chat_id: int, message_id: int, db: Session) -> Callable[[str], None]:
    """Worker-thread → request-loop bridge for streaming bot deltas.

    The service invokes the returned callback synchronously from its worker
    thread; each delta is scheduled onto the request's event loop with
    ``run_coroutine_threadsafe`` — never blocking the thread, never raising
    into it (bridge failures are observed and logged only). Дельты — чистый
    прогресс-UI: финальный broadcast сообщения ниже не меняется, фильтр
    членства наследуется от ``hub.broadcast``.
    """
    loop = asyncio.get_running_loop()
    active_user_ids = ChatService(db).active_member_ids(chat_id)

    def on_delta(text: str) -> None:
        future = asyncio.run_coroutine_threadsafe(
            hub.broadcast(
                chat_id,
                {'type': 'bot_delta', 'content': {'message_id': message_id, 'delta': text}},
                active_user_ids=active_user_ids,
            ),
            loop,
        )
        future.add_done_callback(_log_bridge_failure)

    return on_delta


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
    # The bot answer is written straight to the database by the service;
    # without this broadcast the messenger feed only saw it on a refetch.
    # A run that had already succeeded before this call is an idempotent
    # redelivery — re-broadcasting it would duplicate the answer in every
    # connected feed.
    existing = BotRunRepository(db).get_by_message_id(payload.message_id)
    already_succeeded = existing is not None and existing.status == 'succeeded'
    on_delta = (
        _delta_bridge(chat_id, payload.message_id, db)
        if bot.streaming and not already_succeeded
        else None
    )
    run = await asyncio.to_thread(
        service.run,
        chat_id=chat_id,
        user_id=current_user.id,
        message_id=payload.message_id,
        on_delta=on_delta,
    )
    if not already_succeeded and run.status == 'succeeded' and run.response_message_id is not None:
        message = MessageRepository(db).get_by_id(run.response_message_id)
        if message is not None:
            response = MessageService(db).present_one(message, current_user.id).model_dump(mode='json')
            await hub.broadcast(
                chat_id,
                {'type': 'message', 'content': response},
                active_user_ids=ChatService(db).active_member_ids(chat_id),
            )
    return BotRunResponse.model_validate(run)
