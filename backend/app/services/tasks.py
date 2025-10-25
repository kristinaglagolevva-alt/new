from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, datetime
from secrets import token_urlsafe
from typing import Iterable, Sequence

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from .. import orm_models
from ..schemas import Task, TaskPeriod
from ..services.auth import create_user, ensure_user_workspace_membership, get_user_by_email
from .workspaces import resolve_workspace_id

BILLABLE_STATUSES = {"In Progress", "In Review", "Done"}


@dataclass
class ImportedTask:
    issue_id: str
    key: str
    summary: str
    status: str
    hours: float
    project_key: str
    project_name: str
    assignee_account_id: str | None = None
    assignee_display_name: str | None = None
    assignee_email: str | None = None
    spent_seconds: float = 0.0
    estimate_seconds: float = 0.0
    updated_at: datetime | None = None
    description: str | None = None


def _is_billable(status: str) -> bool:
    return status in BILLABLE_STATUSES


def _make_task_id(connection_id: str, issue_key: str) -> str:
    return f"{connection_id}:{issue_key}"


def _parse_period(period: str | None) -> tuple[str | None, datetime | None, datetime | None]:
    if not period:
        return None, None, None
    try:
        year, month = [int(part) for part in period.split("-")]
        start = datetime(year, month, 1)
        if month == 12:
            end = datetime(year + 1, 1, 1)
        else:
            end = datetime(year, month + 1, 1)
        return f"{year:04d}-{month:02d}", start, end
    except ValueError:
        return None, None, None


def _extract_issue_key(task_id: str) -> str:
    if ":" in task_id:
        return task_id.split(":", 1)[1]
    return task_id


def _ensure_individual_account(session: Session, individual: orm_models.IndividualORM) -> None:
    email = (individual.email or "").strip().lower()
    if not email:
        individual.user = None
        individual.user_id = None
        return

    desired_role = (
        orm_models.UserRole.MANAGER.value
        if getattr(individual, "is_approval_manager", False)
        else orm_models.UserRole.PERFORMER.value
    )

    workspace = session.get(orm_models.WorkspaceORM, individual.workspace_id) if individual.workspace_id else None
    if individual.workspace_id and workspace is None:
        raise ValueError(f"Рабочее пространство '{individual.workspace_id}' не найдено")

    user = individual.user

    if user and user.email.strip().lower() != email:
        conflict = get_user_by_email(session, email)
        if conflict and conflict.id != user.id:
            return
        user.email = email
    elif not user:
        existing = get_user_by_email(session, email)
        if existing:
            user = existing
        else:
            user = create_user(
                session,
                email=email,
                password=token_urlsafe(10),
                full_name=individual.name.strip() or email,
                role=desired_role,
                workspace_id=individual.workspace_id,
            )

    if user:
        if user.role != desired_role:
            user.role = desired_role
        full_name = individual.name.strip()
        if full_name and user.full_name != full_name:
            user.full_name = full_name
        if workspace:
            ensure_user_workspace_membership(
                session,
                user=user,
                workspace=workspace,
                user_role=desired_role,
            )
        individual.user = user
        individual.user_id = user.id
    else:
        individual.user = None
        individual.user_id = None

def _ensure_individual_from_task(session: Session, task: ImportedTask, workspace_id: str) -> None:
    if not task.assignee_display_name:
        return

    stmt = select(orm_models.IndividualORM).where(orm_models.IndividualORM.workspace_id == workspace_id)
    if task.assignee_account_id:
        stmt = stmt.where(orm_models.IndividualORM.external_id == task.assignee_account_id)
        existing = session.execute(stmt).scalar_one_or_none()
    else:
        existing = None

    if not existing and task.assignee_email:
        stmt = (
            select(orm_models.IndividualORM)
            .where(func.lower(orm_models.IndividualORM.email) == task.assignee_email.lower())
            .where(orm_models.IndividualORM.workspace_id == workspace_id)
        )
        existing = session.execute(stmt).scalar_one_or_none()

    if not existing:
        normalized_name = task.assignee_display_name.strip().lower()
        if normalized_name:
            stmt = (
                select(orm_models.IndividualORM)
                .where(func.lower(orm_models.IndividualORM.name) == normalized_name)
                .where(orm_models.IndividualORM.workspace_id == workspace_id)
                .order_by(orm_models.IndividualORM.updated_at.desc())
            )
            existing = session.execute(stmt).scalars().first()

    if existing:
        updated = False
        if task.assignee_email and not existing.email:
            existing.email = task.assignee_email
            updated = True
        if task.assignee_account_id and not existing.external_id:
            existing.external_id = task.assignee_account_id
            updated = True
        if existing.source == "manual" and task.assignee_account_id:
            existing.source = "jira"
            updated = True
        if updated:
            existing.updated_at = datetime.utcnow()
        _ensure_individual_account(session, existing)
        return

    individual = orm_models.IndividualORM(
        workspace_id=workspace_id,
        name=task.assignee_display_name,
        email=task.assignee_email or "",
        external_id=task.assignee_account_id,
        source="jira",
        status="incomplete",
    )
    session.add(individual)
    session.flush()
    _ensure_individual_account(session, individual)


