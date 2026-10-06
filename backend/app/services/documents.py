"""Document ingestion pipeline and chat-scoped top-k retrieval.

Ingestion is admin-only and every external failure (parser, converter,
embedding endpoint, object storage) lands in an explicit `failed` state with
a machine-readable `error_kind`. Retrieval is membership-scoped and considers
only chunks of `ready` documents; failed or partial documents are never
searchable.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.ingestion.chunking import chunk_text
from app.ingestion.converter import ConversionError, DocConverter
from app.ingestion.embeddings import EmbeddingError, EmbeddingProvider, cosine_similarity, default_provider
from app.ingestion.parsers import ParseError, extract_text
from app.ingestion.config import RagSettings
from app.models.doc_chunk import DocChunk
from app.models.document import Document
from app.models.file import File
from app.repositories.documents import DocumentRepository
from app.repositories.files import FileRepository
from app.services.chats import ChatService
from app.services.files import DownloadedObject, ObjectStorage


class DocumentService:
    def __init__(
        self,
        session: Session,
        settings: Settings,
        rag: RagSettings,
        *,
        storage: ObjectStorage | None = None,
        provider: EmbeddingProvider | None = None,
        converter: DocConverter | None = None,
    ):
        self.session = session
        self.settings = settings
        self.rag = rag
        self.storage = storage
        self.provider = provider if provider is not None else default_provider(rag)
        self.converter = converter if converter is not None else DocConverter(timeout_seconds=rag.converter_timeout_seconds)
        self.documents = DocumentRepository(session)
        self.files = FileRepository(session)
        self.chats = ChatService(session)

    def ingest(self, *, file_id: int, admin_id: int) -> Document:
        file = self.files.get_by_id(file_id)
        if file is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='file_not_found')
        if file.status != 'ready':
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='file_not_ready')
        if self.storage is None:
            raise RuntimeError('document ingestion requires object storage')

        document = self._processing_document(file, admin_id)
        try:
            body = self._read_storage(file)
        except Exception as exc:
            return self._fail(document, 'storage_unavailable', exc)
        try:
            text = extract_text(file.original_name, body, self.converter.to_docx)
        except ParseError as exc:
            return self._fail(document, exc.kind, exc)
        except ConversionError as exc:
            return self._fail(document, exc.kind, exc)
        if not text.strip():
            return self._fail(document, 'no_text')
        chunks = chunk_text(text)
        try:
            vectors = self.provider.embed([chunk.content for chunk in chunks])
        except EmbeddingError as exc:
            return self._fail(document, 'embedding_provider_failed', exc)
        if len(vectors) != len(chunks):
            return self._fail(document, 'embedding_provider_failed')
        rows = [
            DocChunk(
                document_id=document.id,
                chat_id=file.chat_id,
                file_id=file.id,
                ordinal=chunk.ordinal,
                content=chunk.content,
                embedding=vector,
            )
            for chunk, vector in zip(chunks, vectors)
        ]
        self.documents.replace_chunks(document, rows)
        document.status = 'ready'
        document.error_kind = None
        self.session.commit()
        self.session.refresh(document)
        return document

    def search(self, *, chat_id: int, user_id: int, query: str, top_k: int) -> list[tuple[DocChunk, float]]:
        self.chats.require_member(chat_id, user_id)
        capped = min(top_k, self.rag.top_k_max)
        candidates = self.documents.ready_chunks_for_chat(chat_id)
        if not candidates:
            return []
        try:
            query_vectors = self.provider.embed([query])
        except EmbeddingError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail='embedding_provider_unavailable',
            ) from exc
        if not query_vectors:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail='embedding_provider_unavailable',
            )
        query_vector = query_vectors[0]
        scored = [(chunk, cosine_similarity(query_vector, chunk.embedding)) for chunk in candidates]
        # deterministic order: score desc, then document/ordinal asc
        scored.sort(key=lambda item: (-item[1], item[0].document_id, item[0].ordinal))
        return scored[:capped]

    def _processing_document(self, file: File, admin_id: int) -> Document:
        """Reset the document to `processing` before any external call.

        A hard process crash between this commit and a terminal state leaves
        the row in `processing`: retrieval only considers `ready` documents
        and re-ingestion resets the row, so the intermediate state stays
        observable and recoverable (RV3, recorded by the attempt-1 review).
        """
        document = self.documents.get_by_file_id(file.id)
        if document is None:
            document = self.documents.add(
                Document(file_id=file.id, chat_id=file.chat_id, owner_id=admin_id, status='processing')
            )
        else:
            document.status = 'processing'
            document.error_kind = None
            self.session.flush()
        self.session.commit()
        return document

    def _fail(self, document: Document, kind: str, cause: Exception | None = None) -> Document:
        document.status = 'failed'
        document.error_kind = kind
        self.session.commit()
        self.session.refresh(document)
        return document

    def _read_storage(self, file: File) -> bytes:
        downloaded: DownloadedObject = self.storage.download(file.object_key)
        body = downloaded.body
        reader = getattr(body, 'read', None)
        if callable(reader):
            data = reader()
        else:
            data = b''.join(body)
        if not isinstance(data, bytes):
            data = bytes(data)
        return data
