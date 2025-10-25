from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import orm_models
from ..schemas import ImportLog
from .workspaces import resolve_workspace_id


def record_import_log(
    session: Session,
    *,
    workspace_id: str | None = None,
    connection_id: str,
    project_key: str,
    created: int,
    updated: int,
    skipped: int,
    reason: str | None = None,
) -> ImportLog:
    workspace = resolve_workspace_id(session, workspace_id)
    log = orm_models.ImportLogORM(
        workspace_id=workspace,
        connection_id=connection_id,
        project_key=project_key,
        created_count=created,
        updated_count=updated,
        skipped_count=skipped,
        reason=reason,
    )
    session.add(log)
    session.flush()
    return ImportLog(
        id=log.id,
        connectionId=log.connection_id,
        projectKey=log.project_key,
        created=log.created_count,
        updated=log.updated_count,
        skipped=log.skipped_count,
        reason=log.reason,
        createdAt=log.created_at,
    )


def list_import_logs(session: Session, project_key: str | None = None) -> list[ImportLog]:
    workspace = resolve_workspace_id(session)
    statement = (
        select(orm_models.ImportLogORM)
        .where(orm_models.ImportLogORM.workspace_id == workspace)
        .order_by(orm_models.ImportLogORM.created_at.desc())
    )
    if project_key:
        statement = statement.where(orm_models.ImportLogORM.project_key == project_key)
    records = session.execute(statement).scalars().all()
    return [
        ImportLog(
            id=record.id,
            connectionId=record.connection_id,
            projectKey=record.project_key,
            created=record.created_count,
            updated=record.updated_count,
            skipped=record.skipped_count,
            reason=record.reason,
            createdAt=record.created_at,
        )
        for record in records
    ]
