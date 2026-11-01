"""Authenticated chat, membership and message HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.chat import (
    ChatCreate,
    ChatDmCreate,
    ChatMemberBrief,
    ChatMemberCreate,
    ChatMemberResponse,
    ChatResponse,
    ChatsSearchResponse,
)
from app.schemas.message import MessageCreate, MessagePage, MessageResponse
from app.schemas.reaction import ReactionSet, ReactionSummaryResponse
from app.services.chats import ChatService
from app.services.messages import MessageService
from app.ws.hub import hub


router = APIRouter(prefix='/chats', tags=['chats'])


@router.post('', response_model=ChatResponse, status_code=status.HTTP_201_CREATED)
async def create_chat(
    payload: ChatCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    chat = ChatService(db).create(current_user.id, payload)
    return ChatResponse.model_validate(chat)


@router.get('', response_model=list[ChatResponse])
async def list_chats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatResponse]:
    service = ChatService(db)
    chats = service.list_for_user(current_user.id)
    unread = service.unread_counts(current_user.id)
    # составы участников одним пакетным IN-запросом — ни одного
    # per-chat members-запроса из списка чатов
    members = service.members_for_chats([chat.id for chat, _left_at in chats])
    # последние сообщения одним пакетным SELECT (новейшее по created_at,
    # тай-брейк id); content is None — файловое вложение без текста
    last_messages = service.last_messages_for_chats([chat.id for chat, _left_at in chats])
    return [
        ChatResponse(
            id=chat.id,
            title=chat.title,
            owner_id=chat.owner_id,
            is_ai=chat.is_ai,
            is_dm=chat.is_dm,
            created_at=chat.created_at,
            unread_count=unread.get(chat.id, 0),
            avatar_url=chat.avatar_url,
            members=members.get(chat.id, []),
            last_message=last_messages.get(chat.id),
            # caller-relative архивный статус участия (прецедент is_dm:
            # поле за полем), None = активный
            left_at=left_at,
        )
        for chat, left_at in chats
    ]


@router.get('/search', response_model=ChatsSearchResponse)
async def search_chats(
    q: str = Query(min_length=1, max_length=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatsSearchResponse:
    """Живой поиск по чатам: case-insensitive подстрока в title и
    непустых content сообщений чатов пользователя; маршрут обязан стоять
    ДО /{chat_id} — FastAPI матчит по порядку регистрации, иначе
    литерал 'search' уйдёт в int-параметр и получит 422."""
    results = ChatService(db).search_chats(current_user.id, q)
    return ChatsSearchResponse(query=q, results=results)


@router.post('/dm', response_model=ChatResponse)
async def create_dm(
    payload: ChatDmCreate,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    """Get-or-create the 1:1 chat with the user: 201 when the DM is created,
    200 with the SAME chat when it already exists. The route must sit
    BEFORE the /{chat_id} ones — FastAPI matches by registration order, so
    the literal 'dm' would otherwise fall into an int path parameter
    (the /search precedent)."""
    chat, created = ChatService(db).create_dm(current_user.id, payload.user_id)
    if created:
        response.status_code = status.HTTP_201_CREATED
    return ChatResponse.model_validate(chat)


@router.get('/{chat_id}', response_model=ChatResponse)
async def get_chat(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    chat = ChatService(db).require_member(chat_id, current_user.id)
    return ChatResponse.model_validate(chat)


@router.delete('/{chat_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    service = ChatService(db)
    chat = service.require_owned(chat_id, current_user.id)
    # порядок критичен: сначала событие по живым сокетам (строка ещё существует),
    # затем удаление строки (каскады БД снимают messages/members/files/documents/
    # chunks/bot_runs/reactions), затем закрытие сокетов чата; fan-out — только
    # АКТИВНЫМ участникам (архивным чат уже «молчит»)
    await hub.broadcast(
        chat_id,
        {'type': 'chat_deleted', 'content': {'chat_id': chat_id}},
        active_user_ids=service.active_member_ids(chat_id),
    )
    service.delete(chat)
    await hub.close_chat(chat_id)


@router.post('/{chat_id}/members', response_model=ChatMemberResponse, status_code=status.HTTP_201_CREATED)
async def add_chat_member(
    chat_id: int,
    payload: ChatMemberCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatMemberResponse:
    member = ChatService(db).add_member(chat_id, current_user.id, payload.user_id)
    return ChatMemberResponse.model_validate(member)


@router.delete('/{chat_id}/members/{user_id}', status_code=status.HTTP_204_NO_CONTENT)
async def remove_chat_member(
    chat_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Owner-only kick: hard-deletes the membership row — the kicked user
    loses the chat entirely (GET /chats and WS connect refuse them), a
    later re-add starts a fresh row. The literal 'members'/'{user_id}'
    segments cannot collide with the int routes: single-segment /{chat_id}
    patterns never match this three-segment path (the /search, /dm
    precedents run the other way — literals must come first)."""
    ChatService(db).kick_member(chat_id, current_user.id, user_id)
    # только сокеты исключённого пользователя (close_chat убил бы чат у всех)
    await hub.close_user_chat(chat_id, user_id)


