"""Optional, environment-only admin seed for a freshly migrated database."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import hash_password
from app.db.session import create_database_engine, create_session_factory
from app.models.user import User
from app.repositories.users import UserRepository


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


def main() -> None:
    settings = Settings()
    settings.require_runtime_security()
    engine = create_database_engine(settings)
    session_factory = create_session_factory(engine)
    try:
        with session_factory() as session:
            seed_admin(session, settings)
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
