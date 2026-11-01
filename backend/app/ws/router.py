"""Cookie-authenticated chat WebSocket endpoint."""

from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.core.security import decode_token
from app.models.user import User
from app.repositories.chats import ChatRepository
from app.repositories.users import UserRepository
from app.schemas.message import (
    MessageCreate,
    WebSocketEvent,
    WebSocketHistoryContent,
    WebSocketMessageContent,
)
from app.services.chats import ChatService
from app.services.messages import MessageService
from app.ws.hub import hub, stories_hub


router = APIRouter(tags=['websocket'])


async def _reject(websocket: WebSocket) -> None:
    await websocket.close(code=1008)


def _error_payload(code: str, message: str) -> dict[str, object]:
    return {'type': 'error', 'content': {'code': code, 'message': message}}


def _user_from_websocket(websocket: WebSocket) -> User | None:
    settings = websocket.app.state.settings
    token = websocket.cookies.get(settings.access_cookie_name)
    if not token:
        return None
    try:
        payload = decode_token(token, settings, 'access')
        user_id = int(payload['sub'])
    except Exception:
        return None
    with websocket.app.state.session_factory() as session:
        user = UserRepository(session).get_by_id(user_id)
        if user is None or not user.is_active:
            return None
        return User(
            id=user.id,
            email=user.email,
            password_hash=user.password_hash,
            role=user.role,
            is_active=user.is_active,
            token_version=user.token_version,
            created_at=user.created_at,
        )


@router.websocket('/ws/chats/{chat_id}')
async def chat_websocket(websocket: WebSocket, chat_id: int) -> None:
    settings = websocket.app.state.settings
    origin = websocket.headers.get('origin')
    if origin and origin not in settings.allowed_origins:
        await _reject(websocket)
        return
    user = _user_from_websocket(websocket)
    if user is None:
        await _reject(websocket)
        return
    with websocket.app.state.session_factory() as session:
        if not ChatRepository(session).is_member(chat_id, user.id):
            await _reject(websocket)
            return

    await websocket.accept()
    await hub.connect(chat_id, websocket, user.id)
    try:
        while True:
            try:
                event = WebSocketEvent.model_validate(await websocket.receive_json())
                if event.type == 'message':
                    content = event.content if isinstance(event.content, dict) else {'content': event.content}
                    payload = MessageCreate.model_validate(WebSocketMessageContent.model_validate(content).model_dump())
                    with websocket.app.state.session_factory() as session:
                        chats_service = ChatService(session)
                        # write guard: archived membership is read-only — the
                        # explicit error reaches the sender, nothing broadcasts
                        chats_service.require_active_member(chat_id, user.id)
                        service = MessageService(session)
                        message = service.create(chat_id, user.id, payload)
                        response = service.present_one(message, user.id).model_dump(mode='json')
                        active_user_ids = chats_service.active_member_ids(chat_id)
                    await hub.broadcast(
                        chat_id,
                        {'type': 'message', 'content': response},
                        active_user_ids=active_user_ids,
                    )
                elif event.type == 'history':
                    content = event.content if isinstance(event.content, dict) else {}
                    history = WebSocketHistoryContent.model_validate(content)
                    with websocket.app.state.session_factory() as session:
                        service = MessageService(session)
                        messages, next_before_id = service.history(
                            chat_id,
                            user.id,
                            before_id=history.before_id,
                            limit=history.limit,
                        )
                        presented = service.present(messages, user.id)
                    await websocket.send_json(
                        {
                            'type': 'history',
                            'content': {
                                'messages': [item.model_dump(mode='json') for item in presented],
                                'before_id': history.before_id,
                                'limit': history.limit,
                                'next_before_id': next_before_id,
                            },
                        }
                    )
                elif event.type == 'ping':
                    await websocket.send_json({'type': 'pong', 'content': {}})
                else:
                    await websocket.send_json(_error_payload('unsupported_event', 'unsupported_event_type'))
            except WebSocketDisconnect:
                raise
            except ValidationError:
                await websocket.send_json(_error_payload('invalid_event', 'invalid_event_payload'))
            except Exception as exc:
                detail = getattr(exc, 'detail', None)
                code = detail if isinstance(detail, str) else 'message_failed'
                await websocket.send_json(_error_payload(code, code))
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(chat_id, websocket)


@router.websocket('/ws/stories')
async def stories_socket(websocket: WebSocket) -> None:
    """Global stories channel: cookie auth + Origin, no chat membership.

    Лента историй общая для всех пользователей, поэтому канал не привязан
    к чату; клиентский keepalive (WSTransport шлёт ping каждые 5 c)
    отвечает точным pong-кадром чат-сокета, прочие события игнорируются.
    """

    settings = websocket.app.state.settings
    origin = websocket.headers.get('origin')
    if origin and origin not in settings.allowed_origins:
        await _reject(websocket)
        return
    user = _user_from_websocket(websocket)
    if user is None:
        await _reject(websocket)
        return

    await websocket.accept()
    await stories_hub.connect(user.id, websocket)
    try:
        while True:
            try:
                event = await websocket.receive_json()
                if isinstance(event, dict) and event.get('type') == 'ping':
                    await websocket.send_json({'type': 'pong', 'content': {}})
            except WebSocketDisconnect:
                raise
    except WebSocketDisconnect:
        pass
    finally:
        await stories_hub.disconnect(user.id, websocket)
