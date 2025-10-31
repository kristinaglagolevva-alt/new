export type TaskStatus = 'Backlog' | 'To Do' | 'In Progress' | 'In Review' | 'Done';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export type WorkspaceKind = 'tenant' | 'contractor' | 'subcontractor' | 'personal';

export interface WorkspaceSummary {
  id: string;
  key: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  role: WorkspaceRole;
  kind: WorkspaceKind;
  parentId?: string | null;
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  fullName: string;
  role: WorkspaceRole;
  isActive: boolean;
  joinedAt: string;
}

export interface Task {
  id: string;
  key: string;
  projectKey: string;
  projectName: string;
  projectId?: string | null;
  clientId?: string | null;
  contractorId?: string | null;
  contractId?: string | null;
  title: string;
  description?: string | null;
  status: TaskStatus;
  hours: number;
  billable: boolean;
  forceIncluded: boolean;
  workPackageId?: string;
  assigneeAccountId?: string | null;
  assigneeDisplayName?: string | null;
  assigneeEmail?: string | null;
  secondsSpent?: number;
  secondsEstimate?: number;
  billedSeconds?: number;
  updatedAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
}

export interface TaskPeriod {
  value: string;
  label: string;
  start: string;
  end: string;
  tasks: number;
}

export type VatPayerStatus = 'non_payer' | 'payer';

export interface VatSettings {
  status: VatPayerStatus;
  rate: number | null;
  exempt: boolean;
}

export interface LegalEntity {
  id: string;
  name: string;
  inn: string;
  kpp: string;
  signatory: string;
  basis: string;
  powerOfAttorneyNumber?: string | null;
  powerOfAttorneyDate?: string | null;
  status: 'complete' | 'incomplete';
  defaultVatMode?: ContractUiProfile['default_vat_mode'];
  /** Новая структура настроек НДС (используется на фронте). */
  defaultVatSettings?: VatSettings;
  requireInvoice?: boolean;
}

export type PerformerTypeCode = 'employee' | 'gph' | 'selfemployed' | 'ip' | 'company';

export interface Individual {
  id: string;
  name: string;
  inn: string;
  passport: string;
  address: string;
  email: string;
  externalId?: string | null;
  source?: string;
  status: 'complete' | 'incomplete';
  legalType?: PerformerTypeCode;
  taxDocumentStatus?: 'missing' | 'pending' | 'ready';
  userId?: string | null;
  userEmail?: string | null;
  userFullName?: string | null;
  userRole?: string | null;
  userActive?: boolean;
  isApprovalManager?: boolean;
  approvalManagerId?: string | null;
  generatedPassword?: string | null;
}

export interface Contract {
  id: string;
  number: string;
  clientId: string;
  contractorId: string;
  rate: number;
  rateType: 'hour' | 'month';
  currency: 'RUB';
  status: 'complete' | 'incomplete';
  performerType?: PerformerTypeCode;
  contractDate?: string | null;
  /**
   * @deprecated Используйте vatSettings. Свойство оставлено для обратной совместимости с данными бэкенда.
   */
  vatMode?: 'no_vat' | 'vat_0' | 'vat_10' | 'vat_20';
  vatSettings?: VatSettings;
  includeTimesheetByDefault?: boolean;
  timesheetToggleLocked?: boolean;
  requireNpdReceipt?: boolean;
  actByProjects?: boolean;
  normHours?: number | null;
  templateAvrId?: string | null;
  templateIprId?: string | null;
  templateInvoiceId?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  expirationReminderEnabled?: boolean;
  expirationReminderDays?: number | null;
  requireIsDocument?: boolean;
  allowedTemplateIds?: string[] | null;
  continuationOfId?: string | null;
  usageActEnabled?: boolean;
  usageInvoiceEnabled?: boolean;
  usageTaxReportingEnabled?: boolean;
  usageGrantsEnabled?: boolean;
  usageInternalEnabled?: boolean;
}

export type DocumentFileFormat = 'pdf' | 'docx' | 'xlsx';

export type DocumentAudience = 'act' | 'invoice' | 'tax-report' | 'benefit-report' | 'internal';

export interface TaskSnapshot {
  id: string;
  key: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  hours: number;
  billable: boolean;
  forceIncluded: boolean;
  projectKey: string;
  projectName: string;
}

