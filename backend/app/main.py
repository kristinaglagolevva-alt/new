from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from secrets import token_urlsafe

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer

from pydantic import BaseModel, AnyHttpUrl, EmailStr, root_validator, validator
from sqlalchemy import delete
from sqlalchemy.orm import Session

from .config import settings
from .database import get_session, init_db, session_scope
from .models import TemplateModel, TemplatePayload, TemplateInStorage
from .storage import list_templates, save_templates
from .jira_client import JiraClient, JiraError
from .jira_storage import (
    JiraProjectRecord,
    store_connection,
    get_connection,
    decode_token,
    find_connection_by_credentials,
    _normalize_base_url,
)
from . import orm_models
from .schemas import (
    Contract,
    ContractCreate,
    ContractUpdate,
    Individual,
    IndividualCreate,
    IndividualUpdate,
    LegalEntity,
    LegalEntityCreate,
    LegalEntityUpdate,
    Project,
    ProjectCreate,
    ProjectUpdate,
    ImportSummary,
    Task,
    TaskUpdate,
    TaskPeriod,
    DocumentCreateRequest,
    DocumentCreateResponse,
    DocumentRecord,
    DocumentApprovalRequest,
    DocumentNoteRequest,
    DocumentAssigneeUpdate,
    WorkPackage,
    ImportLog,
    UserCreate,
    UserRole,
    UserPublic,
    TokenResponse,
    LoginRequest,
    Company,
    CompanyCreate,
    CompanyUpdate,
    ContractV2,
    ContractV2Create,
    ContractV2Update,
    ContractStatus,
    PartyType,
    PackageCreateRequest,
    PackageCreateResponse,
    ContractUiProfile,
    WorkspaceCreateRequest,
    WorkspaceUpdateRequest,
    WorkspaceSummary,
    WorkspaceMember,
    WorkspaceInvite,
    WorkspaceInviteCreateRequest,
    WorkspaceMemberUpdateRequest,
    WorkspaceClaimResponse,
    WorkspaceUserCreateRequest,
)
from .services.directory import (
    delete_contract,
    delete_individual,
    delete_legal_entity,
    list_contracts as legacy_list_contracts,
    list_individuals,
    list_legal_entities,
    upsert_contract,
    upsert_individual,
    upsert_legal_entity,
)
from .services.contracts import (
    ServiceError,
    create_contract as create_contract_v2,
    get_contract_ui_profile,
    list_contracts as list_contracts_v2,
    lookup_company_by_inn,
    update_contract as update_contract_v2,
    upsert_company,
)
from .services.packages import (
    create_package as create_package_service,
    resolve_package_document_file,
)
from .services.projects import (
    build_import_summary,
    delete_project,
    list_projects,
    update_project_links,
    update_project_status,
    upsert_project,
)
from .services.tasks import (
    ImportedTask,
    upsert_tasks,
    list_tasks as service_list_tasks,
    list_task_periods,
    set_task_force_included,
    count_project_tasks,
    prune_project_tasks,
)
from .services.documents import (
    generate_document,
    delete_document as service_delete_document,
    list_documents as service_list_documents,
    list_work_packages as service_list_work_packages,
    get_document as service_get_document,
    resolve_document_file,
    release_work_package_tasks,
    transition_document_approval,
    add_document_note,
    update_document_assignees,
    share_document_with_parent,
    revoke_document_share,
)
from .services.imports import (
    record_import_log,
    list_import_logs as service_list_import_logs,
)
from .services.auth import (
    authenticate_user,
    create_access_token,
    create_user,
    list_users,
    decode_access_token,
    reset_user_password,
    delete_user,
    update_user_roles,
    serialize_user,
)
from .services.workspaces import (
    WorkspaceKind,
    WorkspaceRole,
    build_workspace_summary,
    collect_descendant_ids,
    create_workspace as service_create_workspace,
    get_workspace,
    determine_child_kind,
    ensure_membership,
    claim_workspace_records,
    get_membership,
    list_memberships,
    list_workspace_summaries,
    normalize_workspace_role,
    list_workspace_members,
    list_all_workspaces,
    create_workspace_invite,
    list_workspace_invites,
    find_workspace_invite,
    revoke_workspace_invite,
    accept_workspace_invite,
    expire_workspace_invites,
    update_membership_role,
    remove_workspace_member,
    count_workspace_role,
    can_assign_role,
    LEGACY_WORKSPACE_IDS,
)

app = FastAPI(title="Jira Integration Backend", version="0.1.0")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


@app.on_event("startup")
def startup_event() -> None:  # pragma: no cover - side effect
    init_db()

cors_origins_env = os.getenv("BACKEND_CORS_ORIGINS")
if cors_origins_env:
    allow_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
else:
    allow_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> UserPublic:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Необходима авторизация")
    payload = decode_access_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен")
    user = session.get(orm_models.UserORM, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Пользователь недоступен")
    return serialize_user(session, user)


def require_roles(*roles: UserRole | str):
    allowed = {
        normalized
        for role in roles
        for normalized in [
            (_normalize_user_role(role.value) if isinstance(role, UserRole) else _normalize_user_role(role))
        ]
        if normalized
    }

    def dependency(current_user: UserPublic = Depends(get_current_user)) -> UserPublic:
        if allowed:
            effective_roles = set(_resolve_user_roles(current_user))
            if not (effective_roles & allowed):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Недостаточно прав для выполнения действия",
                )
        return current_user

    return dependency


def require_super_admin(current_user: UserPublic = Depends(get_current_user)) -> UserPublic:
    allowed = settings.super_admin_email.strip().lower()
    if not allowed:
        return current_user
    if current_user.email.strip().lower() != allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Действие доступно только оператору платформы",
        )
    return current_user


auth_dependency = Depends(get_current_user)


def _purge_legacy_membership(session: Session, user: UserPublic) -> None:
    super_admin_email = settings.super_admin_email.strip().lower()
    if user.email.strip().lower() == super_admin_email:
        return
    hidden_ids = [value for value in LEGACY_WORKSPACE_IDS if isinstance(value, str) and value]
    for workspace_id in hidden_ids:
        membership = get_membership(session, workspace_id=workspace_id, user_id=user.id)
        if membership:
            session.delete(membership)
            session.flush()


