from __future__ import annotations

from datetime import datetime, timedelta
from secrets import token_urlsafe
from typing import Optional
from types import SimpleNamespace

import jwt
from fastapi import HTTPException, status
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..orm_models import UserORM, UserRole, IndividualORM, WorkspaceORM, WorkspaceMembershipORM
from ..schemas import UserPublic
from .workspaces import (
    WorkspaceRole,
    WorkspaceKind,
    create_workspace,
    ensure_membership,
    list_workspace_summaries,
    LEGACY_WORKSPACE_IDS,
)

MUTABLE_ROLE_VALUES = {UserRole.MANAGER.value, UserRole.PERFORMER.value}

ROLE_TO_WORKSPACE_ROLE: dict[str, WorkspaceRole] = {
    UserRole.ADMIN.value: WorkspaceRole.admin,
    UserRole.ACCOUNTANT.value: WorkspaceRole.admin,
    UserRole.MANAGER.value: WorkspaceRole.member,
    UserRole.PERFORMER.value: WorkspaceRole.member,
    UserRole.VIEWER.value: WorkspaceRole.viewer,
}


def _normalize_user_role(value: object | None) -> str | None:
    if value is None:
        return None
    raw = getattr(value, "value", value)
    if not isinstance(raw, str):
        return None
    normalized = raw.strip().lower()
    return normalized or None


def _normalize_role_values(roles: Optional[list[str] | tuple[str, ...] | set[str]]) -> list[str]:
    if not roles:
        return []
    result: list[str] = []
    seen: set[str] = set()
    for raw in roles:
        if not isinstance(raw, str):
            continue
        value = raw.strip().lower()
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _effective_roles(user: UserORM) -> list[str]:
    return _normalize_role_values(user.roles)


def _workspace_role_for_user(role: str | None) -> WorkspaceRole:
    normalized = _normalize_user_role(role)
    if not normalized:
        return WorkspaceRole.member
    return ROLE_TO_WORKSPACE_ROLE.get(normalized, WorkspaceRole.member)


def ensure_user_workspace_membership(
    session: Session,
    *,
    user: UserORM,
    workspace: WorkspaceORM,
    user_role: str | None = None,
    workspace_role: WorkspaceRole | str | None = None,
) -> WorkspaceMembershipORM:
    if workspace_role is not None:
        if isinstance(workspace_role, WorkspaceRole):
            resolved_role = workspace_role
        else:
            normalized = _normalize_user_role(workspace_role)
            if not normalized:
                raise ValueError("Недопустимая роль рабочего пространства")
            try:
                resolved_role = WorkspaceRole(normalized)
            except ValueError as exc:
                raise ValueError("Недопустимая роль рабочего пространства") from exc
    else:
        resolved_role = _workspace_role_for_user(user_role or user.role)

    return ensure_membership(
        session,
        user=user,
        workspace=workspace,
        role=resolved_role.value,
    )


def serialize_user(session: Session, user: UserORM) -> UserPublic:
    base = UserPublic.from_orm(user)
    effective = _effective_roles(user)
    summaries = list_workspace_summaries(session, user.id)
    super_admin_email = settings.super_admin_email.strip().lower()
    user_email = user.email.strip().lower()
    if super_admin_email and user_email != super_admin_email:
        hidden_ids = {value for value in LEGACY_WORKSPACE_IDS if isinstance(value, str) and value}
        summaries = [summary for summary in summaries if summary.id not in hidden_ids]
    return base.copy(update={"roles": effective, "workspaces": summaries})

try:
    import bcrypt as _bcrypt_module
except ImportError:
    _bcrypt_module = None
else:
    if not hasattr(_bcrypt_module, "__about__") and hasattr(_bcrypt_module, "__version__"):
        _bcrypt_module.__about__ = SimpleNamespace(__version__=_bcrypt_module.__version__)
        # Ensure hashpw gracefully handles overly long secrets (older bcrypt versions raise).
        _original_hashpw = _bcrypt_module.hashpw

        def _hashpw_with_truncate(secret: bytes, salt: bytes) -> bytes:
            try:
                return _original_hashpw(secret, salt)
            except ValueError as exc:
                if len(secret) > BCRYPT_MAX_BYTES and "Password must be at most" in str(exc):
                    return _original_hashpw(secret[:BCRYPT_MAX_BYTES], salt)
                if len(secret) > BCRYPT_MAX_BYTES and "longer than" in str(exc):
                    return _original_hashpw(secret[:BCRYPT_MAX_BYTES], salt)
                raise

        _bcrypt_module.hashpw = _hashpw_with_truncate

BCRYPT_MAX_BYTES = 72

def _ensure_password_within_limit(password: str) -> None:
    """Ensure password length does not exceed bcrypt limits."""
    if len(password.encode("utf-8")) > BCRYPT_MAX_BYTES:
        raise ValueError("Password exceeds bcrypt maximum length")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    _ensure_password_within_limit(password)
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except ValueError:
        return False


