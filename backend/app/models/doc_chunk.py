"""Document chunk with a portable JSON embedding vector."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DocChunk(Base):
    __tablename__ = 'doc_chunks'
    __table_args__ = (UniqueConstraint('document_id', 'ordinal', name='uq_doc_chunks_document_ordinal'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(ForeignKey('documents.id', ondelete='CASCADE'), nullable=False, index=True)
    # denormalized from the document for the chat-scoped candidate query
    chat_id: Mapped[int] = mapped_column(ForeignKey('chats.id', ondelete='CASCADE'), nullable=False, index=True)
    # denormalized file_id for retrieval traceability without a join
    file_id: Mapped[int] = mapped_column(ForeignKey('files.id', ondelete='CASCADE'), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # portable float vector; pgvector-native storage stays a hardening carry-forward
    embedding: Mapped[list[float]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
