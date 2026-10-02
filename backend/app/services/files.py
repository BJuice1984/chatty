"""Private object storage adapter and file metadata service."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import PurePath
from typing import BinaryIO, Iterable, Protocol
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.file import File
from app.repositories.chats import ChatRepository
from app.repositories.files import FileRepository
from app.schemas.file import FileResponse


class ObjectStorage(Protocol):
    def upload(self, object_key: str, body: bytes, content_type: str) -> None:
        """Upload one private object, ensuring its bucket exists first."""

    def download(self, object_key: str) -> 'DownloadedObject':
        """Return a private object stream."""


@dataclass(frozen=True)
class DownloadedObject:
    body: BinaryIO | Iterable[bytes]
    content_type: str
    content_length: int | None


@dataclass(frozen=True)
class PreparedUpload:
    file: File
    content_type: str


class Boto3ObjectStorage:
    """Synchronous S3-compatible client used behind an async thread boundary."""

    def __init__(self, settings: Settings):
        if not settings.object_storage_access_key or not settings.object_storage_secret_key:
            raise RuntimeError('object storage credentials are required')
        try:
            import boto3
        except ImportError as exc:
            raise RuntimeError('boto3 is required for object storage') from exc
        self._bucket = settings.object_storage_bucket
        self._client = boto3.client(
            's3',
            endpoint_url=settings.object_storage_endpoint,
            region_name=settings.object_storage_region,
            aws_access_key_id=settings.object_storage_access_key,
            aws_secret_access_key=settings.object_storage_secret_key,
        )
        self._bucket_lock = threading.Lock()
        self._bucket_ready = False

    def _ensure_bucket(self) -> None:
        if self._bucket_ready:
            return
        with self._bucket_lock:
            if self._bucket_ready:
                return
            try:
                self._client.head_bucket(Bucket=self._bucket)
            except Exception as exc:
                from botocore.exceptions import ClientError

                if not isinstance(exc, ClientError):
                    raise
                code = str(exc.response.get('Error', {}).get('Code', ''))
                if code not in {'404', 'NoSuchBucket', 'NotFound'}:
                    raise
                try:
                    self._client.create_bucket(Bucket=self._bucket)
                except ClientError as create_error:
                    create_code = str(create_error.response.get('Error', {}).get('Code', ''))
                    if create_code not in {'BucketAlreadyExists', 'BucketAlreadyOwnedByYou'}:
                        raise
            self._bucket_ready = True

    def upload(self, object_key: str, body: bytes, content_type: str) -> None:
        self._ensure_bucket()
        self._client.put_object(
            Bucket=self._bucket,
            Key=object_key,
            Body=body,
            ContentType=content_type,
            ContentLength=len(body),
        )

    def download(self, object_key: str) -> DownloadedObject:
        response = self._client.get_object(Bucket=self._bucket, Key=object_key)
        return DownloadedObject(
            body=response['Body'],
            content_type=response.get('ContentType') or 'application/octet-stream',
            content_length=response.get('ContentLength'),
        )


def get_object_storage(settings: Settings, state: object) -> ObjectStorage:
    existing = getattr(state, 'object_storage', None)
    if existing is not None:
        return existing
    storage = Boto3ObjectStorage(settings)
    setattr(state, 'object_storage', storage)
    return storage


class FileService:
    def __init__(self, session: Session, storage: ObjectStorage, settings: Settings):
        self.session = session
        self.storage = storage
        self.settings = settings
        self.chats = ChatRepository(session)
        self.files = FileRepository(session)

    def upload(
        self,
        *,
        chat_id: int,
        owner_id: int,
        original_name: str,
        content_type: str | None,
        body: bytes,
    ) -> File:
        prepared = self.prepare_upload(
            chat_id=chat_id,
            owner_id=owner_id,
            original_name=original_name,
            content_type=content_type,
            body=body,
        )
        try:
            self.storage.upload(prepared.file.object_key, body, prepared.content_type)
        except Exception as exc:
            self.mark_upload_failed(prepared.file)
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail='file_storage_upload_failed') from exc
        self.mark_upload_ready(prepared.file)
        return prepared.file

    def prepare_upload(
        self,
        *,
        chat_id: int,
        owner_id: int,
        original_name: str,
        content_type: str | None,
        body: bytes,
    ) -> PreparedUpload:
        self._require_member(chat_id, owner_id)
        safe_name = PurePath(original_name.replace('\\', '/')).name.strip()
        if not safe_name or safe_name in {'.', '..'}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='invalid_file_name')
        if len(body) > self.settings.max_upload_bytes:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail='file_too_large')
        normalized_type = (content_type or 'application/octet-stream').strip()
        if not normalized_type or len(normalized_type) > 255:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='invalid_content_type')

        file = self.files.add(
            File(
                chat_id=chat_id,
                owner_id=owner_id,
                object_key=f'chat/{chat_id}/{uuid4().hex}',
                original_name=safe_name,
                content_type=normalized_type,
                size_bytes=len(body),
                status='pending',
            )
        )
        self.session.commit()
        self.session.refresh(file)
        return PreparedUpload(file=file, content_type=normalized_type)

    def mark_upload_failed(self, file: File) -> None:
        file.status = 'failed'
        self.session.commit()

    def mark_upload_ready(self, file: File) -> None:
        file.status = 'ready'
        self.session.commit()
        self.session.refresh(file)

    def download(self, *, file_id: int, user_id: int) -> tuple[File, DownloadedObject]:
        file = self.files.get_by_id(file_id)
        if file is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='file_not_found')
        self._require_member(file.chat_id, user_id)
        if file.status != 'ready':
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='file_not_ready')
        try:
            downloaded = self.storage.download(file.object_key)
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail='file_storage_download_failed') from exc
        return file, downloaded

    def response(self, file: File) -> FileResponse:
        return FileResponse(
            file_id=file.id,
            chat_id=file.chat_id,
            owner_id=file.owner_id,
            object_key=file.object_key,
            original_name=file.original_name,
            content_type=file.content_type,
            size_bytes=file.size_bytes,
            status=file.status,
            created_at=file.created_at,
            updated_at=file.updated_at,
        )

    def _require_member(self, chat_id: int, user_id: int) -> None:
        if self.chats.get_by_id(chat_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='chat_not_found')
        if not self.chats.is_member(chat_id, user_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat_membership_required')