def get_user_by_email(session: Session, email: str) -> Optional[UserORM]:
    return session.execute(select(UserORM).where(UserORM.email == email.lower())).scalar_one_or_none()


def create_user(
    session: Session,
    *,
    email: str,
    password: str,
    full_name: str,
    role: str,
    workspace: WorkspaceORM | None = None,
    workspace_id: str | None = None,
    auto_provision_workspace: bool = False,
    provision_on_missing: bool = True,
    use_session_workspace: bool = True,
    workspace_display_name: str | None = None,
) -> UserORM:
    normalized_email = email.lower().strip()
    if get_user_by_email(session, normalized_email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Пользователь уже существует")
    if role not in {item.value for item in UserRole}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недопустимая роль")

    try:
        password_hash = hash_password(password)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пароль не должен превышать 72 байта",
        ) from exc

    user = UserORM(
        email=normalized_email,
        full_name=full_name.strip() or normalized_email,
        role=role,
        password_hash=password_hash,
    )
    session.add(user)
    session.flush()

    target_workspace = workspace
    if target_workspace is None and workspace_id:
        target_workspace = session.get(WorkspaceORM, workspace_id)
        if target_workspace is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Рабочее пространство не найдено")
    if target_workspace is None and use_session_workspace:
        fallback_id = session.info.get("workspace_id")
        if fallback_id:
            target_workspace = session.get(WorkspaceORM, fallback_id)
    if target_workspace is not None:
        ensure_user_workspace_membership(
            session,
            user=user,
            workspace=target_workspace,
            user_role=role,
        )
    else:
        if not provision_on_missing:
            return user
        if not auto_provision_workspace and role != UserRole.ADMIN.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Не удалось определить рабочее пространство для пользователя",
            )
        workspace_name = workspace_display_name or full_name.strip() or normalized_email
        create_workspace(
            session,
            owner=user,
            name=workspace_name,
            kind=WorkspaceKind.tenant,
        )

    return user


def list_users(session: Session) -> list[UserORM]:
    return (
        session.execute(
            select(UserORM).order_by(UserORM.created_at.desc())
        )
        .scalars()
        .all()
    )


def authenticate_user(session: Session, email: str, password: str) -> Optional[UserORM]:
    user = get_user_by_email(session, email)
    if not user:
        return None
    if not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_access_token(subject: str, expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.auth_access_token_expire_minutes))
    to_encode = {"sub": subject, "exp": expire}
    return jwt.encode(to_encode, settings.auth_secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.auth_secret_key, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError as exc:  # pragma: no cover - runtime behaviour
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Токен истек") from exc
    except jwt.PyJWTError as exc:  # pragma: no cover - runtime behaviour
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен") from exc


def ensure_default_admin(session: Session) -> None:
    if session.execute(select(UserORM)).first():
        return
    try:
        create_user(
            session,
            email=settings.default_admin_email,
            password=settings.default_admin_password,
            full_name="Administrator",
            role=UserRole.ADMIN.value,
            auto_provision_workspace=True,
        )
    except HTTPException as exc:
        raise RuntimeError(
            "DEFAULT_ADMIN_PASSWORD must be 72 bytes or fewer when encoded as UTF-8",
        ) from exc


def reset_user_password(session: Session, user_id: str) -> tuple[UserORM, str]:
    user = session.get(UserORM, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    new_password = token_urlsafe(10)
    user.password_hash = hash_password(new_password)
    user.updated_at = datetime.utcnow()
    session.flush()
    return user, new_password


def delete_user(session: Session, user_id: str) -> None:
    user = session.get(UserORM, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    for individual in session.query(IndividualORM).filter(IndividualORM.user_id == user_id):
        individual.user = None
        individual.user_id = None
    session.delete(user)


def update_user_roles(session: Session, user_id: str, roles: list[str]) -> UserORM:
    user = session.get(UserORM, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    if user.role in {UserRole.ADMIN.value, UserRole.ACCOUNTANT.value}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя изменить роль администратора или бухгалтера",
        )

    normalized: list[str] = []
    seen: set[str] = set()
    for raw in roles:
        if not isinstance(raw, str):
            continue
        value = raw.strip().lower()
        if not value:
            continue
        if value not in MUTABLE_ROLE_VALUES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Допустимы только роли менеджера и исполнителя",
            )
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)

    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Укажите хотя бы одну роль",
        )

    # Ensure predictable priority: manager supersedes performer
    role_priority = [UserRole.MANAGER.value, UserRole.PERFORMER.value]
    ordered = [value for value in role_priority if value in seen]

    primary = ordered[0]
    extras = ordered[1:]

    user.role = primary
    user.extra_roles = extras
    session.flush()

    is_manager = UserRole.MANAGER.value in ordered
    for individual in session.query(IndividualORM).filter(IndividualORM.user_id == user_id):
        individual.is_approval_manager = is_manager

    session.flush()
    return user
