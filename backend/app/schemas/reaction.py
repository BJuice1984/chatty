"""Reaction contracts: фиксированный набор эмодзи и сводки по сообщениям."""

from __future__ import annotations

from pydantic import BaseModel, Field

# серверный whitelist реакций; всё вне набора отклоняется с emoji_not_allowed
REACTION_EMOJIS: frozenset[str] = frozenset({'👍', '❤️', '😂', '😮', '😢', '🙏'})


class ReactionSet(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


class ReactionSummary(BaseModel):
    emoji: str
    count: int
    mine: bool


class ReactionSummaryResponse(BaseModel):
    message_id: int
    active: bool
    reactions: list[ReactionSummary]
