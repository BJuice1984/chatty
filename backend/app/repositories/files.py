"""File metadata queries."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.file import File


class FileRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_by_id(self, file_id: int) -> File | None:
        return self.session.get(File, file_id)

    def add(self, file: File) -> File:
        self.session.add(file)
        self.session.flush()
        return file

    def list_for_chat(self, chat_id: int) -> list[File]:
        statement = select(File).where(File.chat_id == chat_id).order_by(File.created_at.asc(), File.id.asc())
        return list(self.session.scalars(statement))
