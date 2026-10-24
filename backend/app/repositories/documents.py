"""Document and chunk persistence queries."""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.doc_chunk import DocChunk
from app.models.document import Document


class DocumentRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_by_id(self, document_id: int) -> Document | None:
        return self.session.get(Document, document_id)

    def get_by_file_id(self, file_id: int) -> Document | None:
        statement = select(Document).where(Document.file_id == file_id)
        return self.session.scalars(statement).first()

    def add(self, document: Document) -> Document:
        self.session.add(document)
        self.session.flush()
        return document

    def replace_chunks(self, document: Document, chunks: list[DocChunk]) -> None:
        self.session.execute(delete(DocChunk).where(DocChunk.document_id == document.id))
        for chunk in chunks:
            self.session.add(chunk)
        document.chunk_count = len(chunks)
        self.session.flush()

    def ready_chunks_for_chat(self, chat_id: int) -> list[DocChunk]:
        """Only chunks of ready documents are retrieval candidates."""
        statement = (
            select(DocChunk)
            .join(Document, DocChunk.document_id == Document.id)
            .where(DocChunk.chat_id == chat_id, Document.status == 'ready')
            .order_by(DocChunk.document_id.asc(), DocChunk.ordinal.asc())
        )
        return list(self.session.scalars(statement))