export interface TaskCostSnapshot extends TaskSnapshot {
  hourlyRate: number;
  amount: number;
  categories?: string[];
}

export type FieldRuleMode = 'hidden' | 'readonly' | 'editable';
export type FieldRuleVisibility = 'hidden' | 'optional' | 'required';

export interface FieldRuleConfig {
  mode: FieldRuleMode;
  visibility?: FieldRuleVisibility;
  tooltip?: string | null;
  default?: boolean | null;
}

export interface PerformerRuleConfig {
  docs: string[];
  vatMode: FieldRuleMode;
  rate: FieldRuleConfig;
  normHours: FieldRuleConfig;
  timesheet: FieldRuleConfig;
  extraFlags: Record<string, boolean>;
}

export interface WorkPackageMetadata {
  preparedFor: DocumentAudience[];
  tags: string[];
  taxCategory?: string;
  benefitCategory?: string;
  currency: 'RUB';
  adjustments?: Array<{
    type: 'manual' | 'discount' | 'tax' | 'correction';
    description: string;
    amount: number;
  }>;
}

export interface WorkPackage {
  id: string;
  createdAt: string;
  period: string;
  projectKey: string;
  projectName: string;
  contractId: string;
  clientId: string;
  contractorId: string;
  totalHours: number;
  totalAmount: number;
  hourlyRate: number;
  baseRate: number;
  rateType: 'hour' | 'month';
  includeTimesheet: boolean;
  currency: 'RUB';
  performerType: string;
  vatIncluded: boolean;
  vatPercent: number;
  vatAmount: number;
  taskSnapshots: TaskCostSnapshot[];
  metadata: WorkPackageMetadata;
  performerId?: string | null;
}

export interface DocumentFile {
  id: string;
  label: string;
  type: 'act' | 'invoice' | 'timesheet' | 'package' | 'custom';
  format: DocumentFileFormat;
  status: string;
  url?: string | null;
}

export interface DocumentAssignee {
  id: string;
  email: string;
  fullName: string;
}

export interface DocumentRecord {
  id: string;
  createdAt: string;
  period: string;
  type: 'act' | 'invoice' | 'package' | 'timesheet' | 'custom';
  workspaceId: string;
  workspaceName?: string | null;
  clientId: string;
  contractorId: string;
  contractId: string;
  projectKey: string;
  projectName: string;
  tasksCount: number;
  totalHours: number;
  amount: number;
  hourlyRate: number;
  baseRate: number;
  rateType: 'hour' | 'month';
  status: string;
  includeTimesheet: boolean;
  files: DocumentFile[];
  taskSnapshots: TaskCostSnapshot[];
  workPackageId: string;
  notes?: string | null;
  templateId?: string | null;
  performerType: string | null;
  vatIncluded: boolean;
  vatPercent: number;
  vatAmount: number;
  metadata?: WorkPackageMetadata;
  approvalStatus: 'draft' | 'pending_performer' | 'pending_manager' | 'rejected_performer' | 'rejected_manager' | 'manager_approved' | 'final';
  submittedAt?: string | null;
  managerApprovedAt?: string | null;
  managerApprovedBy?: string | null;
  performerApprovedAt?: string | null;
  performerApprovedBy?: string | null;
  finalizedAt?: string | null;
  finalizedBy?: string | null;
  approvalNotes: Array<{
    timestamp: string;
    author: string;
    role: string;
    status: string;
    message: string;
  }>;
  performerAssignee?: DocumentAssignee | null;
  managerAssignee?: DocumentAssignee | null;
  sharedWithParent: boolean;
  sharedParentId?: string | null;
  sharedAt?: string | null;
  sharedByUserId?: string | null;
}

export type DocumentApprovalAction =
  | 'submit'
  | 'performer_approve'
  | 'performer_reject'
  | 'manager_approve'
  | 'manager_reject'
  | 'finalize';

export interface DocumentCreationPayload {
  taskIds: string[];
  contractId: string;
  period: string;
  documentType: DocumentRecord['type'];
  includeTimesheet: boolean;
  format: DocumentFileFormat;
  hourlyRate: number;
  baseRate: number;
  rateType: 'hour' | 'month';
  workPackageId?: string;
  audience?: WorkPackageMetadata['preparedFor'];
  templateId?: string | null;
  performerType?: string;
  vatIncluded?: boolean;
  vatPercent?: number;
  normHours?: number;
  variables?: Record<string, string>;
  tags?: string[];
  taxCategory?: string | null;
  benefitCategory?: string | null;
}

