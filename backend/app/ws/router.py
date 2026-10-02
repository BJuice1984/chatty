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
    MessageResponse,
    WebSocketEvent,
    WebSocketHistoryContent,
    WebSocketMessageContent,
)
from app.services.messages import MessageService
from app.ws.hub import hub


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
    await hub.connect(chat_id, websocket)
    try:
        while True:
            try:
                event = WebSocketEvent.model_validate(await websocket.receive_json())
                if event.type == 'message':
                    content = event.content if isinstance(event.content, dict) else {'content': event.content}
                    payload = MessageCreate.model_validate(WebSocketMessageContent.model_validate(content).model_dump())
                    with websocket.app.state.session_factory() as session:
                        message = MessageService(session).create(chat_id, user.id, payload)
                    response = MessageResponse.model_validate(message).model_dump(mode='json')
                    await hub.broadcast(chat_id, {'type': 'message', 'content': response})
                elif event.type == 'history':
                    content = event.content if isinstance(event.content, dict) else {}
                    history = WebSocketHistoryContent.model_validate(content)
                    with websocket.app.state.session_factory() as session:
                        messages, next_before_id = MessageService(session).history(
                            chat_id,
                            user.id,
                            before_id=history.before_id,
                            limit=history.limit,
                        )
                    await websocket.send_json(
                        {
                            'type': 'history',
                            'content': {
                                'messages': [MessageResponse.model_validate(item).model_dump(mode='json') for item in messages],
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
