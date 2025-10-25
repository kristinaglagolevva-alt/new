from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session as SessionBase, declarative_base, sessionmaker

from .config import settings
from .migrations import run_migrations

DATABASE_URL = settings.database_url

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
    # Ensure directory exists for SQLite db
    db_path = DATABASE_URL.replace("sqlite:///", "")
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)


class WorkspaceSession(SessionBase):
    """Session enhanced with workspace metadata."""


SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    future=True,
    class_=WorkspaceSession,
)

Base = declarative_base()


@contextmanager
def session_scope() -> Generator[WorkspaceSession, None, None]:
    session: WorkspaceSession = SessionLocal()  # type: ignore[assignment]
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Generator[WorkspaceSession, None, None]:
    with session_scope() as session:
        yield session


def init_db() -> None:
    from . import orm_models  # noqa: F401
    from .services.auth import ensure_default_admin
    from .workspace_scoping import setup_workspace_events

    setup_workspace_events(WorkspaceSession)

    run_migrations(engine)

    Base.metadata.create_all(bind=engine)

    with session_scope() as session:
        ensure_default_admin(session)