def _normalize_user_role(value: object | None) -> str | None:
    if value is None:
        return None
    raw = getattr(value, "value", value)
    if not isinstance(raw, str):
        return None
    normalized = raw.strip().lower()
    return normalized or None


@dataclass
class WorkspaceAccess:
    user: UserPublic
    workspace: orm_models.WorkspaceORM
    membership: orm_models.WorkspaceMembershipORM
    role: WorkspaceRole
    scope: tuple[str, ...]

    @property
    def id(self) -> str:
        return self.workspace.id


def get_workspace_context(
    request: Request,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(get_current_user),
) -> WorkspaceAccess:
    _purge_legacy_membership(session, current_user)
    requested_id = request.headers.get("X-Workspace-Id") or request.query_params.get("workspaceId")
    membership = None
    if requested_id:
        membership = get_membership(session, workspace_id=requested_id, user_id=current_user.id)

    if membership is None:
        hidden_ids = {value for value in LEGACY_WORKSPACE_IDS if isinstance(value, str) and value}
        is_super_admin = current_user.email.strip().lower() == settings.super_admin_email.strip().lower()
        memberships = [
            item
            for item in list_memberships(session, current_user.id)
            if is_super_admin or item.workspace_id not in hidden_ids
        ]
        membership = memberships[0] if memberships else None

    if membership is None or membership.workspace is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Рабочее пространство недоступно",
        )

    role_enum = normalize_workspace_role(membership.role)
    scope = tuple(collect_descendant_ids(session, membership.workspace_id, include_self=True))
    session.info["workspace_id"] = membership.workspace_id
    session.info["workspace_scope"] = scope
    session.info["workspace_role"] = role_enum.value

    return WorkspaceAccess(
        user=current_user,
        workspace=membership.workspace,
        membership=membership,
        role=role_enum,
        scope=scope,
    )


workspace_dependency = Depends(get_workspace_context)


def _resolve_user_roles(user: UserPublic) -> list[str]:
    roles: list[str] = []

    def add(value: object | None) -> None:
        normalized = _normalize_user_role(value)
        if normalized and normalized not in roles:
            roles.append(normalized)

    add(user.role)
    extras = getattr(user, "roles", None)
    if isinstance(extras, (list, tuple, set)):
        for role in extras:
            add(role)

    return roles


def require_workspace_roles(*roles: UserRole | WorkspaceRole | str):
    allowed_user_roles: set[str] = set()
    allowed_workspace_roles: set[str] = set()

    for role in roles:
        if isinstance(role, WorkspaceRole):
            allowed_workspace_roles.add(role.value)
        elif isinstance(role, UserRole):
            normalized = _normalize_user_role(role.value)
            if normalized:
                allowed_user_roles.add(normalized)
        elif isinstance(role, str):
            normalized = _normalize_user_role(role)
            if normalized:
                allowed_user_roles.add(normalized)

    def dependency(access: WorkspaceAccess = Depends(get_workspace_context)) -> WorkspaceAccess:
        if allowed_workspace_roles and access.role.value not in allowed_workspace_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Недостаточно прав в рабочем пространстве",
            )

        if allowed_user_roles:
            effective_roles = set(_resolve_user_roles(access.user))
            if not (effective_roles & allowed_user_roles):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Недостаточно прав для выполнения действия",
                )
        return access

    return dependency


def _raise_service_error(error: ServiceError) -> None:
    status_map = {
        "validation_failed": status.HTTP_400_BAD_REQUEST,
        "unique_violation": status.HTTP_409_CONFLICT,
        "not_found": status.HTTP_404_NOT_FOUND,
        "contract_expired": status.HTTP_400_BAD_REQUEST,
        "no_contract_resolved": status.HTTP_400_BAD_REQUEST,
        "selfemployed_no_receipt": status.HTTP_400_BAD_REQUEST,
    }
    http_status = status_map.get(error.code, status.HTTP_400_BAD_REQUEST)
    raise HTTPException(status_code=http_status, detail=error.to_dict())


def _to_model(template: TemplateInStorage) -> TemplateModel:
    return TemplateModel(
        id=template.id,
        name=template.name,
        type=template.type,
        content=template.content,
        description=template.description,
        updated_at=template.updated_at,
    )


def _to_workspace_member(membership: orm_models.WorkspaceMembershipORM) -> WorkspaceMember:
    user = membership.user
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не удалось загрузить пользователя рабочего пространства",
        )
    return WorkspaceMember(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=normalize_workspace_role(membership.role),
        is_active=user.is_active,
        joined_at=membership.created_at,
    )


def _to_workspace_invite(invite: orm_models.WorkspaceInviteORM, *, include_token: bool = False) -> WorkspaceInvite:
    payload = dict(
        id=invite.id,
        email=invite.email,
        role=normalize_workspace_role(invite.role),
        status=invite.status,
        created_at=invite.created_at,
        expires_at=invite.expires_at,
        accepted_at=invite.accepted_at,
        inviter_id=invite.inviter_id,
    )
    if include_token:
        payload["token"] = invite.token
    return WorkspaceInvite(**payload)


def _get_actor_membership(
    session: Session,
    workspace_id: str,
    access: WorkspaceAccess,
) -> orm_models.WorkspaceMembershipORM:
    membership = get_membership(session, workspace_id=workspace_id, user_id=access.user.id)
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет доступа к рабочему пространству",
        )
    return membership


# Response models -----------------------------------------------------------


class PasswordResetResponse(BaseModel):
    userId: str
    password: str


class UserRoleUpdateRequest(BaseModel):
    role: UserRole | None = None
    roles: list[UserRole] | None = None

    @root_validator(pre=True)
    def _ensure_roles(cls, values: dict) -> dict:
        if values.get("roles") is None and values.get("role") is not None:
            values["roles"] = [values["role"]]
        return values

    @validator("roles")
    def _normalize_roles(cls, roles: list[UserRole] | None) -> list[UserRole]:
        if not roles:
            raise ValueError("Укажите хотя бы одну роль")
        unique: list[UserRole] = []
        for role in roles:
            if role not in unique:
                unique.append(role)
        return unique


class JiraAuthRequest(BaseModel):
    baseUrl: AnyHttpUrl
    email: EmailStr
    apiToken: str