def _build_task_contractor_resolver(session: Session, workspace_id: str):
    account_cache: dict[str, str | None] = {}
    email_cache: dict[str, str | None] = {}
    name_cache: dict[str, str | None] = {}

    def resolve(record: orm_models.TaskORM, project: orm_models.ProjectORM | None = None) -> str | None:
        account_id = (record.assignee_account_id or '').strip()
        if account_id:
            cached = account_cache.get(account_id)
            if cached is None:
                match = session.execute(
                    select(orm_models.IndividualORM.id)
                    .where(orm_models.IndividualORM.external_id == account_id)
                    .where(orm_models.IndividualORM.workspace_id == workspace_id)
                    .limit(1)
                ).scalar_one_or_none()
                account_cache[account_id] = match
                cached = match
            if cached:
                return cached

        email = (record.assignee_email or '').strip().lower()
        if email:
            cached = email_cache.get(email)
            if cached is None:
                match = session.execute(
                    select(orm_models.IndividualORM.id)
                    .where(func.lower(orm_models.IndividualORM.email) == email)
                    .where(orm_models.IndividualORM.workspace_id == workspace_id)
                    .limit(1)
                ).scalar_one_or_none()
                email_cache[email] = match
                cached = match
            if cached:
                return cached

        display_name = (record.assignee_display_name or '').strip().lower()
        if display_name:
            cached = name_cache.get(display_name)
            if cached is None:
                match = session.execute(
                    select(orm_models.IndividualORM.id)
                    .where(func.lower(orm_models.IndividualORM.name) == display_name)
                    .where(orm_models.IndividualORM.workspace_id == workspace_id)
                    .order_by(orm_models.IndividualORM.updated_at.desc())
                    .limit(1)
                ).scalar_one_or_none()
                name_cache[display_name] = match
                cached = match
            if cached:
                return cached

        if project:
            performer_links = list(getattr(project, "performers", []) or [])
            if performer_links:
                return performer_links[0].individual_id
            if project.contractor_id:
                return project.contractor_id

        return None

    return resolve


def _ensure_project_performer_link(
    session: Session,
    project: orm_models.ProjectORM | None,
    individual_id: str | None,
    account_id: str | None,
) -> None:
    if not project or not individual_id:
        return

    existing = None
    if getattr(project, "performers", None) is not None:
        for link in project.performers:
            if link.individual_id == individual_id:
                existing = link
                break
    if not existing:
        existing = session.execute(
            select(orm_models.ProjectPerformerORM)
            .where(orm_models.ProjectPerformerORM.project_id == project.id)
            .where(orm_models.ProjectPerformerORM.individual_id == individual_id)
            .limit(1)
        ).scalar_one_or_none()

    if existing:
        if account_id and not existing.tracker_account_id:
            existing.tracker_account_id = account_id
        return

    link = orm_models.ProjectPerformerORM(
        workspace_id=project.workspace_id,
        project_id=project.id,
        individual_id=individual_id,
        tracker_account_id=account_id,
    )
    session.add(link)
    if getattr(project, "performers", None) is not None:
        project.performers.append(link)


