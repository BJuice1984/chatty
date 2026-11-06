"""Background scheduler for the one-shot LLM chat auto-naming.

Both frontend send paths — the chat WS message event (``app.ws.router``)
and HTTP POST /chats/{id}/messages (the AI-assistant askBot seam) — run
``schedule_autotitle`` right after their own work is done. The entry is a
coroutine: the WS path spawns it with ``asyncio.create_task`` (the socket's
event loop outlives the message), the HTTP path registers it as a FastAPI
background task (it runs after the response is sent, while the request's
ASGI loop is still alive — a bare create_task there could die with the
request portal before ever starting).

The scheduler owns the per-process in-flight guard, runs the hub-free
``ChatAutoTitleService`` in a worker thread on a fresh session and fans out
the EXISTING 'chat_renamed' event to ACTIVE members on success. It lives
in the WS layer on purpose: ``app/services`` must never import
``app.ws.hub`` (the review F-5 grep pin), while endpoints importing ws
modules is the established precedent.

The guard never swallows a trigger: a message arriving while the check for
its chat is already running marks the chat for a re-check instead of being
dropped — otherwise two quick messages in a row could leave the threshold
run against stale data and the chat unnamed until the NEXT message
(a live repro in the integration suite).
"""

from __future__ import annotations

import asyncio
import logging

from app.ws.hub import hub

logger = logging.getLogger(__name__)

# Per-process in-flight guard: fast consecutive messages in one chat must
# not spawn parallel model calls (the CAS would still keep the rename
# one-shot, but the duplicate provider calls are pure waste). Cleared by
# tests between cases — the schema is recreated and chat ids repeat.
_AUTOTITLE_INFLIGHT: set[int] = set()
# Chats whose trigger arrived while a check was already running: the check
# re-runs once more against the fresh data (bounded — each re-run needs a
# NEW trigger to be scheduled again).
_AUTOTITLE_RECHECK: set[int] = set()


async def schedule_autotitle(app_state: object, chat_id: int) -> None:
    """Fire-and-forget check: never raises into the caller, never blocks it.

    Спавнится задачей (WS) или background-task'ом (HTTP): корутина сама
    держит гвард — синхронный участок до первого await атомарен в лупе,
    поэтому два подряд запуска не проходят гвард одновременно.

    ``app.state.autotitle_inline`` (тестовый шов, прод-дефолт False):
    тестовый движок — StaticPool c ОДНИМ connection на все потоки, и
    параллельный доступ из to_thread-потока и лупа роняет pysqlite
    (interleaved cursors). Inline-режим выполняет те же шаги синхронно в
    лупе — доступ сериализуется, семантика (гвард, CAS, broadcast) та же.
    """
    if chat_id in _AUTOTITLE_INFLIGHT:
        _AUTOTITLE_RECHECK.add(chat_id)
        return
    _AUTOTITLE_INFLIGHT.add(chat_id)
    try:
        if getattr(app_state, 'autotitle_inline', False):
            title = _rename_sync(app_state, chat_id)
            active_user_ids = _active_members(app_state, chat_id) if title is not None else set()
        else:
            title = await asyncio.to_thread(_rename_sync, app_state, chat_id)
            active_user_ids = (
                await asyncio.to_thread(_active_members, app_state, chat_id)
                if title is not None
                else set()
            )
        if title is not None:
            await hub.broadcast(
                chat_id,
                {'type': 'chat_renamed', 'content': {'chat_id': chat_id, 'title': title}},
                active_user_ids=active_user_ids,
            )
    except Exception:
        # фоновая задача: любое исключение — лог и тишина, сообщение-триггер
        # давно доставлено, ретрай случится на следующем юзерском сообщении
        logger.warning('chat autotitle task failed', exc_info=True)
    finally:
        _AUTOTITLE_INFLIGHT.discard(chat_id)
        if chat_id in _AUTOTITLE_RECHECK:
            _AUTOTITLE_RECHECK.discard(chat_id)
            asyncio.create_task(schedule_autotitle(app_state, chat_id))


def _rename_sync(app_state: object, chat_id: int) -> str | None:
    from app.bot.config import autotitle_settings_from_env, bot_settings_from_env
    from app.bot.provider import get_bot_provider
    from app.services.chat_autotitle import ChatAutoTitleService

    session_factory = getattr(app_state, 'session_factory')
    bot = bot_settings_from_env()
    with session_factory() as session:
        service = ChatAutoTitleService(
            session,
            bot,
            autotitle_settings_from_env(),
            provider=get_bot_provider(app_state, bot),
        )
        return service.maybe_rename(chat_id)


def _active_members(app_state: object, chat_id: int) -> set[int]:
    from app.services.chats import ChatService

    session_factory = getattr(app_state, 'session_factory')
    with session_factory() as session:
        return ChatService(session).active_member_ids(chat_id)
