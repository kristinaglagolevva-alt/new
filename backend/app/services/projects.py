from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import orm_models
from ..schemas import ImportSummary, Project, ProjectCreate, ProjectUpdate
from .workspaces import resolve_workspace_id


READY_STATUSES = {
    "ready": "Готов к документам",
    "needs_requisites": "Заполните реквизиты",
    "needs_tasks": "Импортируйте задачи",
    "needs_both": "Заполните реквизиты и задачи",
}


def _calculate_readiness(project: orm_models.ProjectORM) -> tuple[str, str]:
    performer_links = list(getattr(project, "performers", []) or [])
    has_performer = bool(project.contractor_id or performer_links)
    has_requisites = bool(project.client_id and has_performer and project.contract_id)
    has_tasks = project.tasks_count and project.tasks_count > 0

    if has_requisites and has_tasks:
        return "ready", READY_STATUSES["ready"]
    if not has_requisites and not has_tasks:
        return "needs_both", READY_STATUSES["needs_both"]
    if not has_requisites:
        return "needs_requisites", READY_STATUSES["needs_requisites"]
    return "needs_tasks", READY_STATUSES["needs_tasks"]


def _map_project(project: orm_models.ProjectORM) -> Project:
    ready_for_docs, notes = _calculate_readiness(project)
    performer_ids = [link.individual_id for link in getattr(project, "performers", []) or []]
    return Project(
        id=project.id,
        connectionId=project.connection_id,
        connection=project.connection_url,
        key=project.key,
        name=project.name,
        tracker=project.tracker,
        status=project.status,
        tasksCount=project.tasks_count,
        lastSync=project.last_sync.isoformat() if project.last_sync else None,
        clientId=project.client_id,
        contractorId=project.contractor_id,
        contractId=project.contract_id,
        performerIds=performer_ids,
        readyForDocs=ready_for_docs,
        readinessNotes=notes,
    )


def list_projects(session: Session, workspace_id: str | None = None) -> List[Project]:
    workspace = resolve_workspace_id(session, workspace_id)
    projects = (
        session.execute(
            select(orm_models.ProjectORM)
            .options(selectinload(orm_models.ProjectORM.performers))
            .where(orm_models.ProjectORM.workspace_id == workspace)
            .order_by(orm_models.ProjectORM.name)
        )
        .scalars()
        .all()
    )
    return [_map_project(project) for project in projects]


def upsert_project(session: Session, payload: ProjectCreate, workspace_id: str | None = None) -> Project:
    workspace = resolve_workspace_id(session, workspace_id)
    existing = session.execute(
        select(orm_models.ProjectORM)
        .where(orm_models.ProjectORM.workspace_id == workspace)
        .where(orm_models.ProjectORM.connection_id == payload.connectionId)
        .where(orm_models.ProjectORM.key == payload.key)
    ).scalar_one_or_none()

    project = existing or orm_models.ProjectORM(workspace_id=workspace)
    project.connection_id = payload.connectionId
    project.key = payload.key
    project.name = payload.name
    project.tracker = payload.tracker
    project.status = payload.status
    project.tasks_count = payload.tasksCount
    project.connection_url = payload.connection or project.connection_url
    project.last_sync = datetime.fromisoformat(payload.lastSync) if payload.lastSync else project.last_sync

    if payload.performerIds:
        existing = {link.individual_id: link for link in project.performers}
        desired = {pid for pid in payload.performerIds if pid}
        for link in list(project.performers):
            if link.individual_id not in desired:
                project.performers.remove(link)
                session.delete(link)
        for performer_id in desired:
            if performer_id not in existing:
                project.performers.append(
                    orm_models.ProjectPerformerORM(
                        workspace_id=workspace,
                        project_id=project.id,
                        individual_id=performer_id,
                    )
                )

    if not existing:
        session.add(project)

    session.flush()
    return _map_project(project)


def update_project_links(
    session: Session,
    project_id: str,
    payload: ProjectUpdate,
    *,
    workspace_id: str | None = None,
) -> Project:
    workspace = resolve_workspace_id(session, workspace_id)
    project = session.get(orm_models.ProjectORM, project_id)
    if not project or project.workspace_id != workspace:
        raise ValueError("Project not found")

    if payload.clientId is not None:
        if payload.clientId:
            client = session.get(orm_models.LegalEntityORM, payload.clientId)
            if client is None or client.workspace_id != workspace:
                raise ValueError("Указанный заказчик недоступен")
        project.client_id = payload.clientId or None
    if payload.contractorId is not None:
        if payload.contractorId:
            contractor = session.get(orm_models.IndividualORM, payload.contractorId)
            if contractor is None or contractor.workspace_id != workspace:
                raise ValueError("Указанный исполнитель недоступен")
        project.contractor_id = payload.contractorId or None
    if payload.contractId is not None:
        if payload.contractId:
            contract = session.get(orm_models.ContractORM, payload.contractId)
            if contract is None or contract.workspace_id != workspace:
                raise ValueError("Указанный договор недоступен")
        project.contract_id = payload.contractId or None
    if payload.performerIds is not None:
        desired = {value for value in payload.performerIds if value}
        existing = {link.individual_id: link for link in project.performers}

        for link in list(project.performers):
            if link.individual_id not in desired:
                project.performers.remove(link)
                session.delete(link)

        for performer_id in desired:
            if performer_id not in existing:
                project.performers.append(
                    orm_models.ProjectPerformerORM(
                        workspace_id=workspace,
                        project_id=project.id,
                        individual_id=performer_id,
                    )
                )

    session.flush()
    return _map_project(project)


def update_project_status(
    session: Session,
    *,
    workspace_id: str | None = None,
    connection_id: str,
    connection_url: str,
    project_key: str,
    status: str,
    tasks_count: int,
    last_sync: Optional[datetime] = None,
) -> Project:
    workspace = resolve_workspace_id(session, workspace_id)
    project = session.execute(
        select(orm_models.ProjectORM)
        .where(orm_models.ProjectORM.workspace_id == workspace)
        .where(orm_models.ProjectORM.connection_id == connection_id)
        .where(orm_models.ProjectORM.key == project_key)
    ).scalar_one_or_none()

    if not project:
        project = orm_models.ProjectORM(
            workspace_id=workspace,
            connection_id=connection_id,
            key=project_key,
            name=project_key,
        )
        session.add(project)

    project.status = status
    project.tasks_count = tasks_count
    project.last_sync = last_sync
    if connection_url:
        project.connection_url = connection_url

    session.flush()
    return _map_project(project)


def delete_project(session: Session, project_id: str, *, workspace_id: str | None = None) -> None:
    workspace = resolve_workspace_id(session, workspace_id)
    project = session.get(orm_models.ProjectORM, project_id)
    if project and project.workspace_id == workspace:
        session.delete(project)


def build_import_summary(created: int, updated: int, skipped: int, reason: str | None = None) -> ImportSummary:
    return ImportSummary(created=created, updated=updated, skipped=skipped, reason=reason)