@app.post("/auth/register", response_model=UserPublic, status_code=201, tags=["auth"])
def api_register_user(
    payload: UserCreate,
    session: Session = Depends(get_session),
    _operator: UserPublic = Depends(require_super_admin),
) -> UserPublic:
    workspace_options = payload.workspace
    if workspace_options is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Укажите параметры рабочего пространства")

    mode = (workspace_options.mode or "new").strip().lower()
    target_workspace: orm_models.WorkspaceORM | None = None
    parent_workspace: orm_models.WorkspaceORM | None = None

    if workspace_options.parentId:
        parent_workspace = get_workspace(session, workspace_options.parentId)

    if mode == "existing":
        workspace_id = workspace_options.workspaceId
        if not workspace_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Укажите идентификатор рабочего пространства")
        target_workspace = get_workspace(session, workspace_id)
    elif mode != "new":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недопустимый режим выдачи доступа")

    workspace_label = workspace_options.name or payload.fullName or payload.email

    user = create_user(
        session,
        email=payload.email,
        password=payload.password,
        full_name=payload.fullName or payload.email,
        role=payload.role.value,
        workspace=target_workspace,
        auto_provision_workspace=False,
        provision_on_missing=False,
        use_session_workspace=False,
        workspace_display_name=workspace_label,
    )

    if mode == "new":
        try:
            requested_kind = workspace_options.kind if isinstance(workspace_options.kind, WorkspaceKind) else WorkspaceKind(workspace_options.kind)
        except ValueError:
            requested_kind = WorkspaceKind.tenant
        service_create_workspace(
            session,
            owner=user,
            name=workspace_label or user.full_name or user.email,
            parent=parent_workspace,
            kind=requested_kind,
        )
    elif target_workspace is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Рабочее пространство не найдено")

    return serialize_user(session, user)


@app.post("/auth/login", response_model=TokenResponse, tags=["auth"])
def api_login(payload: LoginRequest, session: Session = Depends(get_session)) -> TokenResponse:
    user = authenticate_user(session, payload.email, payload.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверные учетные данные")
    token = create_access_token(user.id)
    return TokenResponse(accessToken=token, user=serialize_user(session, user))


@app.get("/auth/me", response_model=UserPublic, tags=["auth"])
def api_me(current_user: UserPublic = Depends(get_current_user)) -> UserPublic:
    return current_user


@app.get("/workspaces", response_model=list[WorkspaceSummary], tags=["workspaces"])
def api_list_workspaces(
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(get_current_user),
) -> list[WorkspaceSummary]:
    return list_workspace_summaries(session, current_user.id)


@app.get("/admin/workspaces", response_model=list[WorkspaceSummary], tags=["workspaces"])
def api_admin_list_workspaces(
    session: Session = Depends(get_session),
    _operator: UserPublic = Depends(require_super_admin),
) -> list[WorkspaceSummary]:
    workspaces = list_all_workspaces(session)
    summaries: list[WorkspaceSummary] = []
    for workspace in workspaces:
        try:
            kind = WorkspaceKind(workspace.kind or WorkspaceKind.tenant.value)
        except ValueError:
            kind = WorkspaceKind.tenant
        summaries.append(
            WorkspaceSummary(
                id=workspace.id,
                key=workspace.key,
                name=workspace.name,
                color=workspace.color,
                icon=workspace.icon,
                role=WorkspaceRole.viewer,
                kind=kind,
                parentId=workspace.parent_id,
            )
        )
    return summaries


@app.post(
    "/workspaces/{workspace_id}/claim",
    response_model=WorkspaceClaimResponse,
    tags=["workspaces"],
)
def api_claim_workspace(
    workspace_id: str,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(WorkspaceRole.owner)),
) -> WorkspaceClaimResponse:
    membership = get_membership(session, workspace_id=workspace_id, user_id=access.user.id)
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет доступа к рабочему пространству",
        )
    workspace = membership.workspace or get_workspace(session, workspace_id)
    updated = claim_workspace_records(session, workspace)
    return WorkspaceClaimResponse(workspace_id=workspace.id, updated=updated)


@app.post("/workspaces", response_model=WorkspaceSummary, status_code=201, tags=["workspaces"])
def api_create_workspace(
    payload: WorkspaceCreateRequest,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(WorkspaceRole.owner)),
) -> WorkspaceSummary:
    owner = session.get(orm_models.UserORM, access.user.id)
    if not owner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    parent_id = payload.parentId or access.workspace.id
    if parent_id not in access.scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к выбранному родителю")

    parent = get_workspace(session, parent_id)
    try:
        parent_kind = WorkspaceKind(parent.kind or WorkspaceKind.tenant.value)
    except ValueError:
        parent_kind = WorkspaceKind.tenant
    try:
        requested_kind = payload.kind if isinstance(payload.kind, WorkspaceKind) else WorkspaceKind(payload.kind)
    except ValueError:
        requested_kind = None
    child_kind = determine_child_kind(parent_kind, requested_kind)

    try:
        workspace = service_create_workspace(
            session,
            owner=owner,
            name=payload.name,
            key=payload.key,
            color=payload.color,
            icon=payload.icon,
            parent=parent,
            kind=child_kind,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    membership = get_membership(session, workspace_id=workspace.id, user_id=owner.id)
    if not membership:
        membership = ensure_membership(session, user=owner, workspace=workspace, role=WorkspaceRole.owner.value)
    return build_workspace_summary(membership)


@app.get(
    "/workspaces/{workspace_id}/members",
    response_model=list[WorkspaceMember],
    tags=["workspaces"],
)
def api_list_workspace_members(
    workspace_id: str,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(WorkspaceRole.viewer)),
) -> list[WorkspaceMember]:
    if workspace_id not in access.scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к рабочему пространству")
    get_workspace(session, workspace_id)
    memberships = list_workspace_members(session, workspace_id)
    return [_to_workspace_member(membership) for membership in memberships]


