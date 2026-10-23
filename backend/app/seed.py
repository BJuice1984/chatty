"""Optional, environment-gated seeds for a freshly migrated database."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import hash_password
from app.db.session import create_database_engine, create_session_factory
from app.models.file import File
from app.models.story import Story
from app.models.user import User
from app.repositories.users import UserRepository

# Демо-лента историй (мок-плитки клиентской стадии в реальном контракте):
# владелец-хэнл и фото из app/seed/. Порядок = свежести (первый — новее)
DEMO_STORY_USERS = (
    ('midala@chatty.demo', 'ava-1.jpg'),
    ('athalia@chatty.demo', 'ava-2.jpg'),
    ('erlan@chatty.demo', 'ava-3.jpg'),
)
_DEMO_STORY_PASSWORD = 'DemoStoriesDoNotLogin2026!'
_ASSETS = Path(__file__).resolve().parent / 'seed'


def seed_admin(session: Session, settings: Settings) -> bool:
    if not settings.seed_admin_email or not settings.seed_admin_password:
        return False
    repository = UserRepository(session)
    user = repository.get_by_email(settings.seed_admin_email)
    if user is None:
        user = User(
            email=settings.seed_admin_email.lower(),
            password_hash=hash_password(settings.seed_admin_password),
            role='admin',
        )
        repository.add(user)
    elif user.role != 'admin':
        user.role = 'admin'
    session.commit()
    return True


def _as_utc(value: datetime) -> datetime:
    """SQLite-сессии возвращают naive datetime — сравнения с aware now."""

    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def seed_demo_stories(session: Session, settings: Settings, storage) -> bool:
    """Demo story feed: three users with real files in object storage.

    Idempotent: existing rows are reused; on every seed run the stories'
    created_at is refreshed so the demo does not silently expire by the
    24h feed TTL between container restarts.
    """

    # без хранилища демо-истории невозможны (файлы обязаны лежать в нём)
    if not settings.seed_demo_stories or storage is None:
        return False

    now = datetime.now(UTC)
    created_any = False
    for index, (email, asset) in enumerate(DEMO_STORY_USERS):
        user = UserRepository(session).get_by_email(email)
        if user is None:
            user = User(
                email=email,
                password_hash=hash_password(_DEMO_STORY_PASSWORD),
            )
            session.add(user)
            session.flush()
            created_any = True

        object_key = f"media/seed-{email.split('@', 1)[0]}"
        file = session.scalar(select(File).where(File.object_key == object_key))
        if file is None:
            body = (_ASSETS / asset).read_bytes()
            storage.upload(object_key, body, 'image/jpeg')
            file = File(
                chat_id=None,
                owner_id=user.id,
                object_key=object_key,
                original_name=asset,
                content_type='image/jpeg',
                size_bytes=len(body),
                status='ready',
            )
            session.add(file)
            session.flush()
            created_any = True

        story = session.scalar(select(Story).where(Story.file_id == file.id))
        if story is None:
            # свежесть задаём сразу: порядок демо-ленты = порядок в DEMO_STORY_USERS
            story = Story(
                owner_id=user.id,
                file_id=file.id,
                created_at=now - timedelta(minutes=index),
            )
            session.add(story)
            created_any = True
        # демо не истекает по TTL, но и не подскакивает выше свежих
        # пользовательских историй при каждом рестарте: освежаем только
        # истекающие (до выпадения из ленты остался час)
        elif _as_utc(story.created_at) < now - timedelta(
            hours=settings.story_ttl_hours - 1
        ):
            story.created_at = now - timedelta(minutes=index)

    session.commit()
    return created_any


def main() -> None:
    settings = Settings()
    settings.require_runtime_security()
    engine = create_database_engine(settings)
    session_factory = create_session_factory(engine)
    try:
        with session_factory() as session:
            seed_admin(session, settings)
            seed_demo_stories(session, settings, _build_seed_storage(settings))
    finally:
        engine.dispose()


def _build_seed_storage(settings: Settings):
    try:
        from app.services.files import Boto3ObjectStorage

        return Boto3ObjectStorage(settings)
    except RuntimeError as exc:
        print(f'seed: demo stories skipped, object storage unavailable: {exc}')
        return None


if __name__ == '__main__':
    main()
