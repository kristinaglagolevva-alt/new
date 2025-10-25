from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy import func, select, update, or_
from sqlalchemy.orm import Session, selectinload

from ..orm_models import (
    DEFAULT_WORKSPACE_COLOR,
    UserORM,
    WorkspaceMembershipORM,
    WorkspaceORM,
    WorkspaceInviteORM,
)
from ..schemas import WorkspaceKind, WorkspaceRole, WorkspaceSummary
from ..workspace_scoping import TARGET_MODELS


ROLE_PRIORITY = {
    WorkspaceRole.viewer: 0,
    WorkspaceRole.member: 1,
    WorkspaceRole.admin: 2,
    WorkspaceRole.owner: 3,
}


def _normalize_email(value: str) -> str:
    return value.strip().lower()


def _role_priority(value: WorkspaceRole | str | None) -> int:
    if value is None:
        return 0
    normalized = normalize_workspace_role(value)
    return ROLE_PRIORITY.get(normalized, 0)


def can_assign_role(actor: WorkspaceRole | str, target: WorkspaceRole | str) -> bool:
    actor_role = normalize_workspace_role(actor)
    target_role = normalize_workspace_role(target)
    if target_role == WorkspaceRole.owner and actor_role != WorkspaceRole.owner:
        return False
    return _role_priority(actor_role) >= _role_priority(target_role)


def get_user_by_email(session: Session, email: str) -> Optional[UserORM]:
    normalized = _normalize_email(email)
    return (
        session.execute(select(UserORM).where(UserORM.email == normalized))
        .scalars()
        .first()
    )

DEFAULT_INVITE_TTL = timedelta(days=7)


def _normalize_workspace_role(value: Optional[str | WorkspaceRole]) -> str:
    if isinstance(value, WorkspaceRole):
        return value.value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {item.value for item in WorkspaceRole}:
            return normalized
    return WorkspaceRole.member.value


def _normalize_kind(value: Optional[str | WorkspaceKind]) -> WorkspaceKind:
    if isinstance(value, WorkspaceKind):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        for item in WorkspaceKind:
            if item.value == normalized:
                return item
    return WorkspaceKind.tenant


def normalize_workspace_role(value: Optional[str | WorkspaceRole]) -> WorkspaceRole:
    return WorkspaceRole(_normalize_workspace_role(value))


def build_workspace_summary(membership: WorkspaceMembershipORM) -> WorkspaceSummary:
    workspace = membership.workspace
    if workspace is None:
        raise ValueError("Workspace missing for membership")
    role_value = _normalize_workspace_role(membership.role)
    kind_enum = _normalize_kind(workspace.kind)
    return WorkspaceSummary(
        id=workspace.id,
        key=workspace.key,
        name=workspace.name,
        color=workspace.color,
        icon=workspace.icon,
        role=WorkspaceRole(role_value),
        kind=kind_enum,
        parentId=workspace.parent_id,
    )


def determine_child_kind(parent: WorkspaceKind, requested: WorkspaceKind | None) -> WorkspaceKind:
    allowed_map = {
        WorkspaceKind.tenant: {WorkspaceKind.contractor, WorkspaceKind.personal},
        WorkspaceKind.contractor: {WorkspaceKind.subcontractor, WorkspaceKind.personal},
        WorkspaceKind.subcontractor: {WorkspaceKind.personal},
        WorkspaceKind.personal: {WorkspaceKind.personal},
    }
    allowed = allowed_map.get(parent, {WorkspaceKind.personal})
    if requested and requested in allowed:
        return requested
    return next(iter(allowed))


def ensure_membership(
    session: Session,
    *,
    user: UserORM,
    workspace: WorkspaceORM,
    role: Optional[str] = None,
) -> WorkspaceMembershipORM:
    membership = (
        session.execute(
            select(WorkspaceMembershipORM)
            .where(WorkspaceMembershipORM.workspace_id == workspace.id)
            .where(WorkspaceMembershipORM.user_id == user.id)
        )
        .scalars()
        .first()
    )
    if membership:
        if role:
            normalized = _normalize_workspace_role(role)
            if membership.role != normalized:
                membership.role = normalized
        return membership

    membership = WorkspaceMembershipORM(
        workspace_id=workspace.id,
        user_id=user.id,
        role=_normalize_workspace_role(role),
    )
    session.add(membership)
    session.flush()
    return membership