@app.patch(
    "/workspaces/{workspace_id}/members/{user_id}",
    response_model=WorkspaceMember,
    tags=["workspaces"],
)
def api_update_workspace_member_role(
    workspace_id: str,
    user_id: str,
    payload: WorkspaceMemberUpdateRequest,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(WorkspaceRole.admin, WorkspaceRole.owner)),
) -> WorkspaceMember:
    if workspace_id not in access.scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к рабочему пространству")
    target_membership = get_membership(session, workspace_id=workspace_id, user_id=user_id)
    if target_membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Участник не найден")

    actor_membership = _get_actor_membership(session, workspace_id, access)
    actor_role = normalize_workspace_role(actor_membership.role)

    current_role = normalize_workspace_role(target_membership.role)
    if not can_assign_role(actor_role, current_role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для изменения роли")
    if not can_assign_role(actor_role, payload.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для назначения роли")

    try:
        updated_membership = update_membership_role(session, target_membership, payload.role)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return _to_workspace_member(updated_membership)


@app.delete(
    "/workspaces/{workspace_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["workspaces"],
)
def api_remove_workspace_member(
    workspace_id: str,
    user_id: str,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(WorkspaceRole.admin, WorkspaceRole.owner)),
) -> Response:
    if workspace_id not in access.scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к рабочему пространству")
    membership = get_membership(session, workspace_id=workspace_id, user_id=user_id)
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Участник не найден")

    actor_membership = _get_actor_membership(session, workspace_id, access)
    actor_role = normalize_workspace_role(actor_membership.role)
    target_role = normalize_workspace_role(membership.role)
    if not can_assign_role(actor_role, target_role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для удаления участника")

    if membership.user_id == access.user.id and target_role == WorkspaceRole.owner:
        remaining_owners = count_workspace_role(session, workspace_id, WorkspaceRole.owner)
        if remaining_owners <= 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя удалить последнего владельца")

    try:
        remove_workspace_member(session, membership)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get(
    "/workspaces/{workspace_id}/invites",
    response_model=list[WorkspaceInvite],
    tags=["workspaces"],
)
def api_list_workspace_invites(
    workspace_id: str,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(WorkspaceRole.admin, WorkspaceRole.owner)),
) -> list[WorkspaceInvite]:
    if workspace_id not in access.scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к рабочему пространству")
    expire_workspace_invites(session)
    invites = list_workspace_invites(session, workspace_id, only_pending=False)
    return [_to_workspace_invite(invite) for invite in invites]


@app.post(
    "/workspaces/{workspace_id}/invites",
    response_model=WorkspaceInvite,
    status_code=status.HTTP_201_CREATED,
    tags=["workspaces"],
)
def api_create_workspace_invite(
    workspace_id: str,
    payload: WorkspaceInviteCreateRequest,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(WorkspaceRole.admin, WorkspaceRole.owner)),
) -> WorkspaceInvite:
    if workspace_id not in access.scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к рабочему пространству")
    workspace = get_workspace(session, workspace_id)
    inviter = session.get(orm_models.UserORM, access.user.id)
    if inviter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    try:
        invite = create_workspace_invite(
            session,
            workspace,
            email=payload.email,
            role=payload.role,
            inviter=inviter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return _to_workspace_invite(invite, include_token=True)


ALLOWED_WORKSPACE_USER_ROLES = {
    UserRole.accountant,
    UserRole.manager,
    UserRole.performer,
    UserRole.viewer,
}


@app.post(
    "/workspaces/{workspace_id}/users",
    response_model=PasswordResetResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["workspaces"],
)
def api_create_workspace_user(
    workspace_id: str,
    payload: WorkspaceUserCreateRequest,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(WorkspaceRole.admin, WorkspaceRole.owner)),
) -> PasswordResetResponse:
    if workspace_id not in access.scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к рабочему пространству")
    if payload.role not in ALLOWED_WORKSPACE_USER_ROLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя создать пользователя с такой ролью")

    workspace = get_workspace(session, workspace_id)
    raw_password = (payload.password or "").strip()
    if payload.generatePassword or not raw_password:
        raw_password = token_urlsafe(12)
    if len(raw_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Пароль должен содержать не менее 8 символов")

    user = create_user(
        session,
        email=payload.email,
        password=raw_password,
        full_name=payload.fullName or payload.email,
        role=payload.role.value,
        workspace=workspace,
        auto_provision_workspace=False,
        provision_on_missing=False,
        use_session_workspace=False,
    )

    return PasswordResetResponse(userId=user.id, password=raw_password)


@app.delete(
    "/workspaces/{workspace_id}/invites/{invite_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["workspaces"],
)
def api_revoke_workspace_invite(
    workspace_id: str,
    invite_id: str,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(WorkspaceRole.admin, WorkspaceRole.owner)),
) -> Response:
    if workspace_id not in access.scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к рабочему пространству")
    invite = find_workspace_invite(session, invite_id, with_for_update=True)
    if invite is None or invite.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Приглашение не найдено")
    try:
        revoke_workspace_invite(session, invite)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post(
    "/workspace-invites/{token}/accept",
    response_model=WorkspaceSummary,
    tags=["workspaces"],
)
def api_accept_workspace_invite(
    token: str,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(get_current_user),
) -> WorkspaceSummary:
    db_user = session.get(orm_models.UserORM, current_user.id)
    if db_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    try:
        membership = accept_workspace_invite(session, token=token, user=db_user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return build_workspace_summary(membership)


@app.get("/users", response_model=list[UserPublic], tags=["auth"])
def api_list_users(
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(require_super_admin),
) -> list[UserPublic]:
    return [serialize_user(session, user) for user in list_users(session)]


@app.post("/users/{user_id}/reset-password", response_model=PasswordResetResponse, tags=["auth"])
def api_reset_user_password(
    user_id: str,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(require_super_admin),
) -> PasswordResetResponse:
    user, password = reset_user_password(session, user_id)
    return PasswordResetResponse(userId=user.id, password=password)


@app.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["auth"])
def api_delete_user(  # type: ignore[return-value]
    user_id: str,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(require_super_admin),
) -> Response:
    delete_user(session, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.patch("/users/{user_id}", response_model=UserPublic, tags=["auth"])
def api_update_user_role(
    user_id: str,
    payload: UserRoleUpdateRequest,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(require_super_admin),
) -> UserPublic:
    roles = [role.value for role in (payload.roles or [])]
    user = update_user_roles(session, user_id, roles)
    return serialize_user(session, user)


class JiraProjectResponse(BaseModel):
    id: str
    key: str
    name: str
    status: str = "discovered"
    lastSync: str | None = None
    tasksCount: int = 0
    tracker: str
    connection: str


class JiraAuthResponse(BaseModel):
    connectionId: str
    workspaceId: str
    projects: list[Project]


class JiraImportRequest(BaseModel):
    connectionId: str
    projectKey: str
    maxIssues: int | None = 100


class JiraImportResponse(BaseModel):
    project: Project
    tasks: list[Task]
    summary: ImportSummary


def _jira_period_start(now: datetime | None = None) -> datetime:
    """Return the first day of the month two months before the current month (UTC)."""
    reference = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    month_start = reference.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month = month_start.month - 2
    year = month_start.year
    while month <= 0:
        month += 12
        year -= 1
    return month_start.replace(year=year, month=month)


@app.get("/health", tags=["system"])
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get(
    "/templates",
    response_model=list[TemplateModel],
    tags=["templates"],
    dependencies=[auth_dependency],
)
def get_templates() -> list[TemplateModel]:
    return [_to_model(item) for item in list_templates()]


@app.post(
    "/templates",
    response_model=TemplateModel,
    status_code=201,
    tags=["templates"],
    dependencies=[auth_dependency],
)
def create_template(payload: TemplatePayload) -> TemplateModel:
    templates = list_templates()
    template = TemplateInStorage(
        id=str(uuid.uuid4()),
        name=payload.name,
        type=payload.type,
        content=payload.content,
        description=payload.description,
        updated_at=datetime.utcnow(),
    )
    templates.insert(0, template)
    save_templates(templates)
    return _to_model(template)


@app.put(
    "/templates/{template_id}",
    response_model=TemplateModel,
    tags=["templates"],
    dependencies=[auth_dependency],
)
def update_template(template_id: str, payload: TemplatePayload) -> TemplateModel:
    templates = list_templates()
    for index, existing in enumerate(templates):
        if existing.id == template_id:
            updated = TemplateInStorage(
                id=template_id,
                name=payload.name,
                type=payload.type,
                content=payload.content,
                description=payload.description,
                updated_at=datetime.utcnow(),
            )
            templates[index] = updated
            save_templates(templates)
            return _to_model(updated)
    raise HTTPException(status_code=404, detail="Template not found")


@app.delete(
    "/templates/{template_id}",
    status_code=204,
    tags=["templates"],
    dependencies=[auth_dependency],
)
def delete_template(template_id: str) -> None:
    templates = list_templates()
    next_templates = [item for item in templates if item.id != template_id]
    if len(next_templates) == len(templates):
        raise HTTPException(status_code=404, detail="Template not found")
    save_templates(next_templates)


@app.get(
    "/directory/legal-entities",
    response_model=list[LegalEntity],
    tags=["directory"],
)
def api_list_legal_entities(
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.viewer, UserRole.manager, UserRole.accountant, UserRole.admin)),
) -> list[LegalEntity]:
    return list_legal_entities(session, workspace_id=access.id)