def _map_task(
    record: orm_models.TaskORM,
    project: orm_models.ProjectORM | None = None,
    *,
    contractor_resolver=None,
) -> Task:
    issue_key = _extract_issue_key(record.id)
    contractor_id = contractor_resolver(record, project) if contractor_resolver else getattr(project, "contractor_id", None)
    spent_seconds = float(getattr(record, "spent_seconds", 0.0) or 0.0)
    billed_seconds = float(getattr(record, "billed_seconds", 0.0) or 0.0)
    remaining_seconds = max(spent_seconds - billed_seconds, 0.0)
    remaining_hours = round(remaining_seconds / 3600, 2)
    return Task(
        id=record.id,
        key=issue_key,
        projectKey=record.project_key,
        projectName=record.project_name,
        projectId=getattr(project, "id", None),
        clientId=getattr(project, "client_id", None),
        contractorId=contractor_id,
        contractId=getattr(project, "contract_id", None),
        title=record.summary,
        description=record.description,
        status=record.status,
        hours=remaining_hours,
        billable=record.billable,
        forceIncluded=record.force_included,
        workPackageId=record.work_package_id,
        assigneeAccountId=record.assignee_account_id,
        assigneeDisplayName=record.assignee_display_name,
        assigneeEmail=record.assignee_email,
        secondsSpent=spent_seconds,
        secondsEstimate=float(record.estimate_seconds or 0.0),
        billedSeconds=billed_seconds,
        updatedAt=record.updated_at,
    )


def upsert_tasks(
    session: Session,
    *,
    workspace_id: str | None = None,
    connection_id: str,
    project_key: str,
    project_name: str,
    tasks: Sequence[ImportedTask],
) -> tuple[list[Task], int, int, int]:
    workspace = resolve_workspace_id(session, workspace_id)
    stored: list[tuple[orm_models.TaskORM, orm_models.ProjectORM | None]] = []
    created = 0
    updated = 0
    skipped = 0

    project_cache: dict[tuple[str, str], orm_models.ProjectORM | None] = {}

    now = datetime.utcnow()
    resolve_contractor = _build_task_contractor_resolver(session, workspace)

    for task in tasks:
        if not task.key:
            skipped += 1
            continue

        statement = (
            select(orm_models.TaskORM)
            .where(orm_models.TaskORM.issue_id == task.issue_id)
            .where(orm_models.TaskORM.workspace_id == workspace)
        )
        record = session.execute(statement).scalar_one_or_none()

        billable = _is_billable(task.status)
        spent_seconds = float(task.spent_seconds or 0.0)
        estimate_seconds = float(task.estimate_seconds or 0.0)
        seconds = spent_seconds or estimate_seconds
        hours = seconds / 3600 if seconds else float(task.hours or 0.0)

        task_id = _make_task_id(connection_id, task.key)

        actual_project_key = task.project_key or project_key
        actual_project_name = task.project_name or project_name
        cache_key = (connection_id, actual_project_key)
        if cache_key not in project_cache:
            project_cache[cache_key] = (
                session.execute(
                    select(orm_models.ProjectORM)
                    .where(orm_models.ProjectORM.connection_id == connection_id)
                    .where(orm_models.ProjectORM.key == actual_project_key)
                    .where(orm_models.ProjectORM.workspace_id == workspace)
                    .limit(1)
                ).scalar_one_or_none()
            )
        project_match = project_cache[cache_key]

        updated_at = task.updated_at or datetime.utcnow()

        if record:
            record.id = task_id
            record.summary = task.summary
            record.status = task.status
            record.hours = hours
            record.billable = billable
            record.project_key = actual_project_key
            record.project_name = actual_project_name
            record.connection_id = connection_id
            record.assignee_account_id = task.assignee_account_id
            record.assignee_display_name = task.assignee_display_name
            record.assignee_email = task.assignee_email
            previous_spent = float(getattr(record, "spent_seconds", 0.0) or 0.0)
            record.spent_seconds = spent_seconds
            record.estimate_seconds = estimate_seconds
            record.updated_at = updated_at
            record.description = task.description
            if getattr(record, "billed_seconds", None) is None:
                record.billed_seconds = 0.0
            if spent_seconds < previous_spent and record.billed_seconds > spent_seconds:
                record.billed_seconds = spent_seconds
            if spent_seconds > previous_spent and record.work_package_id:
                record.work_package_id = None
            updated += 1
        else:
            record = orm_models.TaskORM(
                workspace_id=workspace,
                id=task_id,
                issue_id=task.issue_id,
                connection_id=connection_id,
                project_key=actual_project_key,
                project_name=actual_project_name,
                summary=task.summary,
                status=task.status,
                hours=hours,
                billable=billable,
                force_included=False,
                updated_at=updated_at,
                assignee_account_id=task.assignee_account_id,
                assignee_display_name=task.assignee_display_name,
                assignee_email=task.assignee_email,
                spent_seconds=spent_seconds,
                estimate_seconds=estimate_seconds,
                billed_seconds=0.0,
                description=task.description,
            )
            session.add(record)
            created += 1

        _ensure_individual_from_task(session, task, workspace)
        contractor_id = resolve_contractor(record, project_match)
        if contractor_id:
            _ensure_project_performer_link(session, project_match, contractor_id, record.assignee_account_id)
        stored.append((record, project_match))

    session.flush()
    return [_map_task(record, project, contractor_resolver=resolve_contractor) for record, project in stored], created, updated, skipped


