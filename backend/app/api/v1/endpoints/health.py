"""Liveness and readiness endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.db.session import check_database_connection


router = APIRouter(tags=['health'])


@router.get('/health')
async def health() -> dict[str, str]:
    return {'status': 'ok'}


@router.get('/ready')
async def readiness(db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        check_database_connection(db)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail='database_unavailable') from exc
    return {'status': 'ready'}