@app.post(
    "/directory/legal-entities",
    response_model=LegalEntity,
    status_code=201,
    tags=["directory"],
)
def api_create_legal_entity(
    payload: LegalEntityCreate,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin, UserRole.accountant)),
) -> LegalEntity:
    try:
        return upsert_legal_entity(session, payload, workspace_id=access.id)
    except ValueError as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.put(
    "/directory/legal-entities/{entity_id}",
    response_model=LegalEntity,
    tags=["directory"],
)
def api_update_legal_entity(
    entity_id: str,
    payload: LegalEntityUpdate,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin, UserRole.accountant)),
) -> LegalEntity:
    try:
        return upsert_legal_entity(session, payload, workspace_id=access.id, entity_id=entity_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete(
    "/directory/legal-entities/{entity_id}",
    status_code=204,
    tags=["directory"],
)
def api_delete_legal_entity(
    entity_id: str,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin)),
) -> None:
    delete_legal_entity(session, entity_id, workspace_id=access.id)


@app.get(
    "/directory/individuals",
    response_model=list[Individual],
    tags=["directory"],
)
def api_list_individuals(
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.viewer, UserRole.manager, UserRole.accountant, UserRole.admin)),
) -> list[Individual]:
    return list_individuals(session, workspace_id=access.id)


@app.post(
    "/directory/individuals",
    response_model=Individual,
    status_code=201,
    tags=["directory"],
)
def api_create_individual(
    payload: IndividualCreate,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin, UserRole.accountant, UserRole.manager)),
) -> Individual:
    try:
        return upsert_individual(session, payload, workspace_id=access.id)
    except ValueError as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.put(
    "/directory/individuals/{individual_id}",
    response_model=Individual,
    tags=["directory"],
)
def api_update_individual(
    individual_id: str,
    payload: IndividualUpdate,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin, UserRole.accountant, UserRole.manager)),
) -> Individual:
    try:
        return upsert_individual(session, payload, workspace_id=access.id, individual_id=individual_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete(
    "/directory/individuals/{individual_id}",
    status_code=204,
    tags=["directory"],
)
def api_delete_individual(
    individual_id: str,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin)),
) -> None:
    delete_individual(session, individual_id, workspace_id=access.id)


# === Companies & Contracts v2 ===============================================


@app.get(
    "/companies",
    response_model=Company,
    tags=["contracts"],
    dependencies=[auth_dependency],
)
def api_get_company(inn: str = Query(..., description="ИНН контрагента"), session: Session = Depends(get_session)) -> Company:
    company = lookup_company_by_inn(session, inn)
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "not_found", "message": "Компания не найдена"},
        )
    return company


@app.post(
    "/companies",
    response_model=Company,
    status_code=201,
    tags=["contracts"],
)
def api_create_company(
    payload: CompanyCreate,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(require_roles(UserRole.admin, UserRole.accountant)),
) -> Company:
    try:
        return upsert_company(session, payload, actor_id=current_user.id)
    except ContractServiceError as error:
        _raise_service_error(error)


@app.put(
    "/companies/{company_id}",
    response_model=Company,
    tags=["contracts"],
)
def api_update_company(
    company_id: int,
    payload: CompanyUpdate,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(require_roles(UserRole.admin, UserRole.accountant)),
) -> Company:
    try:
        existing = session.get(orm_models.CompanyORM, company_id)
        if not existing:
            raise ContractServiceError("not_found", "Компания не найдена")
        return upsert_company(session, payload, existing=existing, actor_id=current_user.id)
    except ContractServiceError as error:
        _raise_service_error(error)