def prune_project_tasks(
    session: Session,
    *,
    workspace_id: str | None = None,
    connection_id: str,
    project_key: str,
    keep_issue_ids: Iterable[str],
) -> int:
    workspace = resolve_workspace_id(session, workspace_id)
    keep_set = {str(issue_id) for issue_id in keep_issue_ids if issue_id}
    query = (
        select(orm_models.TaskORM)
        .where(orm_models.TaskORM.workspace_id == workspace)
        .where(orm_models.TaskORM.connection_id == connection_id)
        .where(orm_models.TaskORM.project_key == project_key)
    )
    removed = 0
    for task in session.execute(query).scalars():
        if task.issue_id not in keep_set:
            session.delete(task)
            removed += 1
    if removed:
        session.flush()
    return removed


def list_tasks(
    session: Session,
    *,
    workspace_id: str | None = None,
    project_key: str | None = None,
    statuses: Iterable[str] | None = None,
    period: str | None = None,
    billable_only: bool = False,
) -> list[Task]:
    workspace = resolve_workspace_id(session, workspace_id)
    period_key, period_start, period_end = _parse_period(period)

    statement = select(orm_models.TaskORM, orm_models.ProjectORM).outerjoin(
        orm_models.ProjectORM,
        and_(
            orm_models.ProjectORM.connection_id == orm_models.TaskORM.connection_id,
            orm_models.ProjectORM.key == orm_models.TaskORM.project_key,
            orm_models.ProjectORM.workspace_id == orm_models.TaskORM.workspace_id,
        ),
    )

    statement = statement.where(orm_models.TaskORM.workspace_id == workspace)

    if project_key:
        statement = statement.where(orm_models.TaskORM.project_key == project_key)

    if statuses:
        statuses_list = [status.strip() for status in statuses if status and status.strip()]
        if statuses_list:
            statement = statement.where(orm_models.TaskORM.status.in_(statuses_list))

    if period_start and period_end:
        statement = statement.where(
            orm_models.TaskORM.updated_at >= period_start,
            orm_models.TaskORM.updated_at < period_end,
        )

    if billable_only:
        statement = statement.where(
            (orm_models.TaskORM.billable.is_(True)) | (orm_models.TaskORM.force_included.is_(True))
        )

    statement = statement.order_by(orm_models.TaskORM.project_key.asc(), orm_models.TaskORM.id.asc())

    records = session.execute(statement).all()

    if period_key:
        legacy_ids: set[str] = set()
        closing_ids: set[int] = set()
        for task_record, _ in records:
            work_package_id = task_record.work_package_id
            if not work_package_id:
                continue
            if work_package_id.startswith("package-v2-"):
                parts = work_package_id.split("-")
                if len(parts) >= 3:
                    try:
                        closing_ids.add(int(parts[2]))
                    except ValueError:
                        continue
            else:
                legacy_ids.add(work_package_id)

        legacy_packages: dict[str, orm_models.WorkPackageORM] = {}
        if legacy_ids:
            legacy_packages = {
                pkg.id: pkg
                for pkg in session.execute(
                    select(orm_models.WorkPackageORM).where(orm_models.WorkPackageORM.id.in_(legacy_ids))
                ).scalars()
            }

        closing_packages: dict[int, orm_models.ClosingPackageORM] = {}
        if closing_ids:
            closing_packages = {
                pkg.id: pkg
                for pkg in session.execute(
                    select(orm_models.ClosingPackageORM).where(orm_models.ClosingPackageORM.id.in_(closing_ids))
                ).scalars()
            }

        filtered_records: list[tuple[orm_models.TaskORM, orm_models.ProjectORM | None]] = []
        for task_record, project_record in records:
            matches_period = False
            if period_start and period_end and task_record.updated_at:
                matches_period = period_start <= task_record.updated_at < period_end

            if not matches_period:
                work_package_id = task_record.work_package_id
                if work_package_id:
                    legacy = legacy_packages.get(work_package_id)
                    if legacy and legacy.period == period_key:
                        matches_period = True
                    elif work_package_id.startswith("package-v2-"):
                        parts = work_package_id.split("-")
                        if len(parts) >= 3:
                            try:
                                package_id = int(parts[2])
                            except ValueError:
                                package_id = None
                            if package_id is not None:
                                package = closing_packages.get(package_id)
                                if package and f"{package.period_start:%Y-%m}" == period_key:
                                    matches_period = True

            if matches_period:
                filtered_records.append((task_record, project_record))

        records = filtered_records

    resolve_contractor = _build_task_contractor_resolver(session, workspace)
    return [
        _map_task(task_record, project_record, contractor_resolver=resolve_contractor)
        for task_record, project_record in records
    ]