export interface PackageTaskInput {
  jira_id: string;
  assignee_id?: number | null;
  hours: number;
  project_id?: number | null;
  status?: string | null;
  contract_id?: number | null;
  company_inn?: string | null;
  performer_type?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface PackageOptions {
  include_timesheets: boolean;
  include_timesheets_by_group?: Record<string, boolean>;
  norm_hours?: number;
  include_by_projects: 'auto' | 'force' | 'off';
  autopick_contract: boolean;
  allow_selfemployed_without_receipt: boolean;
  respect_period_range?: boolean;
  gpt?: {
    enabled: boolean;
    language: 'ru' | 'en';
    style: 'neutral' | 'formal' | 'concise' | 'detailed';
    extraNotes?: string | null;
  };
  template_id?: string | null;
  template_variables?: Record<string, unknown> | null;
  templates?: Record<string, string>;
  templates_by_group?: Record<string, Record<string, string | null>>;
  vat_modes_by_group?: Record<string, ContractUiProfile['default_vat_mode']>;
  rates_by_group?: Record<string, number>;
  doc_types_by_group?: Record<string, string[]>;
}

export interface PackageCreateRequest {
  ta_id?: number | null;
  period_start: string;
  period_end: string;
  tasks: PackageTaskInput[];
  options: PackageOptions;
}

export interface PackageWarning {
  type: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PackagePreviewDocument {
  doc_type: string;
  counterparty: string;
  contract_id: number;
  amount_total: number;
  vat_mode: 'no_vat' | 'vat_0' | 'vat_10' | 'vat_20';
  group_info: Record<string, unknown>;
}

export interface PackageGeneratedDocument {
  id: number;
  doc_type: string;
  contract_id: number;
  performer_id?: number | null;
  file_path?: string | null;
  file_url?: string | null;
}

export interface PackageCreateResponse {
  package_id: number;
  will_create: PackagePreviewDocument[];
  warnings: PackageWarning[];
  documents: PackageGeneratedDocument[];
}

/**
 * Настройки интерфейса мастера документов, которые бэкенд подбирает под контракт.
 */
export interface ContractUiProfile {
  contract_id: number;
  performer_type: string;
  available_documents: string[];
  default_documents: string[];
  hidden_sections: string[];
  required_fields: string[];
  show_vat_selector: boolean;
  vat_modes: Array<'no_vat' | 'vat_0' | 'vat_10' | 'vat_20'>;
  default_vat_mode: 'no_vat' | 'vat_0' | 'vat_10' | 'vat_20';
  include_timesheet_by_default: boolean;
  timesheet_toggle_locked: boolean;
  helper_texts: Record<string, string>;
  document_rules: Record<string, PerformerRuleConfig>;
  current_rules?: PerformerRuleConfig | null;
  rate_edit_rule?: string | null;
  grouping_rules?: Record<string, unknown>;
  valid_from?: string | null;
  valid_to?: string | null;
  expiration_reminder_enabled?: boolean;
  expiration_reminder_days?: number | null;
  contract_status?: 'active' | 'expiring' | 'expired';
}

export interface Template {
  id: string;
  name: string;
  type: 'act' | 'invoice' | 'timesheet' | 'custom';
  updatedAt: string;
  createdAt?: string;
  content: string;
  category?: string | null;
  description?: string | null;
}

export type DocumentTemplate = Template;

export type TrackerProjectStatus = 'discovered' | 'syncing' | 'connected' | 'error';

export interface TrackerProject {
  id: string;
  connectionId: string;
  key: string;
  name: string;
  tracker: string;
  status: TrackerProjectStatus;
  lastSync: string | null;
  tasksCount: number;
  connection: string;
  clientId?: string | null;
  contractorId?: string | null;
  contractId?: string | null;
  performerIds?: string[];
  readyForDocs?: string;
  readinessNotes?: string | null;
}

export type UserRole = 'admin' | 'accountant' | 'manager' | 'performer' | 'viewer';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  roles: UserRole[];
  isActive: boolean;
  workspaces: WorkspaceSummary[];
}

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  reason?: string | null;
}

export interface ImportLog extends ImportSummary {
  id: string;
  connectionId: string;
  projectKey: string;
  createdAt: string;
}