@app.get(
    "/contracts",
    response_model=list[ContractV2],
    tags=["contracts"],
    dependencies=[auth_dependency],
)
def api_list_contracts_v2(
    session: Session = Depends(get_session),
    inn: str | None = Query(None, description="ИНН контрагента"),
    party_type: PartyType | None = Query(None),
    status: list[ContractStatus] | None = Query(None),
) -> list[ContractV2]:
    return list_contracts_v2(
        session,
        party_type=party_type,
        party_inn=inn,
        status=status,
    )


@app.post(
    "/contracts",
    response_model=ContractV2,
    status_code=201,
    tags=["contracts"],
)
def api_create_contract_v2(
    payload: ContractV2Create,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(require_roles(UserRole.admin, UserRole.accountant)),
) -> ContractV2:
    try:
        return create_contract_v2(session, payload, actor_id=current_user.id)
    except ServiceError as error:
        _raise_service_error(error)


@app.put(
    "/contracts/{contract_id}",
    response_model=ContractV2,
    tags=["contracts"],
)
def api_update_contract_v2(
    contract_id: int,
    payload: ContractV2Update,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(require_roles(UserRole.admin, UserRole.accountant)),
) -> ContractV2:
    try:
        return update_contract_v2(session, contract_id, payload, actor_id=current_user.id)
    except ServiceError as error:
        _raise_service_error(error)


@app.get(
    "/contracts/{contract_id}/ui-profile",
    response_model=ContractUiProfile,
    tags=["contracts"],
    dependencies=[auth_dependency],
)
def api_contract_ui_profile(contract_id: int, session: Session = Depends(get_session)) -> ContractUiProfile:
    try:
        return get_contract_ui_profile(session, contract_id)
    except ServiceError as error:
        _raise_service_error(error)


@app.post(
    "/packages",
    response_model=PackageCreateResponse,
    status_code=201,
    tags=["packages"],
)
def api_create_package(
    payload: PackageCreateRequest,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(require_roles(UserRole.admin, UserRole.accountant)),
) -> PackageCreateResponse:
    try:
        return create_package_service(session, payload, actor_id=current_user.id)
    except ServiceError as error:
        _raise_service_error(error)


@app.get(
    "/packages/{package_id}/documents/{document_id}/file",
    tags=["packages"],
    dependencies=[auth_dependency],
)
def api_download_package_document(
    package_id: int,
    document_id: int,
    session: Session = Depends(get_session),
) -> FileResponse:
    try:
        path, filename = resolve_package_document_file(session, package_id, document_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Файл не найден") from exc
    return FileResponse(
        path,
        filename=filename,
        media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )


@app.get(
    "/directory/contracts",
    response_model=list[Contract],
    tags=["directory"],
)
def api_list_contracts(
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.viewer, UserRole.manager, UserRole.accountant, UserRole.admin)),
) -> list[Contract]:
    return legacy_list_contracts(session, workspace_id=access.id)


@app.post(
    "/directory/contracts",
    response_model=Contract,
    status_code=201,
    tags=["directory"],
)
def api_create_contract(
    payload: ContractCreate,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin, UserRole.accountant)),
) -> Contract:
    try:
        return upsert_contract(session, payload, workspace_id=access.id)
    except ValueError as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.put(
    "/directory/contracts/{contract_id}",
    response_model=Contract,
    tags=["directory"],
)
def api_update_contract(
    contract_id: str,
    payload: ContractUpdate,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin, UserRole.accountant)),
) -> Contract:
    try:
        return upsert_contract(session, payload, workspace_id=access.id, contract_id=contract_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete(
    "/directory/contracts/{contract_id}",
    status_code=204,
    tags=["directory"],
)
def api_delete_contract(
    contract_id: str,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin)),
) -> None:
    delete_contract(session, contract_id, workspace_id=access.id)


@app.get(
    "/projects",
    response_model=list[Project],
    tags=["projects"],
)
def api_list_projects(
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.viewer, UserRole.manager, UserRole.accountant, UserRole.admin)),
) -> list[Project]:
    return list_projects(session, workspace_id=access.id)


@app.post(
    "/projects",
    response_model=Project,
    status_code=201,
    tags=["projects"],
)
def api_create_project(
    payload: ProjectCreate,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin, UserRole.accountant)),
) -> Project:
    return upsert_project(session, payload, workspace_id=access.id)


@app.put(
    "/projects/{project_id}",
    response_model=Project,
    tags=["projects"],
)
def api_update_project(
    project_id: str,
    payload: ProjectUpdate,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin, UserRole.accountant)),
) -> Project:
    try:
        return update_project_links(session, project_id, payload, workspace_id=access.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete(
    "/projects/{project_id}",
    status_code=204,
    tags=["projects"],
)
def api_delete_project(
    project_id: str,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin)),
) -> None:
    delete_project(session, project_id, workspace_id=access.id)


@app.post(
    "/jira/connections",
    response_model=JiraAuthResponse,
    tags=["jira"],
)
def connect_jira(
    request: JiraAuthRequest,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin, UserRole.accountant)),
) -> JiraAuthResponse:
    normalized_base_url = _normalize_base_url(str(request.baseUrl))

    try:
        with JiraClient(normalized_base_url, request.email, request.apiToken) as client:
            projects_raw = client.fetch_projects()
    except JiraError as exc:  # pragma: no cover - network dependent
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - network dependent
        raise HTTPException(status_code=500, detail="Не удалось подключиться к Jira") from exc

    existing_connection = find_connection_by_credentials(str(request.baseUrl), str(request.email))
    connection_id = existing_connection.id if existing_connection else str(uuid.uuid4())

    target_workspace_id = access.id

    projects_records: list[JiraProjectRecord] = []
    stored_projects: list[Project] = []
    project_keys = {project.key for project in projects_raw}

    if existing_connection and project_keys:
        session.execute(
            delete(orm_models.ProjectORM)
            .where(orm_models.ProjectORM.workspace_id == target_workspace_id)
            .where(orm_models.ProjectORM.key.in_(project_keys))
            .where(orm_models.ProjectORM.connection_id != connection_id)
        )

    for project in projects_raw:
        projects_records.append(
            JiraProjectRecord(
                id=project.id,
                key=project.key,
                name=project.name,
            )
        )
        stored_projects.append(
            upsert_project(
                session,
                ProjectCreate(
                    connectionId=connection_id,
                    connection=normalized_base_url,
                    key=project.key,
                    name=project.name,
                    tracker="Jira",
                    status="discovered",
                    tasksCount=0,
                ),
                workspace_id=target_workspace_id,
            )
        )

    store_connection(
        connection_id=connection_id,
        base_url=normalized_base_url,
        email=str(request.email),
        api_token=request.apiToken,
        workspace_id=target_workspace_id,
        projects=projects_records,
    )

    return JiraAuthResponse(connectionId=connection_id, workspaceId=target_workspace_id, projects=stored_projects)