MONTH_NAMES_RU = {
    1: "Январь",
    2: "Февраль",
    3: "Март",
    4: "Апрель",
    5: "Май",
    6: "Июнь",
    7: "Июль",
    8: "Август",
    9: "Сентябрь",
    10: "Октябрь",
    11: "Ноябрь",
    12: "Декабрь",
}


def list_task_periods(session: Session, workspace_id: str | None = None, project_key: str | None = None) -> list[TaskPeriod]:
    workspace = resolve_workspace_id(session, workspace_id)
    statement = select(orm_models.TaskORM.updated_at, orm_models.TaskORM.work_package_id).where(
        orm_models.TaskORM.workspace_id == workspace
    )
    if project_key:
        statement = statement.where(orm_models.TaskORM.project_key == project_key)

    rows = session.execute(statement).all()
    timestamps = [ts for ts, _ in rows if ts]

    periods: dict[str, dict[str, object]] = {}

    def _ensure_period(year: int, month: int) -> str:
        value = f"{year:04d}-{month:02d}"
        if value not in periods:
            start = date(year, month, 1)
            last_day = calendar.monthrange(year, month)[1]
            periods[value] = {
                "start": start,
                "end": date(year, month, last_day),
                "label": f"{MONTH_NAMES_RU.get(month, start.strftime('%B'))} {year}",
                "tasks": 0,
            }
        return value

    for ts in timestamps:
        value = _ensure_period(ts.year, ts.month)
        periods[value]["tasks"] = int(periods[value]["tasks"]) + 1

    legacy_ids: set[str] = set()
    closing_ids: set[int] = set()
    for _, work_package_id in rows:
        if not work_package_id:
            continue
        if work_package_id.startswith("package-v2-"):
            parts = work_package_id.split("-")
            if len(parts) >= 3:
                try:
                    closing_ids.add(int(parts[2]))
                except ValueError:
                    continue
        else:
            legacy_ids.add(work_package_id)

    if legacy_ids:
        for pkg in session.execute(
            select(orm_models.WorkPackageORM).where(orm_models.WorkPackageORM.id.in_(legacy_ids))
        ).scalars():
            try:
                year, month = [int(part) for part in pkg.period.split("-")]
                _ensure_period(year, month)
            except (ValueError, AttributeError):
                continue

    if closing_ids:
        for pkg in session.execute(
            select(orm_models.ClosingPackageORM).where(orm_models.ClosingPackageORM.id.in_(closing_ids))
        ).scalars():
            if pkg.period_start:
                _ensure_period(pkg.period_start.year, pkg.period_start.month)

    return [
        TaskPeriod(
            value=value,
            label=data["label"],
            start=data["start"],
            end=data["end"],
            tasks=data["tasks"],
        )
        for value, data in sorted(periods.items())
    ]


def count_project_tasks(session: Session, *, workspace_id: str | None = None, connection_id: str, project_key: str) -> int:
    workspace = resolve_workspace_id(session, workspace_id)
    statement = select(func.count(orm_models.TaskORM.id)).where(
        orm_models.TaskORM.connection_id == connection_id,
        orm_models.TaskORM.project_key == project_key,
        orm_models.TaskORM.workspace_id == workspace,
    )
    return int(session.execute(statement).scalar_one() or 0)


def set_task_force_included(session: Session, task_id: str, force_included: bool, *, workspace_id: str | None = None) -> Task:
    workspace = resolve_workspace_id(session, workspace_id)
    record = session.get(orm_models.TaskORM, task_id)
    if not record or record.workspace_id != workspace:
        raise ValueError("Task not found")

    record.force_included = force_included
    session.flush()
    project = session.execute(
        select(orm_models.ProjectORM)
        .where(orm_models.ProjectORM.connection_id == record.connection_id)
        .where(orm_models.ProjectORM.key == record.project_key)
        .where(orm_models.ProjectORM.workspace_id == workspace)
        .limit(1)
    ).scalar_one_or_none()
    resolver = _build_task_contractor_resolver(session, workspace)
    return _map_task(record, project, contractor_resolver=resolver)
