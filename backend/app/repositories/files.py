"""File metadata queries."""

from __future__ import annotations

from sqlalchemy import func, select
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

    def user_usage(self, owner_id: int) -> tuple[int, int]:
        """(total_bytes, file_count) of EVERY row the user uploaded — chat
        attachments and global media (avatars, story images) alike, any
        status — in one aggregate SUM/COUNT by owner; the Data Usage screen
        contract."""
        total_bytes, file_count = self.session.execute(
            select(func.coalesce(func.sum(File.size_bytes), 0), func.count(File.id)).where(
                File.owner_id == owner_id
            )
        ).one()
        return int(total_bytes), int(file_count)