@app.get(
    "/jira/projects",
    response_model=list[Project],
    tags=["jira"],
)
def get_jira_projects(
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.viewer, UserRole.manager, UserRole.accountant, UserRole.admin)),
) -> list[Project]:
    return list_projects(session, workspace_id=access.id)


@app.post(
    "/jira/projects/import",
    response_model=JiraImportResponse,
    tags=["jira"],
)
def import_jira_project(
    request: JiraImportRequest,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin, UserRole.accountant, UserRole.manager)),
) -> JiraImportResponse:
    connection = get_connection(request.connectionId)
    if not connection:
        raise HTTPException(status_code=404, detail="Jira connection not found")

    target_workspace_id = connection.workspace_id or access.id
    if connection.workspace_id and connection.workspace_id != access.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Подключение Jira принадлежит другому рабочему пространству",
        )

    api_token = decode_token(connection)

    try:
        with JiraClient(connection.base_url, connection.email, api_token) as client:
            period_start = _jira_period_start()
            issues_raw, project_meta = client.fetch_issues(
                request.projectKey,
                max_results=request.maxIssues or 100,
                updated_since=period_start.date().isoformat(),
            )
    except JiraError as exc:  # pragma: no cover - network dependent
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - network dependent
        raise HTTPException(status_code=500, detail="Не удалось загрузить задачи из Jira") from exc

    def map_status(status: str) -> str:
        mapping = {
            "Backlog": "Backlog",
            "To Do": "To Do",
            "Selected for Development": "To Do",
            "In Progress": "In Progress",
            "In Review": "In Review",
            "Code Review": "In Review",
            "Ready for QA": "In Review",
            "Done": "Done",
            "Resolved": "Done",
        }
        return mapping.get(status, "In Progress")

    imported_tasks = [
        ImportedTask(
            issue_id=issue.id,
            key=issue.key or issue.project_key,
            summary=issue.summary,
            status=map_status(issue.status),
            project_key=issue.project_key,
            project_name=issue.project_name,
            assignee_account_id=issue.assignee_account_id,
            assignee_display_name=issue.assignee_display_name,
            assignee_email=issue.assignee_email,
            spent_seconds=float(issue.time_spent_seconds or 0),
            estimate_seconds=float(issue.time_estimate_seconds or 0),
            updated_at=issue.updated_at,
            hours=(issue.time_spent_seconds or issue.time_estimate_seconds or 0) / 3600,
            description=issue.description,
        )
        for issue in issues_raw
    ]

    issue_ids_to_keep = [task.issue_id for task in imported_tasks if task.issue_id]

    reason: str | None = None

    stored_tasks, created, updated, skipped = upsert_tasks(
        session,
        workspace_id=target_workspace_id,
        connection_id=request.connectionId,
        project_key=request.projectKey,
        project_name=project_meta.get("name", request.projectKey) if project_meta else request.projectKey,
        tasks=imported_tasks,
    )

    removed = prune_project_tasks(
        session,
        workspace_id=target_workspace_id,
        connection_id=request.connectionId,
        project_key=request.projectKey,
        keep_issue_ids=issue_ids_to_keep,
    )

    total_tasks = count_project_tasks(
        session,
        workspace_id=target_workspace_id,
        connection_id=request.connectionId,
        project_key=request.projectKey,
    )

    project_response = update_project_status(
        session,
        workspace_id=target_workspace_id,
        connection_id=request.connectionId,
        connection_url=connection.base_url,
        project_key=request.projectKey,
        status="connected",
        tasks_count=total_tasks,
        last_sync=datetime.utcnow(),
    )

    all_tasks = service_list_tasks(
        session,
        workspace_id=target_workspace_id,
        project_key=request.projectKey,
    )

    if skipped > 0:
        reason = "Пропущены задачи без ключа"
    if removed > 0:
        removal_note = f"Удалено {removed} устаревших задач"
        reason = f"{reason}; {removal_note}" if reason else removal_note

    record_import_log(
        session,
        workspace_id=target_workspace_id,
        connection_id=request.connectionId,
        project_key=request.projectKey,
        created=created,
        updated=updated,
        skipped=skipped,
        reason=reason,
    )

    summary = build_import_summary(created=created, updated=updated, skipped=skipped, reason=reason)

    return JiraImportResponse(project=project_response, tasks=all_tasks, summary=summary)


@app.get(
    "/tasks",
    response_model=list[Task],
    tags=["tasks"],
)
def api_list_tasks(
    projectKey: str | None = None,
    statuses: list[str] | None = Query(default=None),
    period: str | None = None,
    billableOnly: bool = False,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.viewer, UserRole.manager, UserRole.accountant, UserRole.admin)),
) -> list[Task]:
    return service_list_tasks(
        session,
        workspace_id=access.id,
        project_key=projectKey,
        statuses=statuses,
        period=period,
        billable_only=billableOnly,
    )


@app.get(
    "/tasks/periods",
    response_model=list[TaskPeriod],
    tags=["tasks"],
)
def api_list_task_periods(
    projectKey: str | None = None,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.viewer, UserRole.manager, UserRole.accountant, UserRole.admin)),
) -> list[TaskPeriod]:
    return list_task_periods(session, workspace_id=access.id, project_key=projectKey)