@router.post('/{chat_id}/leave', status_code=status.HTTP_204_NO_CONTENT)
async def leave_chat(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Self-leave archives the caller's membership (left_at = now,
    idempotent): the chat stays in their list with history readable, live
    pushes and writes stop. The literal 'leave' segment sits beside
    /{chat_id}/members and /{chat_id}/messages — a different literal, so
    the int routes cannot shadow it (no single-segment POST /{chat_id}
    exists)."""
    ChatService(db).leave(chat_id, current_user.id)
    await hub.close_user_chat(chat_id, current_user.id)


@router.post('/{chat_id}/rejoin', status_code=status.HTTP_204_NO_CONTENT)
async def rejoin_chat(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """The leave twin: reactivates the caller's OWN archived membership
    (left_at -> NULL on the same row — writes and live pushes resume).
    Kicked users have no row (403), an active membership is an idempotent
    204, an unknown chat is the usual 404. The literal 'rejoin' segment
    sits beside /{chat_id}/leave and /{chat_id}/members — a different
    literal, so the int routes cannot shadow it (no single-segment POST
    /{chat_id} exists; the /search, /dm precedents run the other way)."""
    ChatService(db).rejoin(chat_id, current_user.id)


@router.get('/{chat_id}/messages', response_model=MessagePage)
async def list_messages(
    chat_id: int,
    before_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessagePage:
    service = MessageService(db)
    messages, next_before_id = service.history(
        chat_id,
        current_user.id,
        before_id=before_id,
        limit=limit,
    )
    return MessagePage(
        messages=service.present(messages, current_user.id),
        before_id=before_id,
        limit=limit,
        next_before_id=next_before_id,
    )


@router.post('/{chat_id}/messages', response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def create_message(
    chat_id: int,
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageResponse:
    # write guard (сервисный _require_member — READ-сторона: строка участия)
    ChatService(db).require_active_member(chat_id, current_user.id)
    service = MessageService(db)
    message = service.create(chat_id, current_user.id, payload)
    return service.present_one(message, current_user.id)


@router.post('/{chat_id}/messages/{message_id}/reactions', response_model=ReactionSummaryResponse)
async def set_reaction(
    chat_id: int,
    message_id: int,
    payload: ReactionSet,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReactionSummaryResponse:
    # write guard: архивное участие не реагирует (прецедент create_message)
    chats_service = ChatService(db)
    chats_service.require_active_member(chat_id, current_user.id)
    active, reactions = MessageService(db).set_reaction(
        chat_id,
        message_id,
        current_user.id,
        payload.emoji,
    )
    await hub.broadcast(
        chat_id,
        {
            'type': 'reaction',
            'content': {
                'chat_id': chat_id,
                'message_id': message_id,
                'user_id': current_user.id,
                'emoji': payload.emoji,
                'active': active,
            },
        },
        active_user_ids=chats_service.active_member_ids(chat_id),
    )
    return ReactionSummaryResponse(message_id=message_id, active=active, reactions=reactions)

@router.get('/{chat_id}/members')
async def list_chat_members(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatMemberBrief]:
    """Участники чата: полный состав без cap (панель участников); форма —
    общий to_member_brief (совпадает с members в GET /chats)."""
    service = ChatService(db)
    service.require_member(chat_id, current_user.id)
    return service.list_member_briefs(chat_id)
