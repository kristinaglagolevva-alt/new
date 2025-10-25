from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Optional, List, Literal, Any, Dict

from pydantic import BaseModel, EmailStr, Field, root_validator, validator

from .models import TemplateModel, TemplatePayload  # re-export existing pydantic templates


class LegalEntityBase(BaseModel):
    name: str = ""
    inn: str = ""
    kpp: str = ""
    signatory: str = ""
    basis: str = ""
    powerOfAttorneyNumber: Optional[str] = Field(default=None, alias="powerOfAttorneyNumber")
    powerOfAttorneyDate: Optional[date] = Field(default=None, alias="powerOfAttorneyDate")
    defaultVatMode: str = Field(default="no_vat", alias="defaultVatMode")
    requireInvoice: bool = Field(default=False, alias="requireInvoice")

    @validator('name', 'inn', 'kpp', 'signatory', 'basis', pre=True)
    def _strip_strings(cls, value: Any) -> Any:  # noqa: D417
        if isinstance(value, str):
            return value.strip()
        return value

    @validator('powerOfAttorneyNumber', pre=True)
    def _normalize_power_number(cls, value: Any) -> Optional[str]:  # noqa: D417
        if value is None:
            return None
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return str(value)

    @validator('powerOfAttorneyDate', pre=True)
    def _normalize_power_date(cls, value: Any) -> Optional[date]:  # noqa: D417
        if value in (None, "", "null"):
            return None
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @root_validator
    def _validate_power_of_attorney(cls, values: Dict[str, Any]) -> Dict[str, Any]:  # noqa: D417
        basis = (values.get('basis') or '').strip().lower()
        number = values.get('powerOfAttorneyNumber')
        power_date = values.get('powerOfAttorneyDate')
        if 'довер' in basis:
            if not number:
                raise ValueError('Для доверенности необходимо указать номер')
            if not power_date:
                raise ValueError('Для доверенности необходимо указать дату')
        else:
            values['powerOfAttorneyNumber'] = None
            values['powerOfAttorneyDate'] = None
        return values


class LegalEntityCreate(LegalEntityBase):
    id: Optional[str] = None


class LegalEntityUpdate(LegalEntityBase):
    pass


class LegalEntity(LegalEntityBase):
    id: str
    status: str

    class Config:
        orm_mode = True
        allow_population_by_field_name = True


