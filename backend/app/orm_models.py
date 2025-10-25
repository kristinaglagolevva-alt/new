from __future__ import annotations

import uuid
from datetime import date, datetime

from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base


def generate_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


class UserRole(str, PyEnum):
    ADMIN = "admin"
    ACCOUNTANT = "accountant"
    MANAGER = "manager"
    PERFORMER = "performer"
    VIEWER = "viewer"


DEFAULT_WORKSPACE_COLOR = "#111827"


class WorkspaceORM(Base):
    __tablename__ = "workspaces"

    id = Column(String, primary_key=True)
    key = Column(String, nullable=False, unique=True)
    name = Column(String, nullable=False)
    color = Column(String, nullable=False, default=DEFAULT_WORKSPACE_COLOR)
    icon = Column(String, nullable=True)
    parent_id = Column(String, ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=True, index=True)
    kind = Column(String, nullable=False, default="tenant")  # tenant | contractor | subcontractor | personal
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    members = relationship(
        "WorkspaceMembershipORM",
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    parent = relationship("WorkspaceORM", remote_side=[id], backref="children")
    invites = relationship(
        "WorkspaceInviteORM",
        back_populates="workspace",
        cascade="all, delete-orphan",
    )


class WorkspaceMembershipORM(Base):
    __tablename__ = "workspace_members"

    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role = Column(String, nullable=False, default="member")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    workspace = relationship("WorkspaceORM", back_populates="members")
    user = relationship("UserORM", back_populates="workspace_memberships")


class WorkspaceInviteORM(Base):
    __tablename__ = "workspace_invites"

    id = Column(String, primary_key=True, default=lambda: generate_id("wsinv"))
    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String, nullable=False)
    role = Column(String, nullable=False, default="member")
    token = Column(String, nullable=False, unique=True)
    status = Column(String, nullable=False, default="pending")
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    accepted_at = Column(DateTime, nullable=True)
    inviter_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    workspace = relationship("WorkspaceORM", back_populates="invites")
    inviter = relationship("UserORM")


