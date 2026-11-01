"""HTTP chat and membership contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, PositiveInt


class ChatCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    is_ai: bool = False


class ChatMemberCreate(BaseModel):
    user_id: PositiveInt


class ChatDmCreate(BaseModel):
    user_id: PositiveInt


class ChatMemberBrief(BaseModel):
    """Member summary in the chat list — the GET /chats/{id}/members shape."""

    id: int
    login: str
    display_name: str
    avatar_url: str | None = None


class ChatLastMessageBrief(BaseModel):
    """Последнее сообщение чата — краткая форма для сортировки списка по
    активности; content is None значит файловое вложение без текста."""

    content: str | None
    time: datetime


class ChatResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    owner_id: int
    is_ai: bool
    # DM marker (additive, default False): the GET /chats field-by-field
    # construction passes it explicitly, the model_validate paths fill it
    # from the ORM attribute automatically
    is_dm: bool = False
    created_at: datetime
    # непрочитанные для запрашивающего: чужие сообщения новее последнего
    # прочитанного (0, если всё прочитано)
    unread_count: int = 0
    # аватар чата (свой или None); заполняется из Chat.avatar_url
    avatar_url: str | None = None
    # краткие составы участников; гарантированно наполняет только
    # GET /chats (единый IN-запрос) — POST /chats и GET /chats/{id} идут
    # через model_validate по ORM-объекту без members и оставляют пустой
    # дефолт, без которого оба эндпоинта падали бы с ValidationError
    members: list[ChatMemberBrief] = Field(default_factory=list)
    # последнее сообщение чата; наполняет только GET /chats (единый
    # SELECT по всему списку) — POST /chats и GET /chats/{id} идут через
    # model_validate по ORM-объекту без last_message и оставляют None
    # дефолт, без которого оба эндпоинта падали бы с ValidationError
    # (прецедент members default_factory)
    last_message: ChatLastMessageBrief | None = None
    # caller-relative архивный статус участия: None = активный, метка =
    # само-leave. Наполняет только GET /chats (поле за полем из строки
    # chat_members) — POST /chats и GET /chats/{id} идут через
    # model_validate по ORM-объекту Chat без контекста участия и оставляют
    # None по дизайну (список — источник правды для UI)
    left_at: datetime | None = None


class ChatMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    chat_id: int
    user_id: int
    joined_at: datetime


class ChatSearchSnippet(BaseModel):
    """Окно вокруг первого case-insensitive совпадения в свежайшем
    совпадающем сообщении; части — сырые подстроки оригинала,
    сервер не экранирует (единственный XSS-шов — клиент)."""

    before: str
    match: str
    after: str


class ChatSearchResult(BaseModel):
    """Один чат из GET /chats/search: где совпало и чем подсветить."""

    chat_id: int
    matched_in: Literal['title', 'message', 'both']
    # title-only совпадениям подсвечивать нечего: сниппета и времени нет
    snippet: ChatSearchSnippet | None = None
    last_match_at: datetime | None = None


class ChatsSearchResponse(BaseModel):
    query: str
    results: list[ChatSearchResult] = Field(default_factory=list)
