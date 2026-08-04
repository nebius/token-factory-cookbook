from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

from app.config import settings

engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})


def init_db() -> None:
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    SQLModel.metadata.create_all(engine)
    _ensure_sqlite_columns()


def _ensure_sqlite_columns() -> None:
    if not settings.database_url.startswith("sqlite"):
        return
    inspector = inspect(engine)
    if "document" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("document")}
    additions = {
        "vision_coverage": "ALTER TABLE document ADD COLUMN vision_coverage VARCHAR DEFAULT 'none'",
        "vision_pages_analyzed": "ALTER TABLE document ADD COLUMN vision_pages_analyzed INTEGER DEFAULT 0",
        "vision_pages_possible": "ALTER TABLE document ADD COLUMN vision_pages_possible INTEGER DEFAULT 0",
    }
    with engine.begin() as connection:
        for column, statement in additions.items():
            if column not in existing:
                connection.execute(text(statement))


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


def session_scope() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
        session.commit()