def list_memberships(session: Session, user_id: str) -> list[WorkspaceMembershipORM]:
    return (
        session.execute(
            select(WorkspaceMembershipORM)
            .where(WorkspaceMembershipORM.user_id == user_id)
            .options(selectinload(WorkspaceMembershipORM.workspace))
            .order_by(WorkspaceMembershipORM.created_at.asc())
        )
        .scalars()
        .all()
    )


def list_workspace_summaries(session: Session, user_id: str) -> list[WorkspaceSummary]:
    memberships = list_memberships(session, user_id)
    return [build_workspace_summary(membership) for membership in memberships if membership.workspace]


def list_workspace_members(
    session: Session,
    workspace_id: str,
) -> list[WorkspaceMembershipORM]:
    return (
        session.execute(
            select(WorkspaceMembershipORM)
            .where(WorkspaceMembershipORM.workspace_id == workspace_id)
            .options(selectinload(WorkspaceMembershipORM.user))
            .options(selectinload(WorkspaceMembershipORM.workspace))
            .order_by(WorkspaceMembershipORM.created_at.asc())
        )
        .scalars()
        .all()
    )


def list_all_workspaces(session: Session) -> list[WorkspaceORM]:
    return (
        session.execute(select(WorkspaceORM).order_by(WorkspaceORM.created_at.asc()))
        .scalars()
        .all()
    )


def count_workspace_role(
    session: Session,
    workspace_id: str,
    role: WorkspaceRole | str,
) -> int:
    normalized = normalize_workspace_role(role).value
    statement = (
        select(func.count())
        .select_from(WorkspaceMembershipORM)
        .where(WorkspaceMembershipORM.workspace_id == workspace_id)
        .where(WorkspaceMembershipORM.role == normalized)
    )
    return int(session.execute(statement).scalar_one())


def ensure_owner_persistence(
    session: Session,
    workspace_id: str,
    membership: WorkspaceMembershipORM,
    *,
    new_role: WorkspaceRole | str | None = None,
) -> None:
    current_role = normalize_workspace_role(membership.role)
    target_role = normalize_workspace_role(new_role) if new_role is not None else None
    if current_role != WorkspaceRole.owner:
        return
    if target_role == WorkspaceRole.owner:
        return
    if count_workspace_role(session, workspace_id, WorkspaceRole.owner) <= 1:
        raise ValueError("Должен остаться хотя бы один владелец пространства")


def update_membership_role(
    session: Session,
    membership: WorkspaceMembershipORM,
    role: WorkspaceRole | str,
) -> WorkspaceMembershipORM:
    normalized_role = normalize_workspace_role(role)
    ensure_owner_persistence(
        session,
        membership.workspace_id,
        membership,
        new_role=normalized_role,
    )
    normalized = normalized_role.value
    if membership.role == normalized:
        return membership
    membership.role = normalized
    session.flush()
    return membership


def remove_workspace_member(session: Session, membership: WorkspaceMembershipORM) -> None:
    ensure_owner_persistence(session, membership.workspace_id, membership)
    session.delete(membership)
    session.flush()


def get_membership(session: Session, *, workspace_id: str, user_id: str) -> Optional[WorkspaceMembershipORM]:
    return (
        session.execute(
            select(WorkspaceMembershipORM)
            .where(WorkspaceMembershipORM.workspace_id == workspace_id)
            .where(WorkspaceMembershipORM.user_id == user_id)
            .options(selectinload(WorkspaceMembershipORM.workspace))
        )
        .scalars()
        .first()
    )


_SLUG_RE = re.compile(r"[^a-z0-9-]+")


def _normalize_key(value: str) -> str:
    base = value.strip().lower().replace(" ", "-")
    base = _SLUG_RE.sub("", base)
    base = base.strip("-")
    return base or "workspace"


def _generate_unique_key(session: Session, seed: str) -> str:
    normalized_seed = _normalize_key(seed or "workspace")
    candidate = normalized_seed
    suffix = 1
    while (
        session.execute(select(WorkspaceORM.id).where(WorkspaceORM.key == candidate))
        .scalars()
        .first()
    ):
        candidate = f"{normalized_seed}-{suffix}"
        suffix += 1
        if suffix > 50:
            candidate = f"{normalized_seed}-{uuid.uuid4().hex[:4]}"
            suffix = 1
    return candidate