class UserORM(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: generate_id("user"))
    email = Column(String, nullable=False, unique=True, index=True)
    full_name = Column(String, nullable=False, default="")
    role = Column(String, nullable=False, default=UserRole.MANAGER.value)
    extra_roles = Column(JSON, nullable=False, default=list)
    password_hash = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    workspace_memberships = relationship(
        "WorkspaceMembershipORM",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    @property
    def roles(self) -> list[str]:  # pragma: no cover - convenience helper
        base = self.role or ""
        extras = self.extra_roles if isinstance(self.extra_roles, list) else []
        result: list[str] = []
        if isinstance(base, str) and base.strip():
            result.append(base.strip())
        if isinstance(extras, list):
            for value in extras:
                if isinstance(value, str):
                    normalized = value.strip()
                    if normalized and normalized not in result:
                        result.append(normalized)
        return result

class LegalEntityORM(Base):
    __tablename__ = "legal_entities"

    id = Column(String, primary_key=True, default=lambda: generate_id("legal"))
    workspace_id = Column(
        String,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String, nullable=False, default="")
    inn = Column(String, nullable=False, default="")
    kpp = Column(String, nullable=False, default="")
    signatory = Column(String, nullable=False, default="")
    basis = Column(String, nullable=False, default="")
    power_of_attorney_number = Column(String, nullable=True)
    power_of_attorney_date = Column(Date, nullable=True)
    status = Column(String, nullable=False, default="incomplete")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    workspace = relationship("WorkspaceORM")
    contracts = relationship("ContractORM", back_populates="client", foreign_keys="ContractORM.client_id")

    @property
    def powerOfAttorneyNumber(self) -> str | None:  # pragma: no cover - accessor for pydantic schema
        value = self.power_of_attorney_number
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value

    @powerOfAttorneyNumber.setter
    def powerOfAttorneyNumber(self, value: str | None) -> None:  # pragma: no cover - accessor for pydantic schema
        if isinstance(value, str):
            normalized = value.strip()
            self.power_of_attorney_number = normalized or None
        else:
            self.power_of_attorney_number = value

    @property
    def powerOfAttorneyDate(self) -> date | None:  # pragma: no cover - accessor for pydantic schema
        return self.power_of_attorney_date

    @powerOfAttorneyDate.setter
    def powerOfAttorneyDate(self, value: date | None) -> None:  # pragma: no cover - accessor for pydantic schema
        self.power_of_attorney_date = value


class IndividualORM(Base):
    __tablename__ = "individuals"

    id = Column(String, primary_key=True, default=lambda: generate_id("individual"))
    workspace_id = Column(
        String,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String, nullable=False, default="")
    inn = Column(String, nullable=False, default="")
    passport = Column(String, nullable=False, default="")
    address = Column(String, nullable=False, default="")
    email = Column(String, nullable=False, default="")
    external_id = Column(String, nullable=True)
    source = Column(String, nullable=False, default="manual")
    status = Column(String, nullable=False, default="incomplete")
    user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    is_approval_manager = Column(Boolean, nullable=False, default=False)
    default_manager_id = Column(String, ForeignKey("individuals.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    workspace = relationship("WorkspaceORM")
    contracts = relationship("ContractORM", back_populates="contractor", foreign_keys="ContractORM.contractor_id")
    project_links = relationship(
        "ProjectPerformerORM",
        back_populates="individual",
        cascade="all, delete-orphan",
    )
    user = relationship("UserORM", foreign_keys=[user_id])
    default_manager = relationship("IndividualORM", remote_side=[id], post_update=True)

    @property
    def userId(self) -> str | None:  # pragma: no cover - convenience for pydantic alias
        return self.user_id

    @userId.setter
    def userId(self, value: str | None) -> None:  # pragma: no cover - convenience for pydantic alias
        self.user_id = value

    @property
    def approvalManagerId(self) -> str | None:  # pragma: no cover - convenience alias
        return self.default_manager_id

    @approvalManagerId.setter
    def approvalManagerId(self, value: str | None) -> None:  # pragma: no cover
        self.default_manager_id = value

    @property
    def isApprovalManager(self) -> bool:  # pragma: no cover - alias for schema
        return bool(self.is_approval_manager)

    @isApprovalManager.setter
    def isApprovalManager(self, value: bool) -> None:  # pragma: no cover
        self.is_approval_manager = bool(value)


class ContractORM(Base):
    __tablename__ = "contracts"

    id = Column(String, primary_key=True, default=lambda: generate_id("contract"))
    workspace_id = Column(
        String,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    number = Column(String, nullable=False, default="")
    client_id = Column(String, ForeignKey("legal_entities.id", ondelete="SET NULL"))
    contractor_id = Column(String, ForeignKey("individuals.id", ondelete="SET NULL"))
    rate = Column(Float, nullable=False, default=0.0)
    rate_type = Column(String, nullable=False, default="hour")
    currency = Column(String, nullable=False, default="RUB")
    status = Column(String, nullable=False, default="incomplete")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    workspace = relationship("WorkspaceORM")
    client = relationship("LegalEntityORM", back_populates="contracts", foreign_keys=[client_id])
    contractor = relationship("IndividualORM", back_populates="contracts", foreign_keys=[contractor_id])
    settings = relationship(
        "ContractSettingsORM",
        back_populates="contract",
        uselist=False,
        cascade="all, delete-orphan",
    )

    @property
    def clientId(self) -> str | None:  # pragma: no cover - accessor for pydantic schema
        return self.client_id

    @clientId.setter
    def clientId(self, value: str | None) -> None:  # pragma: no cover - accessor for pydantic schema
        self.client_id = value

    @property
    def contractorId(self) -> str | None:  # pragma: no cover - accessor for pydantic schema
        return self.contractor_id

    @contractorId.setter
    def contractorId(self, value: str | None) -> None:  # pragma: no cover - accessor for pydantic schema
        self.contractor_id = value


class ContractSettingsORM(Base):
    __tablename__ = "contract_settings"

    contract_id = Column(String, ForeignKey("contracts.id", ondelete="CASCADE"), primary_key=True)
    performer_type = Column(String, nullable=False, default="gph")
    vat_mode = Column(String, nullable=False, default="no_vat")
    include_timesheet = Column(Boolean, nullable=False, default=False)
    timesheet_locked = Column(Boolean, nullable=False, default=False)
    require_npd_receipt = Column(Boolean, nullable=False, default=False)
    act_by_projects = Column(Boolean, nullable=False, default=False)
    norm_hours = Column(Float, nullable=True)
    template_avr_id = Column(String, nullable=True)
    template_ipr_id = Column(String, nullable=True)
    template_invoice_id = Column(String, nullable=True)
    extra = Column(JSON, nullable=True)

    contract = relationship("ContractORM", back_populates="settings", foreign_keys=[contract_id])


class ProjectORM(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=lambda: generate_id("project"))
    workspace_id = Column(
        String,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    connection_id = Column(String, nullable=False)
    connection_url = Column(String, nullable=False, default="")
    key = Column(String, nullable=False)
    name = Column(String, nullable=False, default="")
    tracker = Column(String, nullable=False, default="Jira")
    status = Column(String, nullable=False, default="discovered")
    last_sync = Column(DateTime, nullable=True)
    tasks_count = Column(Float, nullable=False, default=0)

    client_id = Column(String, ForeignKey("legal_entities.id", ondelete="SET NULL"), nullable=True)
    contractor_id = Column(String, ForeignKey("individuals.id", ondelete="SET NULL"), nullable=True)
    contract_id = Column(String, ForeignKey("contracts.id", ondelete="SET NULL"), nullable=True)

    ready_for_docs = Column(String, nullable=False, default="needs_setup")
    readiness_notes = Column(String, nullable=False, default="")

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    workspace = relationship("WorkspaceORM")
    client = relationship("LegalEntityORM", foreign_keys=[client_id])
    contractor = relationship("IndividualORM", foreign_keys=[contractor_id])
    contract = relationship("ContractORM", foreign_keys=[contract_id])
    performers = relationship(
        "ProjectPerformerORM",
        back_populates="project",
        cascade="all, delete-orphan",
    )


class ProjectPerformerORM(Base):
    __tablename__ = "project_performers"

    id = Column(String, primary_key=True, default=lambda: generate_id("prf"))
    workspace_id = Column(
        String,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    individual_id = Column(String, ForeignKey("individuals.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    tracker_account_id = Column(String, nullable=True)

    __table_args__ = (
        UniqueConstraint('project_id', 'individual_id', name='uq_project_performer'),
    )

    project = relationship("ProjectORM", back_populates="performers")
    individual = relationship("IndividualORM", back_populates="project_links")
    workspace = relationship("WorkspaceORM")


class TaskORM(Base):
    __tablename__ = "tasks"

    id = Column(String, primary_key=True)  # Jira issue key (e.g. ECS-5)
    workspace_id = Column(
        String,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    issue_id = Column(String, unique=True, index=True, nullable=False)
    connection_id = Column(String, nullable=False)
    project_key = Column(String, nullable=False)
    project_name = Column(String, nullable=False)
    summary = Column(String, nullable=False, default="")
    status = Column(String, nullable=False, default="To Do")
    hours = Column(Float, nullable=False, default=0.0)
    billable = Column(Boolean, nullable=False, default=False)
    force_included = Column(Boolean, nullable=False, default=False)
    work_package_id = Column(String, ForeignKey("work_packages.id", ondelete="SET NULL"), nullable=True)
    spent_seconds = Column(Float, nullable=False, default=0.0)
    estimate_seconds = Column(Float, nullable=False, default=0.0)
    billed_seconds = Column(Float, nullable=False, default=0.0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    assignee_account_id = Column(String, nullable=True)
    assignee_display_name = Column(String, nullable=True)
    assignee_email = Column(String, nullable=True)
    description = Column(String, nullable=True)

    workspace = relationship("WorkspaceORM")
    work_package = relationship("WorkPackageORM", back_populates="tasks", foreign_keys=[work_package_id])


class WorkPackageORM(Base):
    __tablename__ = "work_packages"

    id = Column(String, primary_key=True, default=lambda: generate_id("wp"))
    workspace_id = Column(
        String,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    period = Column(String, nullable=False)
    project_key = Column(String, nullable=False)
    project_name = Column(String, nullable=False)
    contract_id = Column(String, ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=False)
    client_id = Column(String, ForeignKey("legal_entities.id", ondelete="RESTRICT"), nullable=False)
    contractor_id = Column(String, ForeignKey("individuals.id", ondelete="RESTRICT"), nullable=False)
    total_hours = Column(Float, nullable=False, default=0.0)
    total_amount = Column(Float, nullable=False, default=0.0)
    hourly_rate = Column(Float, nullable=False, default=0.0)
    base_rate = Column(Float, nullable=False, default=0.0)
    rate_type = Column(String, nullable=False, default="hour")
    include_timesheet = Column(Boolean, nullable=False, default=False)
    currency = Column(String, nullable=False, default="RUB")
    performer_type = Column(String, nullable=False, default="individual")
    vat_included = Column(Boolean, nullable=False, default=False)
    vat_percent = Column(Float, nullable=False, default=0.0)
    vat_amount = Column(Float, nullable=False, default=0.0)
    metadata_json = Column(JSON, nullable=False, default=dict)
    task_snapshots = Column(JSON, nullable=False, default=list)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    workspace = relationship("WorkspaceORM")
    tasks = relationship("TaskORM", back_populates="work_package")
    documents = relationship(
        "DocumentRecordORM",
        back_populates="work_package",
        cascade="all, delete-orphan",
    )


class DocumentRecordORM(Base):
    __tablename__ = "document_records"

    id = Column(String, primary_key=True, default=lambda: generate_id("doc"))
    workspace_id = Column(
        String,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    period = Column(String, nullable=False)
    type = Column(String, nullable=False)
    format = Column(String, nullable=False)
    status = Column(String, nullable=False, default="Не согласован")
    include_timesheet = Column(Boolean, nullable=False, default=False)
    files = Column(JSON, nullable=False, default=list)
    work_package_id = Column(String, ForeignKey("work_packages.id", ondelete="CASCADE"), nullable=False)
    project_key = Column(String, nullable=False)
    project_name = Column(String, nullable=False)
    contract_id = Column(String, ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=False)
    client_id = Column(String, ForeignKey("legal_entities.id", ondelete="RESTRICT"), nullable=False)
    contractor_id = Column(String, ForeignKey("individuals.id", ondelete="RESTRICT"), nullable=False)
    total_hours = Column(Float, nullable=False, default=0.0)
    total_amount = Column(Float, nullable=False, default=0.0)
    hourly_rate = Column(Float, nullable=False, default=0.0)
    base_rate = Column(Float, nullable=False, default=0.0)
    rate_type = Column(String, nullable=False, default="hour")
    task_count = Column(Integer, nullable=False, default=0)
    notes = Column(String, nullable=False, default="")
    metadata_json = Column(JSON, nullable=False, default=dict)
    template_id = Column(String, nullable=True)
    performer_type = Column(String, nullable=False, default="individual")
    vat_included = Column(Boolean, nullable=False, default=False)
    vat_percent = Column(Float, nullable=False, default=0.0)
    vat_amount = Column(Float, nullable=False, default=0.0)
    approval_status = Column(String, nullable=False, default="draft")
    submitted_at = Column(DateTime, nullable=True)
    manager_approved_at = Column(DateTime, nullable=True)
    manager_approved_by = Column(String, nullable=True)
    performer_approved_at = Column(DateTime, nullable=True)
    performer_approved_by = Column(String, nullable=True)
    finalized_at = Column(DateTime, nullable=True)
    finalized_by = Column(String, nullable=True)
    approval_notes = Column(JSON, nullable=False, default=list)
    performer_assignee_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    manager_assignee_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    shared_with_parent = Column(Boolean, nullable=False, default=False)
    shared_parent_id = Column(String, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True)
    shared_at = Column(DateTime, nullable=True)
    shared_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    workspace = relationship("WorkspaceORM", foreign_keys=[workspace_id])
    work_package = relationship("WorkPackageORM", back_populates="documents")
    performer_assignee = relationship("UserORM", foreign_keys=[performer_assignee_id])
    manager_assignee = relationship("UserORM", foreign_keys=[manager_assignee_id])
    shared_parent = relationship("WorkspaceORM", foreign_keys=[shared_parent_id])
    shared_by_user = relationship("UserORM", foreign_keys=[shared_by_user_id])


class ImportLogORM(Base):
    __tablename__ = "import_logs"

    id = Column(String, primary_key=True, default=lambda: generate_id("import"))
    workspace_id = Column(
        String,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    connection_id = Column(String, nullable=False)
    project_key = Column(String, nullable=False)
    created_count = Column(Integer, nullable=False, default=0)
    updated_count = Column(Integer, nullable=False, default=0)
    skipped_count = Column(Integer, nullable=False, default=0)
    reason = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    workspace = relationship("WorkspaceORM")


# === New domain entities (v2) ================================================


class CompanyORM(Base):
    """Unified representation of companies / legal entities (unique by INN)."""

    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    inn = Column(String, nullable=False, unique=True, index=True)
    kpp = Column(String, nullable=True)
    is_ip = Column(Boolean, nullable=False, default=False)
    default_vat_mode = Column(String, nullable=False, default="no_vat")
    act_by_projects = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    contracts = relationship("ContractV2ORM", back_populates="company")


class IndividualV2ORM(Base):
    """Performer profiles with legal qualification and tax notes."""

    __tablename__ = "individuals_v2"

    id = Column(Integer, primary_key=True, autoincrement=True)
    full_name = Column(String, nullable=False)
    type = Column(String, nullable=False, default="gph")
    inn = Column(String, nullable=True)
    tax_notes = Column(JSON, nullable=True)
    source = Column(String, nullable=False, default="manual")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    contracts = relationship("ContractV2ORM", back_populates="performer")


class ContractV2ORM(Base):
    """Contracts referencing companies or individuals with VAT/INN binding."""

    __tablename__ = "contracts_v2"
    __table_args__ = (
        UniqueConstraint("party_type", "party_id", "contract_number", name="uq_contract_party_number"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    party_type = Column(String, nullable=False)  # company | individual
    party_id = Column(String, nullable=False)
    performer_id = Column(Integer, ForeignKey("individuals_v2.id", ondelete="SET NULL"), nullable=True)
    contract_number = Column(String, nullable=False)
    contract_date = Column(Date, nullable=False)
    valid_from = Column(Date, nullable=False)
    valid_to = Column(Date, nullable=False)
    vat_mode = Column(String, nullable=False, default="no_vat")
    rate_type = Column(String, nullable=False, default="hour")
    rate_value = Column(Numeric(14, 2), nullable=False, default=0)
    currency = Column(String, nullable=False, default="RUB")
    act_by_projects = Column(Boolean, nullable=False, default=False)
    ip_transfer_mode = Column(String, nullable=False, default="embedded")
    status = Column(String, nullable=False, default="active")
    meta = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    company_id = Column(Integer, ForeignKey("companies.id", ondelete="SET NULL"), nullable=True)

    company = relationship("CompanyORM", back_populates="contracts")
    performer = relationship("IndividualV2ORM", back_populates="contracts")


class AuditLogORM(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    actor_id = Column(String, nullable=True)
    action = Column(String, nullable=False)
    entity = Column(String, nullable=False)
    entity_id = Column(String, nullable=True)
    payload = Column(JSON, nullable=True)
    error_code = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class TechAssignmentORM(Base):
    __tablename__ = "tech_assignments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    number = Column(String, nullable=False)
    order_id = Column(Integer, nullable=True)
    project_id = Column(Integer, nullable=True)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    has_ip = Column(Boolean, nullable=False, default=False)
    deliverables = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    packages = relationship("ClosingPackageORM", back_populates="tech_assignment")


class ClosingPackageORM(Base):
    __tablename__ = "closing_packages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ta_id = Column(Integer, ForeignKey("tech_assignments.id", ondelete="CASCADE"), nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    package_no = Column(String, nullable=False)
    status = Column(String, nullable=False, default="draft")
    source_hash = Column(String, nullable=True, index=True)
    meta = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    tech_assignment = relationship("TechAssignmentORM", back_populates="packages")
    documents = relationship(
        "DocumentV2ORM",
        back_populates="package",
        cascade="all, delete-orphan",
    )


class DocumentV2ORM(Base):
    __tablename__ = "documents_v2"

    id = Column(Integer, primary_key=True, autoincrement=True)
    package_id = Column(Integer, ForeignKey("closing_packages.id", ondelete="CASCADE"), nullable=False)
    ta_id = Column(Integer, ForeignKey("tech_assignments.id", ondelete="CASCADE"), nullable=False)
    pair_id = Column(String, nullable=True)
    doc_type = Column(String, nullable=False)
    template_id = Column(String, nullable=True)
    counterparty_type = Column(String, nullable=True)
    counterparty_id = Column(Integer, nullable=True)
    contract_id = Column(Integer, ForeignKey("contracts_v2.id", ondelete="RESTRICT"), nullable=False)
    performer_id = Column(Integer, ForeignKey("individuals_v2.id", ondelete="SET NULL"), nullable=True)
    project_id = Column(Integer, nullable=True)
    vat_mode = Column(String, nullable=False, default="no_vat")
    currency = Column(String, nullable=False, default="RUB")
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    hours = Column(Numeric(14, 2), nullable=True)
    rate_hour = Column(Numeric(14, 4), nullable=True)
    amount_wo_vat = Column(Numeric(14, 2), nullable=True)
    vat_amount = Column(Numeric(14, 2), nullable=True)
    amount_total = Column(Numeric(14, 2), nullable=True)
    version = Column(Integer, nullable=False, default=1)
    file_path = Column(String, nullable=True)
    meta = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    package = relationship("ClosingPackageORM", back_populates="documents")
    contract = relationship("ContractV2ORM")
    performer = relationship("IndividualV2ORM")
    versions = relationship(
        "DocumentVersionORM",
        back_populates="document",
        cascade="all, delete-orphan",
    )
    timesheet = relationship(
        "TimesheetORM",
        back_populates="document",
        cascade="all, delete-orphan",
        uselist=False,
    )


class DocumentVersionORM(Base):
    __tablename__ = "document_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(Integer, ForeignKey("documents_v2.id", ondelete="CASCADE"), nullable=False)
    version = Column(Integer, nullable=False)
    file_path = Column(String, nullable=True)
    meta = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    document = relationship("DocumentV2ORM", back_populates="versions")


class TimesheetORM(Base):
    __tablename__ = "timesheets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(Integer, ForeignKey("documents_v2.id", ondelete="CASCADE"), nullable=False, unique=True)
    task_table = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    document = relationship("DocumentV2ORM", back_populates="timesheet")