class VatSettings(BaseModel):
    status: Literal["non_payer", "payer"] = "non_payer"
    rate: Optional[float] = None
    exempt: bool = False

    @validator("rate", pre=True)
    def _coerce_rate(cls, value: Any) -> Optional[float]:  # noqa: D401 - simple coercion
        if value is None or value == "":
            return None
        try:
            numeric = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("rate must be a number") from exc
        if numeric < 0:
            numeric = 0.0
        return float(round(numeric, 6))

    @root_validator
    def _normalize(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        status = values.get("status")
        if status != "payer":
            values["status"] = "non_payer"
            values["rate"] = None
            values["exempt"] = False
            return values

        if values.get("exempt"):
            values["exempt"] = True
            values["rate"] = 0.0
        else:
            values["exempt"] = False
            if values.get("rate") is None:
                values["rate"] = None
        return values

    class Config:
        allow_population_by_field_name = True


class IndividualBase(BaseModel):
    name: str = ""
    inn: str = ""
    passport: str = ""
    address: str = ""
    email: str = ""
    externalId: Optional[str] = Field(default=None, alias="externalId")
    source: str = "manual"
    legalType: Optional[str] = Field(default=None, alias="legalType")
    taxDocumentStatus: Optional[str] = Field(default="missing", alias="taxDocumentStatus")
    userId: Optional[str] = Field(default=None, alias="userId")
    isApprovalManager: bool = Field(default=False, alias="isApprovalManager")
    approvalManagerId: Optional[str] = Field(default=None, alias="approvalManagerId")


class IndividualCreate(IndividualBase):
    id: Optional[str] = None


class IndividualUpdate(IndividualBase):
    pass


class Individual(IndividualBase):
    id: str
    status: str
    userEmail: Optional[EmailStr] = Field(default=None, alias="userEmail")
    userFullName: Optional[str] = Field(default=None, alias="userFullName")
    userRole: Optional[str] = Field(default=None, alias="userRole")
    userActive: Optional[bool] = Field(default=None, alias="userActive")
    generatedPassword: Optional[str] = Field(default=None, alias="generatedPassword")

    class Config:
        orm_mode = True
        allow_population_by_field_name = True


class ContractBase(BaseModel):
    number: str = ""
    clientId: Optional[str] = Field(default=None, alias="clientId")
    contractorId: Optional[str] = Field(default=None, alias="contractorId")
    rate: float = 0.0
    rateType: str = Field(default="hour", alias="rateType")
    currency: str = "RUB"
    performerType: Optional[str] = Field(default=None, alias="performerType")
    vatMode: Optional[str] = Field(default=None, alias="vatMode")
    includeTimesheetByDefault: Optional[bool] = Field(default=None, alias="includeTimesheetByDefault")
    timesheetToggleLocked: Optional[bool] = Field(default=None, alias="timesheetToggleLocked")
    requireNpdReceipt: Optional[bool] = Field(default=None, alias="requireNpdReceipt")
    actByProjects: Optional[bool] = Field(default=None, alias="actByProjects")
    normHours: Optional[float] = Field(default=None, alias="normHours")
    templateAvrId: Optional[str] = Field(default=None, alias="templateAvrId")
    templateIprId: Optional[str] = Field(default=None, alias="templateIprId")
    templateInvoiceId: Optional[str] = Field(default=None, alias="templateInvoiceId")
    validFrom: Optional[date] = Field(default=None, alias="validFrom")
    validTo: Optional[date] = Field(default=None, alias="validTo")
    expirationReminderEnabled: Optional[bool] = Field(default=None, alias="expirationReminderEnabled")
    expirationReminderDays: Optional[int] = Field(default=None, alias="expirationReminderDays")
    requireIsDocument: Optional[bool] = Field(default=None, alias="requireIsDocument")
    allowedTemplateIds: Optional[List[str]] = Field(default=None, alias="allowedTemplateIds")
    vatSettings: Optional[VatSettings] = Field(default=None, alias="vatSettings")


class ContractCreate(ContractBase):
    id: Optional[str] = None


class ContractUpdate(ContractBase):
    pass


class Contract(ContractBase):
    id: str
    status: str

    class Config:
        orm_mode = True
        allow_population_by_field_name = True


class VATMode(str, Enum):
    NO_VAT = "no_vat"
    VAT_0 = "vat_0"
    VAT_10 = "vat_10"
    VAT_20 = "vat_20"


class PartyType(str, Enum):
    COMPANY = "company"
    INDIVIDUAL = "individual"


class RateType(str, Enum):
    HOUR = "hour"
    MONTH = "month"


class IPTransferMode(str, Enum):
    EMBEDDED = "embedded"
    SEPARATE = "separate"
    NONE = "none"


class ContractStatus(str, Enum):
    ACTIVE = "active"
    EXPIRED = "expired"
    DRAFT = "draft"


class CompanyBase(BaseModel):
    name: str
    inn: str
    kpp: Optional[str] = None
    is_ip: bool = False
    default_vat_mode: VATMode = VATMode.NO_VAT
    act_by_projects: bool = False


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(CompanyBase):
    pass


class Company(CompanyBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True


class CompanyLookupResponse(BaseModel):
    company: Optional[Company] = None
    suggests: List[Company] = Field(default_factory=list)


class ContractV2Base(BaseModel):
    party_type: PartyType
    party_id: str
    performer_id: Optional[int] = None
    contract_number: str
    contract_date: date
    valid_from: date
    valid_to: date
    vat_mode: VATMode = VATMode.NO_VAT
    rate_type: RateType = RateType.HOUR
    rate_value: float
    currency: str = "RUB"
    act_by_projects: bool = False
    ip_transfer_mode: IPTransferMode = IPTransferMode.EMBEDDED
    meta: Optional[dict[str, Any]] = None


class ContractV2Create(ContractV2Base):
    pass


class ContractV2Update(ContractV2Base):
    status: ContractStatus = ContractStatus.ACTIVE


class ContractV2(ContractV2Base):
    id: int
    status: ContractStatus
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True


class ContractPreview(BaseModel):
    id: int
    contract_number: str
    vat_mode: VATMode
    rate_type: RateType
    rate_value: float
    currency: str
    act_by_projects: bool
    ip_transfer_mode: IPTransferMode
    status: ContractStatus


class AuditLogEntry(BaseModel):
    id: int
    actor_id: Optional[str]
    action: str
    entity: str
    entity_id: Optional[str]
    payload: Optional[dict[str, Any]]
    error_code: Optional[str]
    created_at: datetime

    class Config:
        orm_mode = True


class GptOptions(BaseModel):
    enabled: bool = False
    language: Literal["ru", "en"] = "ru"
    style: Literal["neutral", "formal", "concise", "detailed"] = "neutral"
    extraNotes: Optional[str] = None


class PackageTaskInput(BaseModel):
    jira_id: str = Field(..., alias="jira_id")
    assignee_id: Optional[int] = None
    hours: float
    project_id: Optional[int] = None
    status: Optional[str] = None
    contract_id: Optional[int] = None
    company_inn: Optional[str] = None
    performer_type: Optional[str] = None
    meta: Optional[dict[str, Any]] = None


class PackageOptions(BaseModel):
    include_timesheets: bool = False
    norm_hours: Optional[float] = None
    include_by_projects: Literal["auto", "force", "off"] = "auto"
    autopick_contract: bool = True
    allow_selfemployed_without_receipt: bool = False
    gpt: Optional[GptOptions] = None
    template_id: Optional[str] = None
    template_variables: Optional[Dict[str, Any]] = None
    templates: Dict[str, str] = Field(default_factory=dict)


class PackageWarning(BaseModel):
    type: str
    message: str
    details: Optional[dict[str, Any]] = None


class PackagePreviewDocument(BaseModel):
    doc_type: str
    counterparty: str
    contract_id: int
    amount_total: float
    vat_mode: VATMode
    group_info: dict[str, Any]


class PackageGeneratedDocument(BaseModel):
    id: int
    doc_type: str
    contract_id: int
    performer_id: Optional[int]
    file_path: Optional[str]
    file_url: Optional[str]


class PackageCreateRequest(BaseModel):
    ta_id: Optional[int] = None
    period_start: date
    period_end: date
    tasks: List[PackageTaskInput]
    options: PackageOptions = Field(default_factory=PackageOptions)


class PackageCreateResponse(BaseModel):
    package_id: int
    will_create: List[PackagePreviewDocument]
    warnings: List[PackageWarning] = Field(default_factory=list)
    documents: List[PackageGeneratedDocument] = Field(default_factory=list)


class FieldRuleConfig(BaseModel):
    mode: Literal["hidden", "readonly", "editable"] = "hidden"
    visibility: Literal["hidden", "optional", "required"] = "optional"
    tooltip: Optional[str] = None
    default: Optional[bool] = None


class PerformerRuleConfig(BaseModel):
    docs: List[str] = Field(default_factory=list)
    vatMode: Literal["hidden", "readonly", "editable"] = "hidden"
    rate: FieldRuleConfig = Field(default_factory=FieldRuleConfig)
    normHours: FieldRuleConfig = Field(default_factory=FieldRuleConfig)
    timesheet: FieldRuleConfig = Field(default_factory=FieldRuleConfig)
    extraFlags: dict[str, bool] = Field(default_factory=dict)


class ContractUiProfile(BaseModel):
    contract_id: int
    performer_type: str
    available_documents: List[str]
    default_documents: List[str]
    hidden_sections: List[str] = Field(default_factory=list)
    required_fields: List[str] = Field(default_factory=list)
    show_vat_selector: bool = False
    vat_modes: List[VATMode] = Field(default_factory=list)
    default_vat_mode: VATMode = VATMode.NO_VAT
    include_timesheet_by_default: bool = False
    timesheet_toggle_locked: bool = False
    helper_texts: dict[str, str] = Field(default_factory=dict)
    document_rules: dict[str, PerformerRuleConfig] = Field(default_factory=dict)
    current_rules: PerformerRuleConfig | None = None
    rate_edit_rule: str | None = None
    grouping_rules: dict[str, Any] = Field(default_factory=dict)


__all__ = [
    "TemplateModel",
    "TemplatePayload",
    "LegalEntity",
    "LegalEntityCreate",
    "LegalEntityUpdate",
    "Individual",
    "IndividualCreate",
    "IndividualUpdate",
    "Contract",
    "ContractCreate",
    "ContractUpdate",
    "ImportLog",
    "Task",
    "TaskUpdate",
    "TaskPeriod",
    "TaskSnapshot",
    "TaskCostSnapshot",
    "WorkPackageMetadata",
    "WorkPackage",
    "DocumentFile",
    "DocumentRecord",
    "DocumentCreateRequest",
    "DocumentCreateResponse",
    "DocumentApprovalAction",
    "DocumentApprovalRequest",
    "DocumentApprovalNote",
    "DocumentNoteRequest",
    "UserRole",
    "UserBase",
    "UserCreate",
    "UserPublic",
    "TokenResponse",
    "LoginRequest",
    "GptOptions",
    "Company",
    "CompanyCreate",
    "CompanyUpdate",
    "CompanyLookupResponse",
    "ContractV2",
    "ContractV2Create",
    "ContractV2Update",
    "ContractPreview",
    "AuditLogEntry",
    "PackageTaskInput",
    "PackageOptions",
    "PackageWarning",
    "PackagePreviewDocument",
    "PackageCreateRequest",
    "PackageCreateResponse",
    "ContractUiProfile",
]


class ProjectBase(BaseModel):
    connectionId: str
    connection: Optional[str] = None
    key: str
    name: str
    tracker: str = "Jira"
    status: str = "discovered"
    tasksCount: float = 0
    lastSync: Optional[str] = None
    clientId: Optional[str] = None
    contractorId: Optional[str] = None
    contractId: Optional[str] = None
    readinessNotes: Optional[str] = None
    performerIds: list[str] = Field(default_factory=list)


class ProjectCreate(ProjectBase):
    id: Optional[str] = None


class ProjectUpdate(BaseModel):
    clientId: Optional[str] = None
    contractorId: Optional[str] = None
    contractId: Optional[str] = None
    performerIds: Optional[list[str]] = None


class Project(ProjectBase):
    id: str
    readyForDocs: str

    class Config:
        orm_mode = True
        allow_population_by_field_name = True


class ImportSummary(BaseModel):
    created: int
    updated: int
    skipped: int
    reason: Optional[str] = None


class ImportLog(BaseModel):
    id: str
    connectionId: str
    projectKey: str
    created: int
    updated: int
    skipped: int
    reason: Optional[str] = None
    createdAt: datetime

    class Config:
        orm_mode = True
        allow_population_by_field_name = True


class Task(BaseModel):
    id: str
    key: str
    projectKey: str
    projectName: str
    projectId: Optional[str] = Field(default=None, alias="projectId")
    clientId: Optional[str] = Field(default=None, alias="clientId")
    contractorId: Optional[str] = Field(default=None, alias="contractorId")
    contractId: Optional[str] = Field(default=None, alias="contractId")
    title: str
    description: Optional[str] = None
    status: str
    hours: float
    billable: bool
    forceIncluded: bool
    workPackageId: Optional[str] = None
    assigneeAccountId: Optional[str] = None
    assigneeDisplayName: Optional[str] = None
    assigneeEmail: Optional[str] = None
    secondsSpent: float
    secondsEstimate: float
    billedSeconds: float = 0
    updatedAt: Optional[datetime] = None

    class Config:
        orm_mode = True
        allow_population_by_field_name = True


class TaskUpdate(BaseModel):
    forceIncluded: Optional[bool] = None


class TaskPeriod(BaseModel):
    value: str
    label: str
    start: date
    end: date
    tasks: int


class TaskSnapshot(BaseModel):
    id: str
    key: str
    title: str
    status: str
    hours: float
    billable: bool
    forceIncluded: bool
    projectKey: str
    projectName: str
    description: Optional[str] = None

    class Config:
        orm_mode = True
        allow_population_by_field_name = True


class TaskCostSnapshot(TaskSnapshot):
    hourlyRate: float
    amount: float
    categories: list[str] | None = None


class WorkPackageMetadata(BaseModel):
    preparedFor: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    taxCategory: str | None = None
    benefitCategory: str | None = None
    currency: str = "RUB"
    adjustments: list[dict] | None = None


class WorkPackage(BaseModel):
    id: str
    createdAt: datetime
    period: str
    projectKey: str
    projectName: str
    contractId: str
    clientId: str
    contractorId: str
    totalHours: float
    totalAmount: float
    hourlyRate: float
    baseRate: float
    rateType: str
    includeTimesheet: bool
    currency: str
    performerType: str
    vatIncluded: bool
    vatPercent: float
    vatAmount: float
    taskSnapshots: list[TaskCostSnapshot]
    metadata: WorkPackageMetadata
    performerId: str | None = None

    class Config:
        orm_mode = True
        allow_population_by_field_name = True


class DocumentFile(BaseModel):
    id: str
    label: str
    type: str
    format: str
    status: str
    url: str | None = None


class DocumentApprovalNote(BaseModel):
    timestamp: datetime
    author: str
    role: str
    status: str
    message: str


class DocumentNoteRequest(BaseModel):
    message: str


class DocumentAssignee(BaseModel):
    id: str
    email: str
    fullName: str = Field(alias="full_name")

    class Config:
        allow_population_by_field_name = True


class DocumentRecord(BaseModel):
    id: str
    createdAt: datetime
    period: str
    type: str
    workspaceId: str = Field(alias="workspace_id")
    workspaceName: str | None = Field(default=None, alias="workspace_name")
    clientId: str
    contractorId: str
    contractId: str
    projectKey: str
    projectName: str
    tasksCount: int
    totalHours: float
    amount: float
    hourlyRate: float
    baseRate: float
    rateType: str
    status: str
    includeTimesheet: bool
    files: list[DocumentFile]
    taskSnapshots: list[TaskCostSnapshot]
    workPackageId: str
    notes: str | None = None
    templateId: str | None = None
    performerType: str
    vatIncluded: bool
    vatPercent: float
    vatAmount: float
    metadata: WorkPackageMetadata
    approvalStatus: str = Field(alias="approval_status")
    submittedAt: datetime | None = Field(default=None, alias="submitted_at")
    managerApprovedAt: datetime | None = Field(default=None, alias="manager_approved_at")
    managerApprovedBy: str | None = Field(default=None, alias="manager_approved_by")
    performerApprovedAt: datetime | None = Field(default=None, alias="performer_approved_at")
    performerApprovedBy: str | None = Field(default=None, alias="performer_approved_by")
    finalizedAt: datetime | None = Field(default=None, alias="finalized_at")
    finalizedBy: str | None = Field(default=None, alias="finalized_by")
    approvalNotes: list[DocumentApprovalNote] = Field(default_factory=list, alias="approval_notes")
    performerAssignee: DocumentAssignee | None = Field(default=None, alias="performer_assignee")
    managerAssignee: DocumentAssignee | None = Field(default=None, alias="manager_assignee")
    sharedWithParent: bool = Field(default=False, alias="shared_with_parent")
    sharedParentId: str | None = Field(default=None, alias="shared_parent_id")
    sharedAt: datetime | None = Field(default=None, alias="shared_at")
    sharedByUserId: str | None = Field(default=None, alias="shared_by_user_id")

    class Config:
        orm_mode = True
        allow_population_by_field_name = True


class DocumentCreateRequest(BaseModel):
    taskIds: list[str]
    contractId: str
    period: str
    documentType: str
    includeTimesheet: bool
    format: str
    hourlyRate: float
    baseRate: float
    rateType: str
    workPackageId: str | None = None
    audience: list[str] | None = None
    normHours: float | None = None
    templateId: str | None = None
    performerType: str | None = None
    vatIncluded: bool | None = None
    vatPercent: float | None = None
    tags: list[str] | None = None
    taxCategory: str | None = None
    benefitCategory: str | None = None
    variables: dict[str, str] | None = None
    gptOptions: Optional[GptOptions] = None


class DocumentCreateResponse(BaseModel):
    record: DocumentRecord
    workPackage: WorkPackage


class DocumentApprovalAction(str, Enum):
    submit = "submit"
    manager_approve = "manager_approve"
    performer_approve = "performer_approve"
    finalize = "finalize"
    performer_reject = "performer_reject"
    manager_reject = "manager_reject"


class DocumentApprovalRequest(BaseModel):
    action: DocumentApprovalAction
    note: Optional[str] = None


class DocumentAssigneeUpdate(BaseModel):
    performerId: Optional[str] = Field(default=None, alias="performer_id")
    managerId: Optional[str] = Field(default=None, alias="manager_id")


class UserRole(str, Enum):
    admin = "admin"
    accountant = "accountant"
    manager = "manager"
    performer = "performer"
    viewer = "viewer"


class WorkspaceRole(str, Enum):
    owner = "owner"
    admin = "admin"
    member = "member"
    viewer = "viewer"


class WorkspaceKind(str, Enum):
    tenant = "tenant"
    contractor = "contractor"
    subcontractor = "subcontractor"
    personal = "personal"


class WorkspaceSummary(BaseModel):
    id: str
    key: str
    name: str
    color: Optional[str] = None
    icon: Optional[str] = None
    role: WorkspaceRole
    kind: WorkspaceKind = WorkspaceKind.tenant
    parentId: Optional[str] = Field(default=None, alias="parent_id")


class WorkspaceCreateRequest(BaseModel):
    name: str
    key: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    kind: WorkspaceKind = WorkspaceKind.contractor
    parentId: Optional[str] = Field(default=None, alias="parent_id")

    class Config:
        allow_population_by_field_name = True


class WorkspaceUpdateRequest(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None

    class Config:
        allow_population_by_field_name = True


class WorkspaceMember(BaseModel):
    userId: str = Field(alias="user_id")
    email: EmailStr
    fullName: str = Field(alias="full_name")
    role: WorkspaceRole
    isActive: bool = Field(alias="is_active")
    joinedAt: datetime = Field(alias="joined_at")

    class Config:
        allow_population_by_field_name = True


class WorkspaceInviteStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"
    expired = "expired"
    cancelled = "cancelled"


class WorkspaceInvite(BaseModel):
    id: str
    email: EmailStr
    role: WorkspaceRole
    status: WorkspaceInviteStatus
    createdAt: datetime = Field(alias="created_at")
    expiresAt: Optional[datetime] = Field(default=None, alias="expires_at")
    acceptedAt: Optional[datetime] = Field(default=None, alias="accepted_at")
    inviterId: Optional[str] = Field(default=None, alias="inviter_id")
    token: Optional[str] = None

    class Config:
        allow_population_by_field_name = True


class WorkspaceInviteCreateRequest(BaseModel):
    email: EmailStr
    role: WorkspaceRole = WorkspaceRole.member


class WorkspaceMemberUpdateRequest(BaseModel):
    role: WorkspaceRole


class UserWorkspaceProvisioning(BaseModel):
    mode: Literal["new", "existing"] = "new"
    workspaceId: Optional[str] = Field(default=None, alias="workspace_id")
    name: Optional[str] = None
    kind: WorkspaceKind = WorkspaceKind.tenant
    parentId: Optional[str] = Field(default=None, alias="parent_id")

    class Config:
        allow_population_by_field_name = True


class WorkspaceClaimResponse(BaseModel):
    workspaceId: str = Field(alias="workspace_id")
    updated: dict[str, int] = Field(default_factory=dict)

    class Config:
        allow_population_by_field_name = True


class UserBase(BaseModel):
    email: str
    fullName: str = Field(alias="full_name")
    role: UserRole

    class Config:
        allow_population_by_field_name = True


class UserCreate(BaseModel):
    email: str
    password: str
    fullName: Optional[str] = None
    role: UserRole = UserRole.manager
    workspace: Optional[UserWorkspaceProvisioning] = None

    class Config:
        allow_population_by_field_name = True


class UserPublic(UserBase):
    id: str
    isActive: bool = Field(alias="is_active")
    roles: list[UserRole] = Field(default_factory=list)
    workspaces: list[WorkspaceSummary] = Field(default_factory=list)

    class Config(UserBase.Config):
        orm_mode = True


class UserRolesUpdate(BaseModel):
    roles: list[UserRole]


class WorkspaceUserCreateRequest(BaseModel):
    email: EmailStr
    fullName: Optional[str] = None
    role: UserRole = UserRole.manager
    password: Optional[str] = None
    generatePassword: bool = True

    class Config:
        allow_population_by_field_name = True

class TokenResponse(BaseModel):
    accessToken: str
    tokenType: str = "bearer"
    user: UserPublic


class LoginRequest(BaseModel):
    email: str
    password: str