def create_workspace(
    session: Session,
    *,
    owner: UserORM,
    name: str,
    key: Optional[str] = None,
    color: Optional[str] = None,
    icon: Optional[str] = None,
    parent: WorkspaceORM | None = None,
    kind: WorkspaceKind = WorkspaceKind.contractor,
) -> WorkspaceORM:
    normalized_name = (name or "").strip()
    if not normalized_name:
        normalized_name = (owner.full_name or "").strip() or owner.email

    if key:
        normalized_key = _normalize_key(key)
        existing = (
            session.execute(select(WorkspaceORM).where(WorkspaceORM.key == normalized_key))
            .scalars()
            .first()
        )
        if existing:
            raise ValueError("Рабочее пространство с таким ключом уже существует")
    else:
        normalized_key = _generate_unique_key(session, normalized_name)

    workspace = WorkspaceORM(
        id=f"ws-{uuid.uuid4().hex[:8]}",
        key=normalized_key,
        name=normalized_name,
        color=color or DEFAULT_WORKSPACE_COLOR,
        icon=icon,
        kind=kind.value,
        parent=parent,
    )
    session.add(workspace)
    session.flush()

    ensure_membership(session, user=owner, workspace=workspace, role=WorkspaceRole.owner.value)
    return workspace


def resolve_workspace_id(session: Session, workspace_id: Optional[str] = None) -> str:
    resolved = workspace_id or session.info.get("workspace_id")
    if not resolved:
        raise ValueError("workspace_id is required")
    if not session.get(WorkspaceORM, resolved):
        raise ValueError(f"workspace '{resolved}' not found")
    return resolved


def get_workspace(session: Session, workspace_id: str) -> WorkspaceORM:
    workspace = session.get(WorkspaceORM, workspace_id)
    if not workspace:
        raise ValueError(f"workspace '{workspace_id}' not found")
    return workspace


LEGACY_WORKSPACE_IDS: tuple[str | None, ...] = ("workspace-default", "", None)


def _normalize_legacy_workspace_ids(
    source_ids: Iterable[str | None] | None,
    *,
    include_null: bool,
) -> tuple[set[str], bool, bool]:
    normalized: set[str] = set()
    include_empty = False
    include_none = include_null
    for raw in source_ids or ():
        if raw is None:
            include_none = True
            continue
        value = str(raw).strip()
        if not value:
            include_empty = True
        else:
            normalized.add(value)
    return normalized, include_empty, include_none


def claim_workspace_records(
    session: Session,
    workspace: WorkspaceORM,
    *,
    source_ids: Iterable[str | None] | None = None,
    include_null: bool = True,
) -> dict[str, int]:
    """
    Reassign legacy global records (null/legacy workspace ids) to a concrete workspace.
    Returns a mapping of table name to number of rows updated.
    """
    effective_source = source_ids if source_ids is not None else LEGACY_WORKSPACE_IDS
    normalized_ids, include_empty, include_none = _normalize_legacy_workspace_ids(effective_source, include_null=include_null)
    updated: dict[str, int] = {}

    for model in TARGET_MODELS:
        column = getattr(model, "workspace_id", None)
        if column is None:
            continue

        criteria = []
        if include_none:
            criteria.append(column.is_(None))
        if include_empty:
            criteria.append(column == "")
        for value in normalized_ids:
            criteria.append(column == value)

        if not criteria:
            continue

        stmt = (
            update(model)
            .where(or_(*criteria))
            .values(workspace_id=workspace.id)
        )
        result = session.execute(stmt)
        if result.rowcount:
            updated[model.__tablename__] = result.rowcount

    return updated


def collect_descendant_ids(
    session: Session,
    workspace_id: str,
    *,
    include_self: bool = True,
) -> list[str]:
    queue = [workspace_id]
    seen: set[str] = set()
    result: list[str] = []
    while queue:
        current = queue.pop(0)
        if current in seen:
            continue
        seen.add(current)
        if include_self or current != workspace_id:
            result.append(current)
        children = session.execute(
            select(WorkspaceORM.id).where(WorkspaceORM.parent_id == current)
        ).scalars()
        queue.extend(children)
    if include_self and workspace_id not in result:
        result.insert(0, workspace_id)
    return result


def collect_ancestor_ids(
    session: Session,
    workspace_id: str,
    *,
    include_self: bool = True,
) -> list[str]:
    result: list[str] = []
    current = session.get(WorkspaceORM, workspace_id)
    while current:
        if include_self or current.id != workspace_id:
            result.append(current.id)
        if not current.parent_id:
            break
        current = session.get(WorkspaceORM, current.parent_id)
    if include_self and workspace_id not in result:
        result.insert(0, workspace_id)
    return result