@app.patch(
    "/tasks/{task_id}",
    response_model=Task,
    tags=["tasks"],
)
def api_update_task(
    task_id: str,
    payload: TaskUpdate,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(UserRole.admin, UserRole.accountant, UserRole.manager)),
) -> Task:
    if payload.forceIncluded is None:
        raise HTTPException(status_code=400, detail="Не переданы изменения")

    try:
        return set_task_force_included(session, task_id, payload.forceIncluded, workspace_id=access.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get(
    "/documents",
    response_model=list[DocumentRecord],
    tags=["documents"],
    dependencies=[workspace_dependency],
)
def api_list_documents(
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(
        require_roles(
            UserRole.admin,
            UserRole.accountant,
            UserRole.manager,
            UserRole.performer,
        )
    ),
) -> list[DocumentRecord]:
    return service_list_documents(session, current_user=current_user)


@app.get(
    "/documents/{document_id}",
    response_model=DocumentRecord,
    tags=["documents"],
    dependencies=[workspace_dependency],
)
def api_get_document(
    document_id: str,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(
        require_roles(
            UserRole.admin,
            UserRole.accountant,
            UserRole.manager,
            UserRole.performer,
        )
    ),
) -> DocumentRecord:
    record = service_get_document(session, document_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found")
    roles = set(_resolve_user_roles(current_user))
    user_id = current_user.id
    if roles and user_id and not (roles & {'admin', 'accountant'}):
        has_access = False
        if 'performer' in roles and record.performerAssignee and record.performerAssignee.id == user_id:
            has_access = True
        if 'manager' in roles and record.managerAssignee and record.managerAssignee.id == user_id:
            has_access = True
        if not has_access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    return record


@app.post(
    "/documents",
    response_model=DocumentCreateResponse,
    status_code=201,
    tags=["documents"],
    dependencies=[workspace_dependency],
)
def api_create_document(
    payload: DocumentCreateRequest,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(require_roles(UserRole.admin, UserRole.accountant)),
) -> DocumentCreateResponse:
    try:
        return generate_document(session, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete(
    "/documents/{document_id}",
    status_code=204,
    tags=["documents"],
    dependencies=[workspace_dependency],
)
def api_delete_document(
    document_id: str,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(require_roles(UserRole.admin, UserRole.accountant)),
) -> None:
    deleted = service_delete_document(session, document_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    return None


@app.post(
    "/documents/{document_id}/share",
    response_model=DocumentRecord,
    tags=["documents"],
    dependencies=[workspace_dependency],
)
def api_share_document(
    document_id: str,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(WorkspaceRole.admin, WorkspaceRole.owner)),
) -> DocumentRecord:
    db_user = session.get(orm_models.UserORM, access.user.id)
    if not db_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    try:
        return share_document_with_parent(session, document_id, user=db_user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.delete(
    "/documents/{document_id}/share",
    response_model=DocumentRecord,
    tags=["documents"],
    dependencies=[workspace_dependency],
)
def api_revoke_document_share(
    document_id: str,
    session: Session = Depends(get_session),
    access: WorkspaceAccess = Depends(require_workspace_roles(WorkspaceRole.admin, WorkspaceRole.owner)),
) -> DocumentRecord:
    try:
        return revoke_document_share(session, document_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post(
    "/documents/{document_id}/approval",
    response_model=DocumentRecord,
    tags=["documents"],
    dependencies=[workspace_dependency],
)
def api_transition_document(
    document_id: str,
    payload: DocumentApprovalRequest,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(
        require_roles(
            UserRole.admin,
            UserRole.accountant,
            UserRole.manager,
            UserRole.performer,
        )
    ),
) -> DocumentRecord:
    try:
        roles = _resolve_user_roles(current_user)
        primary_role = roles[0] if roles else (_normalize_user_role(current_user.role) or "performer")

        return transition_document_approval(
            session,
            document_id,
            payload.action,
            user_role=primary_role,
            user_roles=roles,
            user_identifier=current_user.email,
            user_id=current_user.id,
            note=payload.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.patch(
    "/documents/{document_id}/approval/assignees",
    response_model=DocumentRecord,
    tags=["documents"],
    dependencies=[workspace_dependency],
)
def api_update_document_assignees(
    document_id: str,
    payload: DocumentAssigneeUpdate,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(require_roles(UserRole.admin, UserRole.accountant)),
) -> DocumentRecord:
    try:
        return update_document_assignees(
            session,
            document_id,
            performer_id=payload.performerId,
            manager_id=payload.managerId,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post(
    "/documents/{document_id}/notes",
    response_model=DocumentRecord,
    tags=["documents"],
    dependencies=[workspace_dependency],
)
def api_document_add_note(
    document_id: str,
    payload: DocumentNoteRequest,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(
        require_roles(
            UserRole.admin,
            UserRole.accountant,
            UserRole.manager,
            UserRole.performer,
        )
    ),
) -> DocumentRecord:
    try:
        return add_document_note(
            session,
            document_id,
            user_role=current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role),
            user_identifier=current_user.email,
            message=payload.message,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get(
    "/documents/{document_id}/files/{file_id}",
    tags=["documents"],
    dependencies=[workspace_dependency],
)
def api_download_document_file(
    document_id: str,
    file_id: str,
    session: Session = Depends(get_session),
    current_user: UserPublic = Depends(
        require_roles(
            UserRole.admin,
            UserRole.accountant,
            UserRole.manager,
            UserRole.performer,
        )
    ),
) -> FileResponse:
    try:
        path, filename = resolve_document_file(session, document_id, file_id)
    except FileNotFoundError as exc:  # pragma: no cover - file system access
        raise HTTPException(status_code=404, detail="Файл не найден") from exc
    suffix = Path(filename).suffix.lower()
    media_type = {
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.doc': 'application/msword',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.csv': 'text/csv',
        '.json': 'application/json',
        '.txt': 'text/plain',
    }.get(suffix, 'application/octet-stream')
    return FileResponse(path, filename=filename, media_type=media_type)


@app.get(
    "/work-packages",
    response_model=list[WorkPackage],
    tags=["documents"],
    dependencies=[auth_dependency, workspace_dependency],
)
def api_list_work_packages(session: Session = Depends(get_session)) -> list[WorkPackage]:
    return service_list_work_packages(session)


@app.post(
    "/work-packages/{work_package_id}/release",
    response_model=WorkPackage,
    tags=["documents"],
    dependencies=[auth_dependency, workspace_dependency],
)
def api_release_work_package(work_package_id: str, session: Session = Depends(get_session)) -> WorkPackage:
    try:
        return release_work_package_tasks(session, work_package_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get(
    "/jira/imports",
    response_model=list[ImportLog],
    tags=["jira"],
    dependencies=[auth_dependency, workspace_dependency],
)
def api_list_import_logs(
    projectKey: str | None = None,
    session: Session = Depends(get_session),
) -> list[ImportLog]:
    return service_list_import_logs(session, project_key=projectKey)
