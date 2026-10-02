"""Authenticated chat, membership and message HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.chat import ChatCreate, ChatMemberCreate, ChatMemberResponse, ChatResponse
from app.schemas.message import MessageCreate, MessagePage, MessageResponse
from app.services.chats import ChatService
from app.services.messages import MessageService


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
    chats = ChatService(db).list_for_user(current_user.id)
    return [ChatResponse.model_validate(chat) for chat in chats]


@router.get('/{chat_id}', response_model=ChatResponse)
async def get_chat(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    chat = ChatService(db).require_member(chat_id, current_user.id)
    return ChatResponse.model_validate(chat)


@router.post('/{chat_id}/members', response_model=ChatMemberResponse, status_code=status.HTTP_201_CREATED)
async def add_chat_member(
    chat_id: int,
    payload: ChatMemberCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatMemberResponse:
    member = ChatService(db).add_member(chat_id, current_user.id, payload.user_id)
    return ChatMemberResponse.model_validate(member)


@router.get('/{chat_id}/messages', response_model=MessagePage)
async def list_messages(
    chat_id: int,
    before_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessagePage:
    messages, next_before_id = MessageService(db).history(
        chat_id,
        current_user.id,
        before_id=before_id,
        limit=limit,
    )
    return MessagePage(
        messages=[MessageResponse.model_validate(message) for message in messages],
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
    message = MessageService(db).create(chat_id, current_user.id, payload)
    return MessageResponse.model_validate(message)
