"""Служебная строка ленты вживую (2026-11-07).

Единая точка фан-аута kind-сообщений (rename/ai-toggle/member events/
chat_avatar_updated) событием 'message' АКТИВНЫМ участникам чата. Живёт в
ws-слое рядом с hub: эндпоинты зовут её свободно, сервисы по-прежнему не
импортируют hub (репозиторийное правило) — всю отправку делают эндпоинты.
Исторические клиенты читают те же строки из GET /messages (kind
рендерится служебной строкой).
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.services.messages import MessageService
from app.ws.hub import hub


async def broadcast_feed_message(
    db: Session,
    chat_id: int,
    message,
    viewer_id: int,
    active_user_ids: set[int],
) -> None:
    presented = MessageService(db).present_one(message, viewer_id)
    await hub.broadcast(
        chat_id,
        {'type': 'message', 'content': presented.model_dump(mode='json')},
        active_user_ids=active_user_ids,
    )