def create_workspace_invite(
    session: Session,
    workspace: WorkspaceORM,
    *,
    email: str,
    role: WorkspaceRole = WorkspaceRole.member,
    inviter: Optional[UserORM] = None,
    ttl: timedelta = DEFAULT_INVITE_TTL,
) -> WorkspaceInviteORM:
    normalized_email = _normalize_email(email)
    target_role = normalize_workspace_role(role)

    if inviter and inviter.id:
        inviter_membership = get_membership(
            session,
            workspace_id=workspace.id,
            user_id=inviter.id,
        )
        if not inviter_membership:
            raise ValueError("Инвайт может отправлять только участник рабочего пространства")
        if not can_assign_role(inviter_membership.role, target_role):
            raise ValueError("Недостаточно прав для назначения роли")

    existing_user = get_user_by_email(session, normalized_email)
    if existing_user:
        membership = get_membership(
            session,
            workspace_id=workspace.id,
            user_id=existing_user.id,
        )
        if membership:
            raise ValueError("Пользователь уже состоит в рабочем пространстве")

    pending_invite = (
        session.execute(
            select(WorkspaceInviteORM)
            .where(WorkspaceInviteORM.workspace_id == workspace.id)
            .where(WorkspaceInviteORM.email == normalized_email)
            .where(WorkspaceInviteORM.status == "pending")
            .with_for_update()
        )
        .scalars()
        .first()
    )
    if pending_invite:
        pending_invite.role = target_role.value
        pending_invite.expires_at = datetime.utcnow() + ttl
        if inviter:
            pending_invite.inviter_id = inviter.id
        session.flush()
        return pending_invite

    token = uuid.uuid4().hex
    invite = WorkspaceInviteORM(
        workspace_id=workspace.id,
        email=normalized_email,
        role=target_role.value,
        token=token,
        expires_at=datetime.utcnow() + ttl,
        inviter_id=inviter.id if inviter else None,
    )
    session.add(invite)
    session.flush()
    return invite


def accept_workspace_invite(
    session: Session,
    *,
    token: str,
    user: UserORM,
) -> WorkspaceMembershipORM:
    invite = session.execute(
        select(WorkspaceInviteORM)
        .where(WorkspaceInviteORM.token == token)
        .with_for_update()
    ).scalar_one_or_none()
    if not invite or invite.status != "pending":
        raise ValueError("Приглашение недействительно")
    if invite.expires_at and invite.expires_at < datetime.utcnow():
        invite.status = "expired"
        session.flush()
        raise ValueError("Приглашение истекло")

    workspace = get_workspace(session, invite.workspace_id)
    membership = ensure_membership(session, user=user, workspace=workspace, role=invite.role)
    invite.status = "accepted"
    invite.accepted_at = datetime.utcnow()
    session.flush()
    return membership


def list_workspace_invites(
    session: Session,
    workspace_id: str,
    *,
    only_pending: bool = True,
) -> list[WorkspaceInviteORM]:
    statement = select(WorkspaceInviteORM).where(WorkspaceInviteORM.workspace_id == workspace_id)
    if only_pending:
        statement = statement.where(WorkspaceInviteORM.status == "pending")
    return session.execute(statement.order_by(WorkspaceInviteORM.created_at.desc())).scalars().all()


def find_workspace_invite(
    session: Session,
    invite_id: str,
    *,
    with_for_update: bool = False,
) -> Optional[WorkspaceInviteORM]:
    statement = select(WorkspaceInviteORM).where(WorkspaceInviteORM.id == invite_id)
    if with_for_update:
        statement = statement.with_for_update()
    return session.execute(statement).scalars().first()


def revoke_workspace_invite(session: Session, invite: WorkspaceInviteORM) -> WorkspaceInviteORM:
    invite.status = "cancelled"
    invite.expires_at = datetime.utcnow()
    session.flush()
    return invite


def expire_workspace_invites(session: Session) -> int:
    now = datetime.utcnow()
    result = session.execute(
        select(WorkspaceInviteORM)
        .where(WorkspaceInviteORM.status == "pending")
        .where(WorkspaceInviteORM.expires_at.isnot(None))
        .where(WorkspaceInviteORM.expires_at < now)
    ).scalars()
    count = 0
    for invite in result:
        invite.status = "expired"
        count += 1
    if count:
        session.flush()
    return count
