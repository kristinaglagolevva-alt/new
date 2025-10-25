import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type {
  Contract,
  DocumentCreationPayload,
  DocumentRecord,
  DocumentFileFormat,
  DocumentAudience,
  Individual,
  LegalEntity,
  Task,
  TaskSnapshot,
  TaskCostSnapshot,
  TaskPeriod,
  WorkPackage,
  WorkPackageMetadata,
  Template,
  TrackerProject,
  ImportSummary,
  ImportLog,
  ContractUiProfile,
  PackageCreateRequest,
  PackageCreateResponse,
  VatSettings,
  User,
  UserRole,
  DocumentApprovalAction,
  WorkspaceSummary,
  WorkspaceKind,
  WorkspaceRole,
} from './models';
import {
  initialContracts,
  initialIndividuals,
  initialLegalEntities,
  initialTemplates,
} from './mock-data';
import { useAuth } from './AuthContext';
import { useWorkspace } from './WorkspaceContext';

interface DatabaseState {
  tasks: Task[];
  taskPeriods: TaskPeriod[];
  legalEntities: LegalEntity[];
  individuals: Individual[];
  contracts: Contract[];
  documents: DocumentRecord[];
  workPackages: WorkPackage[];
  templates: Template[];
  trackerProjects: TrackerProject[];
  users: User[];
}

type TaskFilters = {
  projectKey?: string | null;
  statuses?: string[];
  period?: string | null;
  billableOnly?: boolean;
};

type LoadTasksOptions = {
  acknowledge?: boolean;
  newCountOverride?: number;
};

type NormalizedTaskFilters = {
  projectKey: string | null;
  statuses: string[];
  period: string | null;
  billableOnly: boolean;
};

const defaultTaskFilters: NormalizedTaskFilters = {
  projectKey: null,
  statuses: [],
  period: null,
  billableOnly: false,
};

const DEFAULT_VAT_SETTINGS: VatSettings = {
  status: 'non_payer',
  rate: null,
  exempt: false,
};

const sanitizeVatRate = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const normalized = Math.max(0, numeric);
  return Number(normalized.toFixed(2));
};

const cloneVatSettings = (settings: VatSettings | undefined | null): VatSettings => {
  if (!settings) {
    return { ...DEFAULT_VAT_SETTINGS };
  }
  return {
    status: settings.status === 'payer' ? 'payer' : 'non_payer',
    exempt: Boolean(settings.exempt),
    rate: settings.status === 'payer' ? sanitizeVatRate(settings.rate) : null,
  };
};

const legacyVatModeToSettings = (
  mode?: Contract['vatMode'] | ContractUiProfile['default_vat_mode'],
  fallback?: VatSettings,
): VatSettings => {
  switch (mode) {
    case 'vat_0':
      return { status: 'payer', rate: 0, exempt: false };
    case 'vat_10':
      return { status: 'payer', rate: 10, exempt: false };
    case 'vat_20':
      return { status: 'payer', rate: 20, exempt: false };
    case 'no_vat':
    default:
      return fallback ? cloneVatSettings(fallback) : { ...DEFAULT_VAT_SETTINGS };
  }
};

const normalizeVatSettings = (
  input?: VatSettings,
  legacyMode?: Contract['vatMode'] | ContractUiProfile['default_vat_mode'],
): VatSettings => {
  if (!input) {
    return legacyVatModeToSettings(legacyMode);
  }

  const status = input.status === 'payer' ? 'payer' : 'non_payer';
  const exempt = Boolean(input.exempt);
  if (status !== 'payer') {
    return { ...DEFAULT_VAT_SETTINGS };
  }

  const rate = sanitizeVatRate(input.rate);
  if (rate === null) {
    const legacy = legacyVatModeToSettings(legacyMode);
    return {
      status: 'payer',
      exempt,
      rate: sanitizeVatRate(legacy.rate) ?? 20,
    };
  }

  return {
    status: 'payer',
    exempt,
    rate,
  };
};

const settingsToLegacyVatMode = (settings?: VatSettings): Contract['vatMode'] => {
  if (!settings || settings.status !== 'payer') {
    return 'no_vat';
  }
  if (settings.exempt) {
    return 'vat_0';
  }
  const rate = sanitizeVatRate(settings.rate);
  if (rate === null) {
    return 'vat_20';
  }
  if (Math.abs(rate) < 0.0001) {
    return 'vat_0';
  }
  if (Math.abs(rate - 10) < 0.0001) {
    return 'vat_10';
  }
  if (Math.abs(rate - 20) < 0.0001) {
    return 'vat_20';
  }
  return 'vat_20';
};

const normalizeTaskFilters = (
  filters: TaskFilters | undefined,
  fallback: NormalizedTaskFilters,
): NormalizedTaskFilters => {
  if (!filters) {
    return {
      projectKey: fallback.projectKey,
      statuses: [...fallback.statuses],
      period: fallback.period,
      billableOnly: fallback.billableOnly,
    };
  }

  const hasProjectKey = Object.prototype.hasOwnProperty.call(filters, 'projectKey');
  const hasStatuses = Object.prototype.hasOwnProperty.call(filters, 'statuses');
  const hasPeriod = Object.prototype.hasOwnProperty.call(filters, 'period');
  const hasBillableOnly = Object.prototype.hasOwnProperty.call(filters, 'billableOnly');

  const normalizeNullableString = (value: string | null | undefined) => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const projectKey = hasProjectKey
    ? filters.projectKey === null
      ? null
      : normalizeNullableString(filters.projectKey)
    : fallback.projectKey;
  const statuses = hasStatuses
    ? Array.isArray(filters.statuses)
      ? filters.statuses
          .map((status) => (typeof status === 'string' ? status.trim() : ''))
          .filter((status) => status.length > 0)
      : []
    : [...fallback.statuses];
  const period = hasPeriod
    ? filters.period === null
      ? null
      : normalizeNullableString(filters.period)
    : fallback.period;
  const billableOnly = hasBillableOnly ? Boolean(filters.billableOnly) : fallback.billableOnly;

  return {
    projectKey,
    statuses,
    period,
    billableOnly,
  };
};

type DatabaseAction =
  | { type: 'toggle-task-force-include'; taskId: string }
  | { type: 'set-task-force-include'; taskId: string; forceIncluded: boolean }
  | { type: 'create-work-package'; workPackage: WorkPackage; taskIds: string[] }
  | { type: 'create-document-record'; record: DocumentRecord }
  | { type: 'upsert-legal-entity'; entity: LegalEntity }
  | { type: 'upsert-individual'; individual: Individual }
  | { type: 'upsert-contract'; contract: Contract }
  | { type: 'delete-legal-entity'; entityId: string }
  | { type: 'delete-individual'; individualId: string }
  | { type: 'delete-contract'; contractId: string }
  | { type: 'delete-document'; documentId: string }
  | { type: 'delete-tracker-project'; projectId: string }
  | { type: 'replace-directory'; payload: { legalEntities: LegalEntity[]; individuals: Individual[]; contracts: Contract[] } }
  | { type: 'update-template'; template: Template }
  | { type: 'create-template'; template: Template }
  | { type: 'delete-template'; templateId: string }
  | { type: 'set-templates'; templates: Template[] }
  | { type: 'merge-tracker-projects'; projects: TrackerProject[] }
  | { type: 'replace-project-tasks'; projectKey: string; tasks: Task[] }
  | { type: 'set-tasks'; tasks: Task[] }
  | { type: 'upsert-task'; task: Task }
  | { type: 'set-task-periods'; periods: TaskPeriod[] }
  | { type: 'set-work-packages'; workPackages: WorkPackage[] }
  | { type: 'set-documents'; documents: DocumentRecord[] }
  | { type: 'upsert-work-package'; workPackage: WorkPackage }
  | { type: 'upsert-document'; document: DocumentRecord }
  | { type: 'set-users'; users: User[] }
  | { type: 'upsert-user'; user: User }
  | { type: 'delete-user'; userId: string }
  | { type: 'reset-state' };

const createInitialState = (): DatabaseState => ({
  tasks: [],
  taskPeriods: [],
  legalEntities: initialLegalEntities,
  individuals: initialIndividuals,
  contracts: initialContracts,
  documents: [],
  workPackages: [],
  templates: initialTemplates,
  trackerProjects: [],
  users: [],
});

const initialState: DatabaseState = createInitialState();

const databaseReducer = (state: DatabaseState, action: DatabaseAction): DatabaseState => {
  switch (action.type) {
    case 'toggle-task-force-include': {
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.taskId
            ? { ...task, forceIncluded: !task.forceIncluded }
            : task
        ),
      };
    }
    case 'set-task-force-include': {
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.taskId
            ? { ...task, forceIncluded: action.forceIncluded }
            : task
        ),
      };
    }
    case 'create-work-package': {
      const taskIdSet = new Set(action.taskIds);
      return {
        ...state,
        workPackages: [action.workPackage, ...state.workPackages],
        tasks: state.tasks.map((task) =>
          taskIdSet.has(task.id)
            ? { ...task, workPackageId: action.workPackage.id, forceIncluded: false }
            : task
        ),
      };
    }
    case 'create-document-record': {
      return {
        ...state,
        documents: [action.record, ...state.documents],
      };
    }
    case 'set-work-packages': {
      return {
        ...state,
        workPackages: action.workPackages,
      };
    }
    case 'set-documents': {
      return {
        ...state,
        documents: action.documents,
      };
    }
    case 'upsert-work-package': {
      const exists = state.workPackages.some((pkg) => pkg.id === action.workPackage.id);
      return {
        ...state,
        workPackages: exists
          ? state.workPackages.map((pkg) => (pkg.id === action.workPackage.id ? action.workPackage : pkg))
          : [action.workPackage, ...state.workPackages],
      };
    }
    case 'upsert-document': {
      const exists = state.documents.some((doc) => doc.id === action.document.id);
      return {
        ...state,
        documents: exists
          ? state.documents.map((doc) => (doc.id === action.document.id ? action.document : doc))
          : [action.document, ...state.documents],
      };
    }
    case 'set-users': {
      return {
        ...state,
        users: action.users,
      };
    }
    case 'upsert-user': {
      const exists = state.users.some((user) => user.id === action.user.id);
      return {
        ...state,
        users: exists
          ? state.users.map((user) => (user.id === action.user.id ? action.user : user))
          : [action.user, ...state.users],
      };
    }
    case 'delete-user': {
      const clearedIndividuals = state.individuals.map((individual) =>
        individual.userId === action.userId
          ? {
              ...individual,
              userId: null,
              userEmail: null,
              userFullName: null,
              userRole: null,
              userActive: undefined,
            }
          : individual
      );
      return {
        ...state,
        users: state.users.filter((user) => user.id !== action.userId),
        individuals: clearedIndividuals,
      };
    }
    case 'upsert-legal-entity': {
      const exists = state.legalEntities.some((entity) => entity.id === action.entity.id);
      return {
        ...state,
        legalEntities: exists
          ? state.legalEntities.map((entity) => (entity.id === action.entity.id ? action.entity : entity))
          : [action.entity, ...state.legalEntities],
      };
    }
    case 'upsert-individual': {
      const exists = state.individuals.some((individual) => individual.id === action.individual.id);
      return {
        ...state,
        individuals: exists
          ? state.individuals.map((individual) =>
              individual.id === action.individual.id ? action.individual : individual
            )
          : [action.individual, ...state.individuals],
      };
    }
    case 'upsert-contract': {
      const exists = state.contracts.some((contract) => contract.id === action.contract.id);
      return {
        ...state,
        contracts: exists
          ? state.contracts.map((contract) => (contract.id === action.contract.id ? action.contract : contract))
          : [action.contract, ...state.contracts],
      };
    }
    case 'delete-legal-entity': {
      const updatedContracts = state.contracts.map((contract) => {
        if (contract.clientId !== action.entityId) {
          return contract;
        }
        const next = { ...contract, clientId: '' } as Contract;
        return { ...next, status: determineContractStatus(next) };
      });
      const updatedProjects = state.trackerProjects.map((project) =>
        project.clientId === action.entityId ? { ...project, clientId: null } : project
      );
      return {
        ...state,
        legalEntities: state.legalEntities.filter((entity) => entity.id !== action.entityId),
        contracts: updatedContracts,
        trackerProjects: updatedProjects,
      };
    }
    case 'delete-individual': {
      const updatedContracts = state.contracts.map((contract) => {
        if (contract.contractorId !== action.individualId) {
          return contract;
        }
        const next = { ...contract, contractorId: '' } as Contract;
        return { ...next, status: determineContractStatus(next) };
      });
      const updatedProjects = state.trackerProjects.map((project) =>
        project.contractorId === action.individualId ? { ...project, contractorId: null } : project
      );
      return {
        ...state,
        individuals: state.individuals.filter((individual) => individual.id !== action.individualId),
        contracts: updatedContracts,
        trackerProjects: updatedProjects,
      };
    }
    case 'delete-contract': {
      const updatedProjects = state.trackerProjects.map((project) =>
        project.contractId === action.contractId ? { ...project, contractId: null } : project
      );
      return {
        ...state,
        contracts: state.contracts.filter((contract) => contract.id !== action.contractId),
        trackerProjects: updatedProjects,
      };
    }
    case 'delete-document': {
      return {
        ...state,
        documents: state.documents.filter((document) => document.id !== action.documentId),
      };
    }
    case 'delete-tracker-project': {
      const projectToRemove = state.trackerProjects.find((project) => project.id === action.projectId);
      const normalizedKey = projectToRemove?.key ? projectToRemove.key.trim().toUpperCase() : null;
      const targetProjectId = projectToRemove?.id ?? action.projectId;
      const tasks = state.tasks.filter((task) => {
        const taskKey = typeof task.projectKey === 'string' ? task.projectKey.trim().toUpperCase() : '';
        const byKey = normalizedKey ? taskKey === normalizedKey : false;
        const byId = task.projectId ? task.projectId === targetProjectId : false;
        return !(byKey || byId);
      });
      return {
        ...state,
        trackerProjects: state.trackerProjects.filter((project) => project.id !== action.projectId),
        tasks,
      };
    }
    case 'replace-directory': {
      return {
        ...state,
        legalEntities: action.payload.legalEntities,
        individuals: action.payload.individuals,
        contracts: action.payload.contracts,
      };
    }
    case 'update-template': {
      return {
        ...state,
        templates: state.templates.map((template) =>
          template.id === action.template.id ? action.template : template
        ),
      };
    }
    case 'create-template': {
      return {
        ...state,
        templates: [action.template, ...state.templates],
      };
    }
    case 'delete-template': {
      return {
        ...state,
        templates: state.templates.filter((template) => template.id !== action.templateId),
      };
    }
    case 'set-templates': {
      return {
        ...state,
        templates: action.templates,
      };
    }
    case 'merge-tracker-projects': {
      const existing = new Map(state.trackerProjects.map((project) => [project.id, project]));
      action.projects.forEach((project) => {
        const current = existing.get(project.id);
        if (current) {
          existing.set(project.id, {
            ...current,
            ...project,
            tasksCount: project.tasksCount ?? current.tasksCount,
            lastSync: project.lastSync ?? current.lastSync,
            status: project.status ?? current.status,
          });
        } else {
          existing.set(project.id, project);
        }
      });
      return {
        ...state,
        trackerProjects: Array.from(existing.values()),
      };
    }
    case 'replace-project-tasks': {
      const remaining = state.tasks.filter((task) => task.projectKey !== action.projectKey);
      return {
        ...state,
        tasks: [...remaining, ...action.tasks],
      };
    }
    case 'set-tasks': {
      return {
        ...state,
        tasks: action.tasks,
      };
    }
    case 'upsert-task': {
      const exists = state.tasks.some((task) => task.id === action.task.id);
      return {
        ...state,
        tasks: exists
          ? state.tasks.map((task) => (task.id === action.task.id ? action.task : task))
          : [action.task, ...state.tasks],
      };
    }
    case 'set-task-periods': {
      return {
        ...state,
        taskPeriods: action.periods,
      };
    }
    case 'reset-state': {
      return createInitialState();
    }
    default:
      return state;
  }
};

interface DatabaseContextValue extends DatabaseState {
  toggleTaskForceInclude: (taskId: string) => Promise<void>;
  setTaskForceInclude: (taskId: string, value: boolean) => Promise<Task | null>;
  createDocumentRecord: (payload: DocumentCreationPayload) => Promise<DocumentRecord | null>;
  getContractUiProfile: (contractId: string) => Promise<ContractUiProfile | null>;
  getLegalEntityById: (id: string) => LegalEntity | undefined;
  getIndividualById: (id: string) => Individual | undefined;
  getContractById: (id: string) => Contract | undefined;
  getWorkPackageById: (id: string) => WorkPackage | undefined;
  createWorkPackageFromTasks: (
    payload: Omit<DocumentCreationPayload, 'documentType' | 'format'> & { audience?: WorkPackageMetadata['preparedFor'] }
  ) => WorkPackage | null;
  generatePackage: (payload: PackageCreateRequest) => Promise<PackageCreateResponse>;
  exportDirectoryData: () => {
    legalEntities: LegalEntity[];
    individuals: Individual[];
    contracts: Contract[];
  };
  importDirectoryData: (payload: {
    legalEntities: LegalEntity[];
    individuals: Individual[];
    contracts: Contract[];
  }) => Promise<void>;
  templates: Template[];
  loadTemplates: () => Promise<Template[]>;
  createTemplate: (template: {
    name: string;
    type: Template['type'];
    content: string;
    category?: string | null;
    description?: string | null;
  }) => Promise<Template>;
  updateTemplate: (id: string, template: Partial<Template>) => Promise<Template>;
  saveTemplate: (template: Partial<Template>) => Promise<Template>;
  deleteTemplate: (templateId: string) => Promise<void>;
  trackerProjects: TrackerProject[];
  connectJira: (payload: { baseUrl: string; email: string; apiToken: string }) => Promise<{
    connectionId: string;
    projects: TrackerProject[];
  }>;
  importJiraProject: (payload: { connectionId: string; projectKey: string; maxIssues?: number }) => Promise<{
    project: TrackerProject;
    tasks: Task[];
    summary: ImportSummary;
  }>;
  loadJiraProjects: () => Promise<TrackerProject[]>;
  loadTasks: (filters?: TaskFilters, options?: LoadTasksOptions) => Promise<Task[]>;
  loadTaskPeriods: (projectKey?: string | null) => Promise<TaskPeriod[]>;
  loadWorkPackages: () => Promise<WorkPackage[]>;
  releaseWorkPackageTasks: (workPackageId: string) => Promise<WorkPackage | null>;
  loadDocuments: () => Promise<DocumentRecord[]>;
  loadImportLogs: (projectKey?: string | null) => Promise<ImportLog[]>;
  saveLegalEntity: (entity: Omit<LegalEntity, 'status'> & { status?: LegalEntity['status'] }) => Promise<LegalEntity>;
  saveIndividual: (individual: Omit<Individual, 'status'> & { status?: Individual['status'] }) => Promise<Individual>;
  saveContract: (contract: Contract) => Promise<Contract>;
  deleteLegalEntity: (entityId: string) => Promise<void>;
  deleteIndividual: (individualId: string) => Promise<void>;
  deleteContract: (contractId: string) => Promise<void>;
  deleteDocument: (documentId: string) => Promise<void>;
  advanceDocumentApproval: (documentId: string, action: 'submit' | 'manager_approve' | 'performer_approve' | 'finalize', note?: string | null) => Promise<DocumentRecord>;
  addDocumentNote: (documentId: string, message: string) => Promise<DocumentRecord>;
  shareDocumentWithParent: (documentId: string) => Promise<DocumentRecord>;
  revokeDocumentShare: (documentId: string) => Promise<DocumentRecord>;
  deleteTrackerProject: (projectId: string) => Promise<void>;
  updateProjectLinks: (payload: { projectId: string; clientId?: string | null; contractorId?: string | null; contractId?: string | null }) => Promise<TrackerProject>;
  tasksLoadToken: number;
  acknowledgedTasksLoadToken: number;
  tasksLoadDelta: { token: number; newCount: number };
  loadUsers: () => Promise<User[]>;
  registerUser: (payload: { email: string; password: string; fullName?: string | null; role: UserRole }) => Promise<User>;
  resetUserPassword: (userId: string) => Promise<{ userId: string; password: string }>;
  deleteUser: (userId: string) => Promise<void>;
  updateUserRoles: (userId: string, roles: UserRole[]) => Promise<User>;
}

const DatabaseContext = createContext<DatabaseContextValue | undefined>(undefined);

const createTaskSnapshot = (task: Task): TaskSnapshot => {
  const remainingHours = (() => {
    if (typeof task.hours === 'number' && Number.isFinite(task.hours)) {
      return Math.max(task.hours, 0);
    }
    const totalSeconds = typeof task.secondsSpent === 'number' ? task.secondsSpent : 0;
    const billedSeconds = typeof task.billedSeconds === 'number' ? task.billedSeconds : 0;
    return Math.max((totalSeconds - billedSeconds) / 3600, 0);
  })();
  return {
    id: task.id,
    key: task.key,
    title: task.title,
    status: task.status,
    hours: Number(remainingHours.toFixed(2)),
    billable: task.billable,
    forceIncluded: task.forceIncluded,
    projectKey: task.projectKey,
    projectName: task.projectName,
  };
};

const taskSnapshotToTask = (
  snapshot: TaskSnapshot,
  context: {
    workPackageId: string;
    contractId?: string;
    clientId?: string;
    contractorId?: string;
    projectKey?: string;
    projectName?: string;
  }
): Task => {
  const hours = typeof snapshot.hours === 'number' ? snapshot.hours : 0;
  const seconds = Math.max(Math.round(hours * 3600), 0);
  return {
    id: snapshot.id,
    key: snapshot.key,
    projectKey: context.projectKey ?? snapshot.projectKey ?? '',
    projectName: context.projectName ?? snapshot.projectName ?? '',
    clientId: context.clientId,
    contractorId: context.contractorId,
    contractId: context.contractId,
    title: snapshot.title ?? snapshot.key,
    description: snapshot.description ?? null,
    status: snapshot.status,
    hours,
    billable: Boolean(snapshot.billable),
    forceIncluded: Boolean(snapshot.forceIncluded),
    workPackageId: context.workPackageId,
    assigneeAccountId: null,
    assigneeDisplayName: null,
    assigneeEmail: null,
    secondsSpent: seconds,
    secondsEstimate: undefined,
    billedSeconds: seconds,
    updatedAt: undefined,
    startedAt: null,
    completedAt: null,
    createdAt: null,
  };
};

const randomId = (prefix: string) =>
  `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)}`;

const taskFingerprint = (task: Task) => {
  const key = task.key?.trim();
  if (key && key !== 'UNKNOWN') {
    return `${task.projectKey || 'default'}:${key}`;
  }
  return task.id;
};

const determineLegalEntityStatus = (entity: LegalEntity): LegalEntity['status'] => {
  const hasCoreData =
    Boolean((entity.name ?? '').trim()) &&
    Boolean((entity.inn ?? '').trim()) &&
    Boolean((entity.kpp ?? '').trim()) &&
    Boolean((entity.signatory ?? '').trim()) &&
    Boolean((entity.basis ?? '').trim());
  if (!hasCoreData) {
    return 'incomplete';
  }
  const normalizedBasis = (entity.basis ?? '').trim().toLowerCase();
  if (normalizedBasis.includes('довер')) {
    const hasNumber = Boolean((entity.powerOfAttorneyNumber ?? '').toString().trim());
    const hasDate = Boolean((entity.powerOfAttorneyDate ?? '').toString().trim());
    if (!hasNumber || !hasDate) {
      return 'incomplete';
    }
  }
  return 'complete';
};

const determineIndividualStatus = (individual: Individual): Individual['status'] =>
  individual.name && individual.inn && individual.passport && individual.address ? 'complete' : 'incomplete';

const determineContractStatus = (contract: Contract): Contract['status'] =>
  contract.number && contract.clientId && contract.contractorId && contract.rate > 0 ? 'complete' : 'incomplete';

export const DatabaseProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(databaseReducer, initialState);
  const lastTaskFiltersRef = useRef<NormalizedTaskFilters>(defaultTaskFilters);
  const tasksTokenRef = useRef(0);
  const [tasksLoadToken, setTasksLoadToken] = useState(0);
  const [acknowledgedTasksLoadToken, setAcknowledgedTasksLoadToken] = useState(0);
  const [latestTasksDelta, setLatestTasksDelta] = useState<{ token: number; newCount: number }>({ token: 0, newCount: 0 });
  const tasksSnapshotRef = useRef<Task[]>(state.tasks);
  const lastWorkspaceIdRef = useRef<string | null>(null);
  const { token } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id ?? null;
  const apiBaseUrl =
    import.meta.env.VITE_BACKEND_URL ??
    import.meta.env.VITE_API_BASE_URL ??
    'http://localhost:8000';

  const authorizedFetch = useCallback(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers ?? {});
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (workspaceId) {
      headers.set('X-Workspace-Id', workspaceId);
    }
    const requestInit: RequestInit = { ...init, headers };
    if (!requestInit.cache) {
      requestInit.cache = 'no-store';
    }
    const response = await fetch(input, requestInit);

    if (response.status === 401) {
      const target = typeof input === 'string' ? input : input.toString();
      console.warn('[DataContext] Received 401 response for request:', target);
    }

    return response;
  }, [token, workspaceId]);

  const bumpTasksToken = useCallback((acknowledge?: boolean, delta = 0) => {
    tasksTokenRef.current += 1;
    const next = tasksTokenRef.current;
    setTasksLoadToken(next);
    setLatestTasksDelta({ token: next, newCount: delta });
    if (acknowledge || next === 1) {
      setAcknowledgedTasksLoadToken(next);
    }
    return next;
  }, []);

  useEffect(() => {
    tasksSnapshotRef.current = state.tasks;
  }, [state.tasks]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    if (lastWorkspaceIdRef.current === workspaceId) {
      return;
    }
    lastWorkspaceIdRef.current = workspaceId;
    dispatch({ type: 'reset-state' });
    tasksSnapshotRef.current = [];
    tasksTokenRef.current = 0;
    setTasksLoadToken(0);
    setAcknowledgedTasksLoadToken(0);
    setLatestTasksDelta({ token: 0, newCount: 0 });
  }, [workspaceId, dispatch]);

  const normalizeServerTemplate = useCallback((template: Partial<Template>): Template => {
    const updatedAt =
      typeof template.updatedAt === 'string' ? template.updatedAt : new Date().toISOString();
    const createdAt =
      typeof template.createdAt === 'string' ? template.createdAt : updatedAt;
    return {
      id: template.id ?? randomId('template'),
      name: (template.name ?? 'Новый шаблон').trim() || 'Новый шаблон',
      type: (template.type as Template['type'] | undefined) ?? 'custom',
      content: template.content ?? '',
      updatedAt,
      createdAt,
      category: template.category ?? null,
      description: template.description ?? null,
    };
  }, []);

  const mapTrackerProject = useCallback((project: Partial<TrackerProject>): TrackerProject => {
    const performerIdsRaw = (() => {
      if (Array.isArray((project as { performerIds?: unknown[] }).performerIds)) {
        return (project as { performerIds?: unknown[] }).performerIds ?? [];
      }
      if (Array.isArray((project as { performers?: Array<{ individualId?: string; contractorId?: string }> }).performers)) {
        return (project as { performers: Array<{ individualId?: string; contractorId?: string }> }).performers
          .map((item) => item?.individualId ?? item?.contractorId ?? '')
          .filter(Boolean);
      }
      return [];
    })();

    const performerIds = performerIdsRaw
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0);

    return {
      id: project.id ?? project.key ?? randomId('project'),
      connectionId: project.connectionId ?? '',
      key: project.key ?? 'UNKNOWN',
      name: project.name ?? project.key ?? 'Без названия',
      tracker: project.tracker ?? 'Jira',
      status: project.status ?? 'discovered',
      lastSync: project.lastSync ?? null,
      tasksCount: project.tasksCount ?? 0,
      connection: project.connection ?? '',
      clientId: project.clientId ?? null,
      contractorId: project.contractorId ?? null,
      contractId: project.contractId ?? null,
      performerIds,
      readyForDocs: project.readyForDocs ?? 'needs_setup',
      readinessNotes: project.readinessNotes ?? null,
    } satisfies TrackerProject;
  }, []);

  const mapLegalEntity = useCallback(
    (entity: Partial<LegalEntity>): LegalEntity => {
      const legacyVatMode = (entity as LegalEntity).defaultVatMode ?? 'no_vat';
      const normalizedVat = normalizeVatSettings((entity as LegalEntity).defaultVatSettings, legacyVatMode);
      const powerOfAttorneyNumber =
        (entity as LegalEntity).powerOfAttorneyNumber ??
        (entity as { power_of_attorney_number?: string | null }).power_of_attorney_number ??
        null;
      const powerOfAttorneyDate =
        (entity as LegalEntity).powerOfAttorneyDate ??
        (entity as { power_of_attorney_date?: string | null }).power_of_attorney_date ??
        null;
      const base: LegalEntity = {
        id: entity.id ?? randomId('legal'),
        name: entity.name ?? '',
        inn: entity.inn ?? '',
        kpp: entity.kpp ?? '',
        signatory: entity.signatory ?? '',
        basis: entity.basis ?? '',
        powerOfAttorneyNumber:
          typeof powerOfAttorneyNumber === 'string' ? powerOfAttorneyNumber : null,
        powerOfAttorneyDate:
          typeof powerOfAttorneyDate === 'string' ? powerOfAttorneyDate : null,
        status: 'incomplete',
        defaultVatMode: settingsToLegacyVatMode(normalizedVat),
        defaultVatSettings: normalizedVat,
        requireInvoice: (entity as LegalEntity).requireInvoice ?? false,
      };
      return {
        ...base,
        status: (entity.status as LegalEntity['status'] | undefined) ?? determineLegalEntityStatus(base),
      };
    },
    []
  );

  const mapIndividual = useCallback(
    (individual: Partial<Individual>): Individual => {
      const base: Individual = {
        id: individual.id ?? randomId('individual'),
        name: individual.name ?? '',
        inn: individual.inn ?? '',
        passport: individual.passport ?? '',
        address: individual.address ?? '',
        email: individual.email ?? '',
        externalId: individual.externalId ?? (individual as { external_id?: string }).external_id ?? null,
        source: individual.source ?? (individual as { source?: string }).source ?? 'manual',
        status: 'incomplete',
        legalType: (individual as Individual).legalType ?? undefined,
        taxDocumentStatus: (individual as Individual).taxDocumentStatus ?? 'missing',
        userId:
          (individual as Individual).userId ?? (individual as { user_id?: string | null }).user_id ?? null,
        userEmail:
          (individual as Individual).userEmail ?? (individual as { user_email?: string | null }).user_email ?? null,
        userFullName:
          (individual as Individual).userFullName
          ?? (individual as { user_full_name?: string | null }).user_full_name
          ?? null,
        userRole:
          (individual as Individual).userRole ?? (individual as { user_role?: string | null }).user_role ?? null,
        userActive:
          (individual as Individual).userActive ?? (individual as { user_active?: boolean }).user_active ?? undefined,
        isApprovalManager: Boolean((individual as Individual).isApprovalManager ?? (individual as { is_approval_manager?: boolean }).is_approval_manager ?? false),
        approvalManagerId:
          (individual as Individual).approvalManagerId
          ?? (individual as { approval_manager_id?: string | null }).approval_manager_id
          ?? null,
        generatedPassword: (individual as Individual).generatedPassword ?? null,
      };
      return {
        ...base,
        status: (individual.status as Individual['status'] | undefined) ?? determineIndividualStatus(base),
      };
    },
    []
  );

  const mapContract = useCallback(
    (contract: Partial<Contract>): Contract => {
      const legacyVatMode = (contract as Contract).vatMode ?? 'no_vat';
      const normalizedVat = normalizeVatSettings((contract as Contract).vatSettings, legacyVatMode);
      const rawContractDate =
        (contract as Contract).contractDate ??
        (contract as { contract_date?: string | null }).contract_date ??
        null;
      const contractDate =
        typeof rawContractDate === 'string' ? (rawContractDate.trim() || null) : rawContractDate ?? null;
      const base: Contract = {
        id: contract.id ?? randomId('contract'),
        number: contract.number ?? '',
        clientId: contract.clientId ?? '',
        contractorId: contract.contractorId ?? '',
        contractDate,
        rate: typeof contract.rate === 'number' ? contract.rate : Number(contract.rate ?? 0),
        rateType: contract.rateType === 'month' ? 'month' : 'hour',
        currency: contract.currency ?? 'RUB',
        status: 'incomplete',
        performerType: (contract as Contract).performerType ?? 'gph',
        vatMode: settingsToLegacyVatMode(normalizedVat),
        vatSettings: normalizedVat,
        includeTimesheetByDefault: (contract as Contract).includeTimesheetByDefault ?? false,
        timesheetToggleLocked: (contract as Contract).timesheetToggleLocked ?? false,
        requireNpdReceipt: (contract as Contract).requireNpdReceipt ?? false,
        actByProjects: (contract as Contract).actByProjects ?? false,
        normHours: (contract as Contract).normHours ?? null,
        templateAvrId: (contract as Contract).templateAvrId ?? null,
        templateIprId: (contract as Contract).templateIprId ?? null,
        templateInvoiceId: (contract as Contract).templateInvoiceId ?? null,
        validFrom: (contract as Contract).validFrom ?? null,
        validTo: (contract as Contract).validTo ?? null,
        expirationReminderEnabled: Boolean((contract as Contract).expirationReminderEnabled ?? false),
        expirationReminderDays: (contract as Contract).expirationReminderDays ?? null,
        requireIsDocument: Boolean((contract as Contract).requireIsDocument ?? false),
        allowedTemplateIds: Array.isArray((contract as Contract).allowedTemplateIds)
          ? [...((contract as Contract).allowedTemplateIds as string[])]
          : [],
        usageActEnabled: (contract as Contract).usageActEnabled ?? false,
        usageInvoiceEnabled: (contract as Contract).usageInvoiceEnabled ?? false,
        usageTaxReportingEnabled: (contract as Contract).usageTaxReportingEnabled ?? false,
        usageGrantsEnabled: (contract as Contract).usageGrantsEnabled ?? false,
        usageInternalEnabled: (contract as Contract).usageInternalEnabled ?? false,
      };

      return {
        ...base,
        status: (contract.status as Contract['status'] | undefined) ?? determineContractStatus(base),
      };
    },
    []
  );

  const getContractUiProfile = useCallback(
    async (contractId: string): Promise<ContractUiProfile | null> => {
      const numericId = Number(contractId);
      if (!Number.isFinite(numericId)) {
        return null;
      }
      try {
        const response = await authorizedFetch(`${apiBaseUrl}/contracts/${numericId}/ui-profile`);
        if (!response.ok) {
          console.warn('[DataContext] Failed to fetch contract UI profile', numericId, response.status);
          return null;
        }
        const raw = (await response.json()) as Partial<ContractUiProfile>;
        return {
          contract_id: raw.contract_id ?? numericId,
          performer_type: raw.performer_type ?? 'gph',
          available_documents: raw.available_documents ?? [],
          default_documents: raw.default_documents ?? [],
          hidden_sections: raw.hidden_sections ?? [],
          required_fields: raw.required_fields ?? [],
          show_vat_selector: Boolean(raw.show_vat_selector),
          vat_modes: (raw.vat_modes as ContractUiProfile['vat_modes']) ?? ['no_vat'],
          default_vat_mode: raw.default_vat_mode ?? 'no_vat',
          include_timesheet_by_default: Boolean(raw.include_timesheet_by_default),
          timesheet_toggle_locked: Boolean(raw.timesheet_toggle_locked),
          helper_texts: raw.helper_texts ?? {},
          document_rules: raw.document_rules ?? {},
          current_rules: raw.current_rules ?? null,
          rate_edit_rule: raw.rate_edit_rule ?? null,
          grouping_rules: raw.grouping_rules ?? {},
          valid_from: raw.valid_from ?? null,
          valid_to: raw.valid_to ?? null,
          expiration_reminder_enabled: raw.expiration_reminder_enabled ?? false,
          expiration_reminder_days: raw.expiration_reminder_days ?? null,
          contract_status: raw.contract_status,
        } satisfies ContractUiProfile;
      } catch (error) {
        console.error('[DataContext] Unable to fetch contract UI profile', error);
        return null;
      }
    },
    [apiBaseUrl, authorizedFetch]
  );

  const mapTask = useCallback(
    (task: Partial<Task>): Task => {
      const rawId = task.id ?? randomId('task');
      const id = String(rawId);
      const rawKey = task.key ?? (typeof id === 'string' && id.includes(':') ? id.split(':').slice(1).join(':') : id);
      const projectId =
        (task.projectId as string | undefined) ??
        (task as { project_id?: string | null }).project_id ??
        null;
      const clientId =
        (task.clientId as string | undefined) ??
        (task as { client_id?: string | null }).client_id ??
        null;
      const contractorId =
        (task.contractorId as string | undefined) ??
        (task as { contractor_id?: string | null }).contractor_id ??
        null;
      const contractId =
        (task.contractId as string | undefined) ??
        (task as { contract_id?: string | null }).contract_id ??
        null;
      const description =
        (task.description as string | undefined) ??
        (task as { description?: string | null }).description ??
        null;
      const secondsSpent = typeof task.secondsSpent === 'number'
        ? task.secondsSpent
        : Number((task as { spent_seconds?: number }).spent_seconds ?? (typeof task.hours === 'number' ? task.hours * 3600 : 0));
      const secondsEstimate = typeof task.secondsEstimate === 'number'
        ? task.secondsEstimate
        : Number((task as { estimate_seconds?: number }).estimate_seconds ?? 0);
      const billedSeconds = typeof task.billedSeconds === 'number'
        ? task.billedSeconds
        : Number((task as { billed_seconds?: number }).billed_seconds ?? 0);
      const hours = (() => {
        if (typeof task.hours === 'number' && Number.isFinite(task.hours)) {
          return Number(Math.max(task.hours, 0).toFixed(2));
        }
        const remaining = Math.max(secondsSpent - billedSeconds, 0);
        return Number((remaining / 3600).toFixed(2));
      })();
      const workPackageIdValue = (() => {
        if (typeof task.workPackageId === 'string' && task.workPackageId.trim().length > 0) {
          return task.workPackageId.trim();
        }
        const legacy = (task as { work_package_id?: string | null }).work_package_id;
        if (typeof legacy === 'string' && legacy.trim().length > 0) {
          return legacy.trim();
        }
        return undefined;
      })();

      return {
        id,
        key: String(rawKey),
        projectKey: task.projectKey ?? '',
        projectName: task.projectName ?? '',
        projectId: projectId && projectId.trim() ? projectId : null,
        clientId: clientId && clientId.trim() ? clientId : null,
        contractorId: contractorId && contractorId.trim() ? contractorId : null,
        contractId: contractId && contractId.trim() ? contractId : null,
        title: (task.title as string | undefined) ?? (task as { summary?: string }).summary ?? '',
        description: description ?? undefined,
        status: (task.status as Task['status'] | undefined) ?? 'In Progress',
        hours,
        billable: task.billable !== undefined ? Boolean(task.billable) : true,
        forceIncluded:
          task.forceIncluded !== undefined ? Boolean(task.forceIncluded) : Boolean((task as { force_included?: boolean }).force_included ?? false),
        workPackageId: workPackageIdValue,
        assigneeAccountId: (task.assigneeAccountId as string | undefined) ?? (task as { assignee_account_id?: string }).assignee_account_id ?? null,
        assigneeDisplayName: (task.assigneeDisplayName as string | undefined) ?? (task as { assignee_display_name?: string }).assignee_display_name ?? null,
        assigneeEmail: (task.assigneeEmail as string | undefined) ?? (task as { assignee_email?: string }).assignee_email ?? null,
        secondsSpent,
        secondsEstimate,
        billedSeconds,
        updatedAt: (task.updatedAt as string | undefined)
          ?? (task as { updated_at?: string }).updated_at
          ?? (task as { updated?: string }).updated
          ?? undefined,
        startedAt:
          (task.startedAt as string | undefined)
            ?? (task as { started_at?: string | null }).started_at
            ?? (task as { start_date?: string | null }).start_date
            ?? (task as { startDate?: string | null }).startDate
            ?? (task as { started?: string | null }).started
            ?? (task as { start?: string | null }).start
            ?? (task as { commencementDate?: string | null }).commencementDate
            ?? null,
        completedAt:
          (task.completedAt as string | undefined)
            ?? (task as { completed_at?: string | null }).completed_at
            ?? (task as { finished_at?: string | null }).finished_at
            ?? (task as { completed?: string | null }).completed
            ?? (task as { finish_date?: string | null }).finish_date
            ?? (task as { finishDate?: string | null }).finishDate
            ?? (task as { due_date?: string | null }).due_date
            ?? (task as { dueDate?: string | null }).dueDate
            ?? (task as { resolutiondate?: string | null }).resolutiondate
            ?? (task as { resolutionDate?: string | null }).resolutionDate
            ?? null,
        createdAt:
          (task.createdAt as string | undefined)
            ?? (task as { created_at?: string | null }).created_at
            ?? (task as { createdDate?: string | null }).createdDate
            ?? (task as { created?: string | null }).created
            ?? null,
      };
    },
    []
  );

  const mapTaskPeriod = useCallback(
    (period: Partial<TaskPeriod>): TaskPeriod => ({
      value: period.value ?? '',
      label: period.label ?? (period.value ?? ''),
      start:
        typeof period.start === 'string'
          ? period.start
          : period.start instanceof Date
            ? period.start.toISOString().slice(0, 10)
            : '',
      end:
        typeof period.end === 'string'
          ? period.end
          : period.end instanceof Date
            ? period.end.toISOString().slice(0, 10)
            : '',
      tasks: typeof period.tasks === 'number' ? period.tasks : Number(period.tasks ?? 0),
    }),
    []
  );

  const mapTaskCostSnapshot = useCallback(
    (snapshot: Partial<TaskCostSnapshot>): TaskCostSnapshot => ({
      id: snapshot.id ? String(snapshot.id) : randomId('task'),
      key: snapshot.key ? String(snapshot.key) : 'UNKNOWN',
      title: snapshot.title ?? '',
      description: typeof snapshot.description === 'string' ? snapshot.description : undefined,
      status: (snapshot.status as Task['status'] | undefined) ?? 'In Progress',
      hours: typeof snapshot.hours === 'number' ? snapshot.hours : Number(snapshot.hours ?? 0),
      billable: snapshot.billable !== undefined ? Boolean(snapshot.billable) : true,
      forceIncluded: snapshot.forceIncluded !== undefined ? Boolean(snapshot.forceIncluded) : false,
      projectKey: snapshot.projectKey ?? '',
      projectName: snapshot.projectName ?? '',
      hourlyRate: typeof snapshot.hourlyRate === 'number' ? snapshot.hourlyRate : Number(snapshot.hourlyRate ?? 0),
      amount: typeof snapshot.amount === 'number' ? snapshot.amount : Number(snapshot.amount ?? 0),
      categories: Array.isArray(snapshot.categories) ? snapshot.categories.map((item) => String(item)) : undefined,
    }),
    []
  );

  const mapMetadata = useCallback(
    (metadata: Partial<WorkPackageMetadata> | Record<string, unknown> | null | undefined): WorkPackageMetadata => {
      const payload = (metadata ?? {}) as Record<string, unknown>;

      const preparedRaw = Array.isArray(payload.preparedFor)
        ? (payload.preparedFor as unknown[]).filter((item): item is DocumentAudience => typeof item === 'string' && item.trim().length > 0)
        : [];

      const tagsRaw = Array.isArray(payload.tags)
        ? (payload.tags as unknown[])
            .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
            .filter((tag): tag is string => tag.length > 0)
        : [];
      const uniqueTags = Array.from(new Set(tagsRaw));

      const taxCategory = typeof payload.taxCategory === 'string' && payload.taxCategory.trim().length > 0
        ? (payload.taxCategory as string)
        : undefined;
      const benefitCategory = typeof payload.benefitCategory === 'string' && payload.benefitCategory.trim().length > 0
        ? (payload.benefitCategory as string)
        : undefined;

      const adjustments = Array.isArray(payload.adjustments)
        ? (payload.adjustments as WorkPackageMetadata['adjustments'])
        : undefined;

      return {
        preparedFor: (preparedRaw.length > 0 ? preparedRaw : ['act', 'invoice', 'tax-report']) as DocumentAudience[],
        tags: uniqueTags,
        taxCategory,
        benefitCategory,
        currency: 'RUB',
        adjustments,
      };
    },
    []
  );

  const normalizePersonKey = (value: string | null | undefined) => value?.trim().toLowerCase() ?? '';

  const mergeIndividualRecords = (primary: Individual, secondary: Individual): Individual => {
    const merged: Individual = { ...primary };
    if (!merged.inn && secondary.inn) merged.inn = secondary.inn;
    if (!merged.passport && secondary.passport) merged.passport = secondary.passport;
    if (!merged.address && secondary.address) merged.address = secondary.address;
    if (!merged.email && secondary.email) merged.email = secondary.email;
    if (!merged.externalId && secondary.externalId) merged.externalId = secondary.externalId;
    if (secondary.status === 'complete') merged.status = 'complete';
    if (merged.source === 'manual' && secondary.source && secondary.source !== 'manual') {
      merged.source = secondary.source;
    }
    return merged;
  };

  const individualsShallowEqual = (source: Individual, target: Individual) =>
    source.inn === target.inn &&
    source.passport === target.passport &&
    source.address === target.address &&
    source.email === target.email &&
    source.externalId === target.externalId &&
    source.status === target.status &&
    source.source === target.source;

  const buildIndividualUpdatePayload = (individual: Individual) => ({
    name: individual.name,
    inn: individual.inn,
    passport: individual.passport,
    address: individual.address,
    email: individual.email,
    externalId: individual.externalId ?? null,
    source: individual.source ?? 'manual',
  });

  const computeIndividualScore = (individual: Individual, referenced: Set<string>) => {
    let score = 0;
    if (referenced.has(individual.id)) score += 10;
    if (individual.externalId) score += 6;
    if (individual.email) score += 4;
    if (individual.inn) score += 3;
    if (individual.passport) score += 3;
    if (individual.address) score += 1;
    if (individual.status === 'complete') score += 2;
    return score;
  };

  const pruneIndividuals = useCallback(
    async (individuals: Individual[], contracts: Contract[]): Promise<Individual[]> => {
      if (individuals.length === 0) {
        return individuals;
      }

      const referenced = new Set(
        contracts
          .map((contract) => contract.contractorId)
          .filter((id): id is string => Boolean(id))
      );

      const keyFor = (individual: Individual) => {
        if (individual.externalId) {
          return `external:${normalizePersonKey(individual.externalId)}`;
        }
        if (individual.email) {
          return `email:${normalizePersonKey(individual.email)}`;
        }
        if (individual.inn) {
          return `inn:${individual.inn}`;
        }
        if (individual.passport) {
          return `passport:${individual.passport}`;
        }
        if (individual.name.trim()) {
          return `name:${normalizePersonKey(individual.name)}`;
        }
        return `id:${individual.id}`;
      };

      const grouped = new Map<string, Individual[]>();
      individuals.forEach((individual) => {
        const key = keyFor(individual);
        const bucket = grouped.get(key);
        if (bucket) {
          bucket.push(individual);
        } else {
          grouped.set(key, [individual]);
        }
      });

      const pendingUpdates: Array<{ id: string; merged: Individual }> = [];
      const pendingRemovals: string[] = [];

      grouped.forEach((items) => {
        if (items.length <= 1) {
          return;
        }

        const sorted = [...items].sort(
          (a, b) => computeIndividualScore(b, referenced) - computeIndividualScore(a, referenced)
        );
        const canonical = sorted[0];
        let merged = { ...canonical };
        sorted.slice(1).forEach((candidate) => {
          merged = mergeIndividualRecords(merged, candidate);
        });

        if (!individualsShallowEqual(canonical, merged)) {
          pendingUpdates.push({ id: canonical.id, merged });
        }

        sorted.slice(1).forEach((candidate) => {
          if (!referenced.has(candidate.id)) {
            pendingRemovals.push(candidate.id);
          }
        });
      });

      const successfulUpdates = new Map<string, Individual>();
      if (pendingUpdates.length > 0) {
        const results = await Promise.allSettled(
          pendingUpdates.map(({ id, merged }) =>
            authorizedFetch(`${apiBaseUrl}/directory/individuals/${encodeURIComponent(id)}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(buildIndividualUpdatePayload(merged)),
            }).then((response) => {
              if (!response.ok) {
                throw new Error(`Failed to update individual ${id}`);
              }
              successfulUpdates.set(id, merged);
            })
          )
        );

        results.forEach((result) => {
          if (result.status === 'rejected') {
            console.error('[DataContext] Failed to merge duplicate individual', result.reason);
          }
        });
      }

      const successfullyRemoved = new Set<string>();
      if (pendingRemovals.length > 0) {
        const removalResults = await Promise.allSettled(
          pendingRemovals.map((id) =>
            authorizedFetch(`${apiBaseUrl}/directory/individuals/${encodeURIComponent(id)}`, {
              method: 'DELETE',
            }).then((response) => {
              if (!response.ok) {
                throw new Error(`Failed to delete duplicate individual ${id}`);
              }
              successfullyRemoved.add(id);
            })
          )
        );

        removalResults.forEach((result) => {
          if (result.status === 'rejected') {
            console.error('[DataContext] Failed to delete duplicate individual', result.reason);
          }
        });
      }

      if (successfulUpdates.size === 0 && successfullyRemoved.size === 0) {
        return individuals;
      }

      return individuals
        .filter((individual) => !successfullyRemoved.has(individual.id))
        .map((individual) => successfulUpdates.get(individual.id) ?? individual);
    },
    [apiBaseUrl]
  );

  const mapWorkPackage = useCallback(
    (pkg: Partial<WorkPackage>): WorkPackage => {
      const metadataSource =
        (pkg as { metadata?: Partial<WorkPackageMetadata> | Record<string, unknown> | null }).metadata ??
        (pkg as { metadata_json?: Record<string, unknown> | null }).metadata_json ??
        null;

      return {
        id: pkg.id ?? randomId('wp'),
        createdAt: typeof pkg.createdAt === 'string' ? pkg.createdAt : new Date().toISOString(),
        period: pkg.period ?? '',
        projectKey: pkg.projectKey ?? '',
        projectName: pkg.projectName ?? '',
        contractId: pkg.contractId ?? '',
        clientId: pkg.clientId ?? '',
        contractorId: pkg.contractorId ?? '',
        totalHours: typeof pkg.totalHours === 'number' ? pkg.totalHours : Number(pkg.totalHours ?? 0),
        totalAmount: typeof pkg.totalAmount === 'number' ? pkg.totalAmount : Number(pkg.totalAmount ?? 0),
        hourlyRate: typeof pkg.hourlyRate === 'number' ? pkg.hourlyRate : Number(pkg.hourlyRate ?? 0),
        baseRate: typeof pkg.baseRate === 'number' ? pkg.baseRate : Number(pkg.baseRate ?? 0),
        rateType: pkg.rateType === 'month' ? 'month' : 'hour',
        includeTimesheet: Boolean(pkg.includeTimesheet),
        currency: pkg.currency === 'RUB' ? 'RUB' : 'RUB',
        performerType: typeof pkg.performerType === 'string' ? pkg.performerType : 'individual',
        vatIncluded: Boolean(pkg.vatIncluded),
        vatPercent: typeof pkg.vatPercent === 'number' ? pkg.vatPercent : Number(pkg.vatPercent ?? 0),
        vatAmount: typeof pkg.vatAmount === 'number' ? pkg.vatAmount : Number(pkg.vatAmount ?? 0),
        taskSnapshots: Array.isArray(pkg.taskSnapshots)
          ? pkg.taskSnapshots.map((snapshot) => mapTaskCostSnapshot(snapshot as Partial<TaskCostSnapshot>))
          : [],
        metadata: mapMetadata(metadataSource),
        performerId:
          typeof (pkg as { performerId?: unknown }).performerId === 'string'
            ? ((pkg as { performerId?: string }).performerId ?? null)
            : typeof pkg.contractorId === 'string'
              ? pkg.contractorId
              : null,
      };
    },
    [mapMetadata, mapTaskCostSnapshot]
  );

  const normalizeDocumentType = useCallback((value: unknown): DocumentRecord['type'] => {
    if (typeof value !== 'string') {
      return 'act';
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'act' || normalized === 'avr' || normalized === 'акт') {
      return 'act';
    }
    if (normalized === 'invoice' || normalized === 'счет' || normalized === 'счёт') {
      return 'invoice';
    }
    if (normalized === 'timesheet' || normalized === 'таймшит' || normalized === 'timesheet_doc') {
      return 'timesheet';
    }
    if (normalized === 'package' || normalized === 'пакет') {
      return 'package';
    }
    return 'custom';
  }, []);

  const normalizeDocumentFileType = useCallback(
    (value: unknown): DocumentRecord['files'][number]['type'] => {
      if (typeof value !== 'string') {
        return 'act';
      }
      const normalized = value.trim().toLowerCase();
      if (normalized === 'invoice' || normalized === 'счет' || normalized === 'счёт') {
        return 'invoice';
      }
      if (normalized === 'timesheet' || normalized === 'таймшит') {
        return 'timesheet';
      }
      if (normalized === 'package' || normalized === 'пакет') {
        return 'package';
      }
      if (normalized === 'custom') {
        return 'custom';
      }
      return 'act';
    },
    [],
  );

  const mapDocumentRecord = useCallback(
    (record: Partial<DocumentRecord>): DocumentRecord => ({
      id: record.id ?? randomId('doc'),
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
      period: record.period ?? '',
      type: normalizeDocumentType(
        (record.type as string | undefined) ??
          (record as { document_type?: string }).document_type ??
          (record as { doc_type?: string }).doc_type,
      ),
      workspaceId:
        typeof record.workspaceId === 'string'
          ? record.workspaceId
          : typeof (record as { workspace_id?: string }).workspace_id === 'string'
            ? String((record as { workspace_id?: string }).workspace_id)
            : '',
      workspaceName:
        typeof record.workspaceName === 'string'
          ? record.workspaceName
          : typeof (record as { workspace_name?: string | null }).workspace_name === 'string'
            ? (record as { workspace_name?: string | null }).workspace_name
            : null,
      clientId: record.clientId ?? '',
      contractorId: record.contractorId ?? '',
      contractId: record.contractId ?? '',
      projectKey: record.projectKey ?? '',
      projectName: record.projectName ?? '',
      tasksCount: typeof record.tasksCount === 'number' ? record.tasksCount : Number(record.tasksCount ?? 0),
      totalHours: typeof record.totalHours === 'number' ? record.totalHours : Number(record.totalHours ?? 0),
      amount: typeof record.amount === 'number' ? record.amount : Number(record.amount ?? 0),
      hourlyRate: typeof record.hourlyRate === 'number' ? record.hourlyRate : Number(record.hourlyRate ?? 0),
      baseRate: typeof record.baseRate === 'number' ? record.baseRate : Number(record.baseRate ?? 0),
      rateType: record.rateType === 'month' ? 'month' : 'hour',
      status: typeof record.status === 'string'
        ? record.status
        : (record as { status?: string }).status ?? 'draft',
      includeTimesheet: Boolean(record.includeTimesheet),
      files: Array.isArray(record.files)
        ? record.files.map((file) => ({
            id: String((file as Record<string, unknown>).id ?? randomId('file')),
            label: String((file as Record<string, unknown>).label ?? 'Документ'),
            type: normalizeDocumentFileType((file as Record<string, unknown>).type),
            format: ((file as Record<string, unknown>).format as DocumentFileFormat | undefined) ?? 'pdf',
            status: typeof (file as Record<string, unknown>).status === 'string'
              ? String((file as Record<string, unknown>).status)
              : 'ready',
            url: typeof (file as Record<string, unknown>).url === 'string'
              ? String((file as Record<string, unknown>).url)
              : undefined,
          }))
        : [],
      taskSnapshots: Array.isArray(record.taskSnapshots)
        ? record.taskSnapshots.map((snapshot) => mapTaskCostSnapshot(snapshot as Partial<TaskCostSnapshot>))
        : [],
      workPackageId: record.workPackageId ?? '',
      notes: record.notes ?? undefined,
      templateId: record.templateId ?? (record as { template_id?: string }).template_id ?? null,
      performerType: typeof record.performerType === 'string'
        ? record.performerType
        : typeof (record as { performer_type?: string }).performer_type === 'string'
          ? ((record as { performer_type?: string }).performer_type as string)
          : null,
      vatIncluded: Boolean(record.vatIncluded ?? (record as { vat_included?: boolean }).vat_included ?? false),
      vatPercent: typeof record.vatPercent === 'number' ? record.vatPercent : Number((record as { vat_percent?: number }).vat_percent ?? 0),
      vatAmount: typeof record.vatAmount === 'number' ? record.vatAmount : Number((record as { vat_amount?: number }).vat_amount ?? 0),
      metadata: mapMetadata(
        (record as { metadata?: Partial<WorkPackageMetadata> | Record<string, unknown> | null }).metadata ??
          (record as { metadata_json?: Record<string, unknown> | null }).metadata_json ??
          null
      ),
      approvalStatus: (() => {
        const raw = (record.approvalStatus as string | undefined)
          ?? (record as { approval_status?: string }).approval_status
          ?? 'draft';
        const normalized = raw === 'performer_approved' ? 'pending_manager' : raw;
        if (
          normalized === 'draft' ||
          normalized === 'pending_performer' ||
          normalized === 'pending_manager' ||
          normalized === 'manager_approved' ||
          normalized === 'final'
        ) {
          return normalized;
        }
        return 'draft';
      })(),
      submittedAt: (record.submittedAt as string | null | undefined)
        ?? (record as { submitted_at?: string | null }).submitted_at
        ?? null,
      managerApprovedAt: (record.managerApprovedAt as string | null | undefined)
        ?? (record as { manager_approved_at?: string | null }).manager_approved_at
        ?? null,
      managerApprovedBy: (record.managerApprovedBy as string | null | undefined)
        ?? (record as { manager_approved_by?: string | null }).manager_approved_by
        ?? null,
      performerApprovedAt: (record.performerApprovedAt as string | null | undefined)
        ?? (record as { performer_approved_at?: string | null }).performer_approved_at
        ?? null,
      performerApprovedBy: (record.performerApprovedBy as string | null | undefined)
        ?? (record as { performer_approved_by?: string | null }).performer_approved_by
        ?? null,
      finalizedAt: (record.finalizedAt as string | null | undefined)
        ?? (record as { finalized_at?: string | null }).finalized_at
        ?? null,
      finalizedBy: (record.finalizedBy as string | null | undefined)
        ?? (record as { finalized_by?: string | null }).finalized_by
        ?? null,
      approvalNotes: (() => {
        const raw = Array.isArray(record.approvalNotes)
          ? record.approvalNotes
          : Array.isArray((record as { approval_notes?: unknown[] }).approval_notes)
            ? (record as { approval_notes?: unknown[] }).approval_notes ?? []
            : [];
        return raw
          .map((item) => {
            const source = item as Record<string, unknown>;
            const timestamp = typeof source.timestamp === 'string' ? source.timestamp : new Date().toISOString();
            return {
              timestamp,
              author: String(source.author ?? ''),
              role: String(source.role ?? ''),
              status: String(source.status ?? ''),
              message: String(source.message ?? ''),
            };
          });
      })(),
      performerAssignee: (() => {
        const source = ((record as { performerAssignee?: unknown }).performerAssignee
          ?? (record as { performer_assignee?: unknown }).performer_assignee) as Record<string, unknown> | null | undefined;
        if (!source || typeof source !== 'object') {
          return null;
        }
        const id = typeof source.id === 'string' ? source.id : null;
        if (!id) {
          return null;
        }
        const email = typeof source.email === 'string' ? source.email : '';
        const fullName = typeof source.fullName === 'string'
          ? source.fullName
          : typeof (source as { full_name?: unknown }).full_name === 'string'
            ? (source as { full_name?: string }).full_name
            : null;
        const displayName = (fullName ?? email ?? '').trim() || id;
        return {
          id,
          email,
          fullName: displayName,
        };
      })(),
      managerAssignee: (() => {
        const source = ((record as { managerAssignee?: unknown }).managerAssignee
          ?? (record as { manager_assignee?: unknown }).manager_assignee) as Record<string, unknown> | null | undefined;
        if (!source || typeof source !== 'object') {
          return null;
        }
        const id = typeof source.id === 'string' ? source.id : null;
        if (!id) {
          return null;
        }
        const email = typeof source.email === 'string' ? source.email : '';
        const fullName = typeof source.fullName === 'string'
          ? source.fullName
          : typeof (source as { full_name?: unknown }).full_name === 'string'
            ? (source as { full_name?: string }).full_name
            : null;
        const displayName = (fullName ?? email ?? '').trim() || id;
        return {
          id,
          email,
          fullName: displayName,
        };
      })(),
      sharedWithParent: Boolean(
        record.sharedWithParent
          ?? (record as { shared_with_parent?: boolean }).shared_with_parent
          ?? false
      ),
      sharedParentId: (record.sharedParentId as string | null | undefined)
        ?? (record as { shared_parent_id?: string | null }).shared_parent_id
        ?? null,
      sharedAt: (record.sharedAt as string | null | undefined)
        ?? (record as { shared_at?: string | null }).shared_at
        ?? null,
      sharedByUserId: (record.sharedByUserId as string | null | undefined)
        ?? (record as { shared_by_user_id?: string | null }).shared_by_user_id
        ?? null,
    }),
    [mapMetadata, mapTaskCostSnapshot, normalizeDocumentFileType, normalizeDocumentType]
  );

  const mapUserRecord = useCallback(
    (record: Partial<User> | Record<string, unknown>): User => {
      const source = record as Record<string, unknown>;
      const rawRole = typeof source.role === 'string' ? source.role : 'performer';
      const normalizedRole = (
        rawRole === 'admin' ||
        rawRole === 'accountant' ||
        rawRole === 'manager' ||
        rawRole === 'performer' ||
        rawRole === 'viewer'
          ? rawRole
          : 'performer'
      ) as UserRole;

      const normalizedRoles = (() => {
        const result: UserRole[] = [];
        const push = (role: unknown) => {
          if (typeof role !== 'string') {
            return;
          }
          const value = role.trim().toLowerCase();
          if (
            value !== 'admin' &&
            value !== 'accountant' &&
            value !== 'manager' &&
            value !== 'performer' &&
            value !== 'viewer'
          ) {
            return;
          }
          const typed = value as UserRole;
          if (!result.includes(typed)) {
            result.push(typed);
          }
        };

        push(normalizedRole);

        const rawRoles = source.roles;
        if (Array.isArray(rawRoles)) {
          rawRoles.forEach(push);
        }

        const rawExtraRoles = (source as { extra_roles?: unknown }).extra_roles;
        if (Array.isArray(rawExtraRoles)) {
          rawExtraRoles.forEach(push);
        }

        return result;
      })();

      const fullName = (() => {
        if (typeof source.fullName === 'string') {
          return source.fullName;
        }
        if (typeof source.full_name === 'string') {
          return source.full_name as string;
        }
        if (typeof source.email === 'string') {
          return source.email as string;
        }
        return '';
      })();

      const isActiveSource =
        typeof source.isActive === 'boolean'
          ? source.isActive
          : typeof source.is_active === 'boolean'
            ? source.is_active
            : true;

      const mappedWorkspaces: WorkspaceSummary[] = Array.isArray(source.workspaces)
        ? (source.workspaces as Array<Record<string, unknown>>)
            .map((workspace) => {
              const id = typeof workspace.id === 'string' ? workspace.id : '';
              if (!id) {
                return null;
              }
              const roleValue = typeof workspace.role === 'string' ? workspace.role : 'member';
              const role: WorkspaceRole =
                roleValue === 'owner' || roleValue === 'admin' || roleValue === 'viewer' || roleValue === 'member'
                  ? roleValue
                  : 'member';
              const kindValue = typeof workspace.kind === 'string' ? workspace.kind : 'personal';
              const kind: WorkspaceKind =
                kindValue === 'tenant' || kindValue === 'contractor' || kindValue === 'subcontractor' || kindValue === 'personal'
                  ? kindValue
                  : 'personal';
              const parentIdCandidate =
                typeof workspace.parentId === 'string'
                  ? workspace.parentId
                  : typeof (workspace as { parent_id?: unknown }).parent_id === 'string'
                    ? (workspace as { parent_id?: string }).parent_id
                    : null;
              return {
                id,
                key: typeof workspace.key === 'string' ? workspace.key : id,
                name: typeof workspace.name === 'string' ? workspace.name : id,
                color: typeof workspace.color === 'string' ? workspace.color : undefined,
                icon: typeof workspace.icon === 'string' ? workspace.icon : undefined,
                role,
                kind,
                parentId: parentIdCandidate,
              } as WorkspaceSummary;
            })
            .filter((item): item is WorkspaceSummary => Boolean(item))
        : [];

      return {
        id: typeof source.id === 'string' ? source.id : randomId('user'),
        email: typeof source.email === 'string' ? source.email : '',
        fullName,
        role: normalizedRoles[0] ?? normalizedRole,
        roles: normalizedRoles,
        isActive: Boolean(isActiveSource),
        workspaces: mappedWorkspaces,
      };
    },
    []
  );

  const sanitizeTemplatePayload = useCallback((template: Partial<Template>) => {
    const name = (template.name ?? 'Новый шаблон').trim() || 'Новый шаблон';
    const description = template.description?.trim() ?? null;
    const category = template.category?.trim() ?? null;
    return {
      name,
      type: template.type ?? 'custom',
      content: template.content ?? '',
      description: description === '' ? null : description,
      category: category === '' ? null : category,
    };
  }, []);

  const loadTemplates = useCallback(async () => {
    if (!token) {
      dispatch({ type: 'set-templates', templates: initialTemplates });
      return initialTemplates;
    }

    try {
      const response = await authorizedFetch(`${apiBaseUrl}/templates`);
      if (!response.ok) {
        throw new Error(`Failed to load templates: ${response.status}`);
      }
      const data: Template[] = await response.json();
      const normalized = data.map(normalizeServerTemplate);
      dispatch({ type: 'set-templates', templates: normalized });
      return normalized;
    } catch (error) {
      console.error('[DataContext] Unable to fetch templates from backend:', error);
      dispatch({ type: 'set-templates', templates: initialTemplates });
      return initialTemplates;
    }
  }, [apiBaseUrl, authorizedFetch, normalizeServerTemplate, token]);

  useEffect(() => {
    let cancelled = false;
    loadTemplates().catch((error) => {
      if (!cancelled) {
        console.error('[DataContext] Failed to load templates', error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadTemplates]);

  const loadDirectory = useCallback(async () => {
    if (!token) {
      return false;
    }
    try {
      const [legalResponse, individualsResponse, contractsResponse] = await Promise.all([
        authorizedFetch(`${apiBaseUrl}/directory/legal-entities`),
        authorizedFetch(`${apiBaseUrl}/directory/individuals`),
        authorizedFetch(`${apiBaseUrl}/directory/contracts`),
      ]);

      if (!legalResponse.ok || !individualsResponse.ok || !contractsResponse.ok) {
        throw new Error('Failed to load directory data');
      }

      const [legalEntitiesData, individualsData, contractsData] = await Promise.all([
        legalResponse.json(),
        individualsResponse.json(),
        contractsResponse.json(),
      ]);

      const legalEntitiesMapped = (legalEntitiesData as Array<Record<string, unknown>>).map((item) =>
        mapLegalEntity(item as Partial<LegalEntity>)
      );
      let individualsMapped = (individualsData as Array<Record<string, unknown>>).map((item) =>
        mapIndividual(item as Partial<Individual>)
      );
      const contractsMapped = (contractsData as Array<Record<string, unknown>>).map((item) =>
        mapContract(item as Partial<Contract>)
      );

      individualsMapped = await pruneIndividuals(individualsMapped, contractsMapped);

      dispatch({
        type: 'replace-directory',
        payload: {
          legalEntities: legalEntitiesMapped,
          individuals: individualsMapped,
          contracts: contractsMapped,
        },
      });

      return true;
    } catch (error) {
      console.error('[DataContext] Unable to load directory data:', error);
      return false;
    }
  }, [apiBaseUrl, authorizedFetch, mapContract, mapIndividual, mapLegalEntity, pruneIndividuals, token]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  const loadJiraProjects = useCallback(async () => {
    try {
      const response = await authorizedFetch(`${apiBaseUrl}/jira/projects`);
      if (!response.ok) {
        throw new Error(`Failed to load Jira projects: ${response.status}`);
      }
      const data: Array<Record<string, unknown>> = await response.json();
      const projects = data.map((project) =>
        mapTrackerProject({
          connectionId: project.connectionId as string | undefined,
          id: project.id as string | undefined,
          key: project.key as string | undefined,
          name: project.name as string | undefined,
          status: project.status as TrackerProject['status'] | undefined,
          lastSync: (project.lastSync as string | null | undefined) ?? null,
          tasksCount: typeof project.tasksCount === 'number' ? project.tasksCount : 0,
          tracker: (project.tracker as string) ?? 'Jira',
          connection: (project.connection as string) ?? '',
          clientId: project.clientId as string | undefined,
          contractorId: project.contractorId as string | undefined,
          contractId: project.contractId as string | undefined,
          performerIds: Array.isArray(project.performerIds)
            ? (project.performerIds as Array<string | null | undefined>).filter(Boolean) as string[]
            : undefined,
          readyForDocs: project.readyForDocs as string | undefined,
          readinessNotes: project.readinessNotes as string | undefined,
        })
      );
      dispatch({ type: 'merge-tracker-projects', projects });
      return projects;
    } catch (error) {
      console.error('[DataContext] Unable to load Jira projects:', error);
      throw (error instanceof Error ? error : new Error('Не удалось загрузить проекты трекера'));
    }
  }, [apiBaseUrl, authorizedFetch, mapTrackerProject]);

  useEffect(() => {
    loadJiraProjects().catch((error) => {
      console.error('[DataContext] Initial Jira projects load failed:', error);
    });
  }, [loadJiraProjects]);

  const loadTaskPeriods = useCallback(
    async (projectKey?: string | null) => {
      try {
        const params = new URLSearchParams();
        if (projectKey) {
          params.set('projectKey', projectKey);
        }
        const query = params.toString();
        const response = await authorizedFetch(`${apiBaseUrl}/tasks/periods${query ? `?${query}` : ''}`);
        if (!response.ok) {
          throw new Error(`Failed to load task periods: ${response.status}`);
        }
        const data: Array<Record<string, unknown>> = await response.json();
        const periods = data.map((period) => mapTaskPeriod(period as Partial<TaskPeriod>));
        dispatch({ type: 'set-task-periods', periods });
        return periods;
      } catch (error) {
        console.error('[DataContext] Unable to load task periods:', error);
        return [] as TaskPeriod[];
      }
    },
    [apiBaseUrl, authorizedFetch, mapTaskPeriod]
  );

  const loadTasks = useCallback(
    async (filters: TaskFilters = {}, options?: LoadTasksOptions) => {
      const normalizedFilters = normalizeTaskFilters(filters, lastTaskFiltersRef.current);
      const normalizeProjectKey = (value: string | null | undefined) =>
        typeof value === 'string' ? value.trim().toUpperCase() : '';
      const activeProjects = state.trackerProjects.filter((project) => project.status !== 'discovered');
      const activeProjectKeys = new Set(
        activeProjects
          .map((project) => normalizeProjectKey(project.key))
          .filter((key) => key.length > 0)
      );
      const activeProjectIds = new Set(activeProjects.map((project) => project.id));
      const shouldKeepTask = (task: Task) => {
        if (activeProjects.length === 0) {
          return false;
        }
        const normalizedKey = normalizeProjectKey(task.projectKey);
        if (normalizedKey && activeProjectKeys.has(normalizedKey)) {
          return true;
        }
        if (task.projectId && activeProjectIds.has(task.projectId)) {
          return true;
        }
        if (!normalizedKey && !task.projectId && activeProjects.length === 1) {
          return true;
        }
        return false;
      };

      try {
        const params = new URLSearchParams();
        if (normalizedFilters.projectKey) {
          params.set('projectKey', normalizedFilters.projectKey);
        }
        if (normalizedFilters.statuses.length > 0) {
          normalizedFilters.statuses.forEach((status) => params.append('statuses', status));
        }
        if (normalizedFilters.period) {
          params.set('period', normalizedFilters.period);
        }
        if (normalizedFilters.billableOnly) {
          params.set('billableOnly', 'true');
        }

        const query = params.toString();
        const response = await authorizedFetch(`${apiBaseUrl}/tasks${query ? `?${query}` : ''}`);
        if (!response.ok) {
          throw new Error(`Failed to load tasks: ${response.status}`);
        }
        const data: Array<Record<string, unknown>> = await response.json();
        const tasksMapped = data.map((task) => mapTask(task as Partial<Task>));

        const matchesFilters = (task: Task) => {
          if (normalizedFilters.projectKey && task.projectKey !== normalizedFilters.projectKey) {
            return false;
          }
          if (normalizedFilters.statuses.length > 0 && !normalizedFilters.statuses.includes(task.status)) {
            return false;
          }
          if (normalizedFilters.billableOnly && !(task.billable || task.forceIncluded)) {
            return false;
          }
          return true;
        };

        const packageLocked = state.workPackages.flatMap((pkg) => {
          if (!pkg.taskSnapshots || pkg.taskSnapshots.length === 0) {
            return [] as Task[];
          }
          if (normalizedFilters.projectKey && pkg.projectKey !== normalizedFilters.projectKey) {
            return [] as Task[];
          }
          if (normalizedFilters.period && pkg.period !== normalizedFilters.period) {
            return [] as Task[];
          }
          return pkg.taskSnapshots
            .filter((snapshot) =>
              normalizedFilters.statuses.length === 0 || normalizedFilters.statuses.includes(snapshot.status)
            )
            .filter((snapshot) =>
              !normalizedFilters.billableOnly || snapshot.billable || snapshot.forceIncluded
            )
            .map((snapshot) =>
              taskSnapshotToTask(snapshot, {
                workPackageId: pkg.id,
                contractId: pkg.contractId,
                clientId: pkg.clientId,
                contractorId: pkg.contractorId,
                projectKey: pkg.projectKey,
                projectName: pkg.projectName,
              })
            );
        });

        const carryoverLocked = tasksSnapshotRef.current.filter((task) => {
          if (!task.workPackageId) {
            return false;
          }
          if (!matchesFilters(task)) {
            return false;
          }
          return true;
        });

        const mergedTasks = (() => {
          if (carryoverLocked.length === 0 && packageLocked.length === 0) {
            return tasksMapped;
          }
          const map = new Map<string, Task>();
          for (const task of tasksMapped) {
            map.set(task.id, task);
          }
          for (const task of packageLocked) {
            if (!map.has(task.id)) {
              map.set(task.id, task);
            }
          }
          for (const task of carryoverLocked) {
            if (!map.has(task.id)) {
              map.set(task.id, task);
            }
          }
          return Array.from(map.values());
        })();
        const filteredTasks = mergedTasks.filter(shouldKeepTask);
        const newCount = (() => {
          if (typeof options?.newCountOverride === 'number') {
            return Math.max(0, Math.trunc(options.newCountOverride));
          }
          const previousFingerprints = new Set(tasksSnapshotRef.current.map((task) => taskFingerprint(task)));
          return filteredTasks.reduce((count, task) => {
            const fingerprint = taskFingerprint(task);
            return previousFingerprints.has(fingerprint) ? count : count + 1;
          }, 0);
        })();
        dispatch({ type: 'set-tasks', tasks: filteredTasks });
        bumpTasksToken(options?.acknowledge, newCount);
        lastTaskFiltersRef.current = normalizedFilters;
        return filteredTasks;
      } catch (error) {
        console.error('[DataContext] Unable to load tasks from backend:', error);
        return [] as Task[];
      }
    },
    [apiBaseUrl, authorizedFetch, bumpTasksToken, mapTask, state.trackerProjects, state.workPackages]
  );

  const loadWorkPackages = useCallback(async () => {
    try {
      const response = await authorizedFetch(`${apiBaseUrl}/work-packages`);
      if (!response.ok) {
        throw new Error(`Failed to load work packages: ${response.status}`);
      }
      const data: Array<Record<string, unknown>> = await response.json();
      const packages = data.map((item) => mapWorkPackage(item as Partial<WorkPackage>));
      dispatch({ type: 'set-work-packages', workPackages: packages });

      const currentTasks = tasksSnapshotRef.current;
      if (currentTasks.length > 0) {
        const taskToPackage = new Map<string, string>();
        packages.forEach((pkg) => {
          pkg.taskSnapshots.forEach((snapshot) => {
            if (snapshot?.id) {
              taskToPackage.set(String(snapshot.id), pkg.id);
            }
          });
        });

        let changed = false;
        const updatedTasks = currentTasks.map((task) => {
          const packageId = taskToPackage.get(task.id);
          const normalizedPackageId = packageId ?? undefined;
          const nextForceIncluded = packageId ? false : task.forceIncluded;
          if (task.workPackageId !== normalizedPackageId || task.forceIncluded !== nextForceIncluded) {
            changed = true;
            return {
              ...task,
              workPackageId: normalizedPackageId,
              forceIncluded: nextForceIncluded,
            };
          }
          return task;
        });

        if (changed) {
          dispatch({ type: 'set-tasks', tasks: updatedTasks });
        }
      }

      return packages;
    } catch (error) {
      console.error('[DataContext] Unable to load work packages:', error);
      return [] as WorkPackage[];
    }
  }, [apiBaseUrl, authorizedFetch, mapWorkPackage]);

  const releaseWorkPackageTasks = useCallback(
    async (workPackageId: string) => {
      try {
        const response = await authorizedFetch(`${apiBaseUrl}/work-packages/${workPackageId}/release`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const detail = await response.text();
          throw new Error(detail || 'Не удалось разблокировать задачи пакета');
        }

        const raw = await response.json();
        const data = mapWorkPackage(raw as Partial<WorkPackage>);

        const cleanupPrefixes: string[] = [];
        if (workPackageId.startsWith('package-v2-')) {
          const suffix = workPackageId.substring('package-v2-'.length);
          if (suffix) {
            cleanupPrefixes.push(`package:${suffix}`);
          }
        }
        if (workPackageId.startsWith('package:')) {
          cleanupPrefixes.push(workPackageId);
        }

        const updatedTasks = state.tasks.map((task) => {
          const taskPackageId = task.workPackageId ?? '';
          const matchesDirect = taskPackageId === workPackageId;
          const matchesPrefix = cleanupPrefixes.some((prefix) => taskPackageId.startsWith(prefix));
          return matchesDirect || matchesPrefix
            ? { ...task, workPackageId: undefined, forceIncluded: false }
            : task;
        });

        dispatch({ type: 'set-tasks', tasks: updatedTasks });

        if (!workPackageId.startsWith('package:')) {
          dispatch({ type: 'upsert-work-package', workPackage: data });
        }

        bumpTasksToken(true, 0);
        return data;
      } catch (error) {
        console.error('[DataContext] Unable to release work package tasks', error);
        return null;
      }
    },
    [apiBaseUrl, authorizedFetch, bumpTasksToken, mapWorkPackage, state.tasks]
  );

  const loadDocuments = useCallback(async () => {
    try {
      const response = await authorizedFetch(`${apiBaseUrl}/documents`);
      if (!response.ok) {
        throw new Error(`Failed to load documents: ${response.status}`);
      }
      const data: Array<Record<string, unknown>> = await response.json();
      const documents = data.map((item) => mapDocumentRecord(item as Partial<DocumentRecord>));
      dispatch({ type: 'set-documents', documents });

      const currentTasks = tasksSnapshotRef.current;
      if (currentTasks.length > 0) {
        const taskPackageMap = new Map<string, string>();
        documents.forEach((document) => {
          if (!document.workPackageId) {
            return;
          }
          document.taskSnapshots.forEach((snapshot) => {
            if (snapshot?.id) {
              taskPackageMap.set(String(snapshot.id), document.workPackageId);
            }
          });
        });

        if (taskPackageMap.size > 0) {
          let changed = false;
          const updatedTasks = currentTasks.map((task) => {
            const assignedPackage = taskPackageMap.get(task.id);
            if (assignedPackage && task.workPackageId !== assignedPackage) {
              changed = true;
              return { ...task, workPackageId: assignedPackage, forceIncluded: false };
            }
            return task;
          });

          if (changed) {
            dispatch({ type: 'set-tasks', tasks: updatedTasks });
          }
        }
      }
      return documents;
    } catch (error) {
      console.error('[DataContext] Unable to load documents:', error);
      return [] as DocumentRecord[];
    }
  }, [apiBaseUrl, authorizedFetch, mapDocumentRecord]);

  const shareDocumentWithParent = useCallback(
    async (documentId: string) => {
      const response = await authorizedFetch(`${apiBaseUrl}/documents/${documentId}/share`, {
        method: 'POST',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        const detail =
          payload && typeof payload === 'object' && 'detail' in payload
            ? (payload as { detail?: string }).detail
            : undefined;
        throw new Error(detail ?? 'Не удалось отправить документ наверх');
      }
      const mapped = mapDocumentRecord(payload as Partial<DocumentRecord>);
      dispatch({ type: 'upsert-document', document: mapped });
      return mapped;
    },
    [apiBaseUrl, authorizedFetch, mapDocumentRecord],
  );

  const revokeDocumentShare = useCallback(
    async (documentId: string) => {
      const response = await authorizedFetch(`${apiBaseUrl}/documents/${documentId}/share`, {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        const detail =
          payload && typeof payload === 'object' && 'detail' in payload
            ? (payload as { detail?: string }).detail
            : undefined;
        throw new Error(detail ?? 'Не удалось отозвать документ');
      }
      const mapped = mapDocumentRecord(payload as Partial<DocumentRecord>);
      dispatch({ type: 'upsert-document', document: mapped });
      return mapped;
    },
    [apiBaseUrl, authorizedFetch, mapDocumentRecord],
  );

  const loadImportLogs = useCallback(async (projectKey?: string | null) => {
    try {
      const params = new URLSearchParams();
      if (projectKey) {
        params.set('projectKey', projectKey);
      }
      const query = params.toString();
      const response = await authorizedFetch(`${apiBaseUrl}/jira/imports${query ? `?${query}` : ''}`);
      if (!response.ok) {
        throw new Error(`Failed to load import logs: ${response.status}`);
      }
      const data: Array<Record<string, unknown>> = await response.json();
      return data.map((item) => ({
        id: String(item.id ?? randomId('import')),
        connectionId: String(item.connectionId ?? ''),
        projectKey: String(item.projectKey ?? ''),
        created: typeof item.created === 'number' ? item.created : Number(item.created ?? 0),
        updated: typeof item.updated === 'number' ? item.updated : Number(item.updated ?? 0),
        skipped: typeof item.skipped === 'number' ? item.skipped : Number(item.skipped ?? 0),
        reason: item.reason ? String(item.reason) : null,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      })) as ImportLog[];
    } catch (error) {
      console.error('[DataContext] Unable to load import history:', error);
      return [] as ImportLog[];
    }
  }, [apiBaseUrl, authorizedFetch]);

  const loadUsers = useCallback(async () => {
    try {
      const response = await authorizedFetch(`${apiBaseUrl}/users`);
      if (!response.ok) {
        const message =
          response.status === 403
            ? 'Недостаточно прав для просмотра пользователей'
            : `Failed to load users: ${response.status}`;
        throw new Error(message);
      }

      const data = (await response.json()) as Array<Record<string, unknown>>;
      const users = data.map((item) => mapUserRecord(item));
      dispatch({ type: 'set-users', users });
      return users;
    } catch (error) {
      console.error('[DataContext] Unable to load users:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Не удалось загрузить пользователей');
    }
  }, [apiBaseUrl, authorizedFetch, mapUserRecord]);

  const registerUser = useCallback(
    async (payload: { email: string; password: string; fullName?: string | null; role: UserRole }) => {
      try {
        const response = await authorizedFetch(`${apiBaseUrl}/auth/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: payload.email,
            password: payload.password,
            fullName: payload.fullName ?? undefined,
            role: payload.role,
          }),
        });

        if (!response.ok) {
          let message = 'Не удалось создать пользователя';
          try {
            const detail = await response.json();
            if (detail?.detail) {
              message = typeof detail.detail === 'string' ? detail.detail : JSON.stringify(detail.detail);
            }
          } catch {
            /* ignore decode failure */
          }
          throw new Error(message);
        }

        const data = (await response.json()) as Record<string, unknown>;
        const user = mapUserRecord(data);
        dispatch({ type: 'upsert-user', user });
        return user;
      } catch (error) {
        console.error('[DataContext] Unable to register user:', error);
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('Не удалось создать пользователя');
      }
    },
    [apiBaseUrl, authorizedFetch, mapUserRecord]
  );

  const resetUserPassword = useCallback(
    async (userId: string) => {
      try {
        const response = await authorizedFetch(
          `${apiBaseUrl}/users/${encodeURIComponent(userId)}/reset-password`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          const detail = await response.json().catch(() => ({} as Record<string, unknown>));
          const message = typeof detail?.detail === 'string' ? detail.detail : 'Не удалось сбросить пароль';
          throw new Error(message);
        }

        const data = (await response.json()) as { userId?: string; password: string };
        try {
          await loadUsers();
        } catch (error) {
          console.warn('[DataContext] Unable to refresh users after password reset', error);
        }
        return {
          userId: data.userId ?? userId,
          password: data.password,
        };
      } catch (error) {
        console.error('[DataContext] Unable to reset user password:', error);
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('Не удалось сбросить пароль пользователя');
      }
    },
    [apiBaseUrl, authorizedFetch, loadUsers]
  );

  const deleteUser = useCallback(
    async (userId: string) => {
      try {
        const response = await authorizedFetch(
          `${apiBaseUrl}/users/${encodeURIComponent(userId)}`,
          {
            method: 'DELETE',
          }
        );

        if (!response.ok) {
          const detail = await response.json().catch(() => ({} as Record<string, unknown>));
          const message = typeof detail?.detail === 'string' ? detail.detail : 'Не удалось удалить пользователя';
          throw new Error(message);
        }

        dispatch({ type: 'delete-user', userId });
      } catch (error) {
        console.error('[DataContext] Unable to delete user:', error);
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('Не удалось удалить пользователя');
      }
    },
    [apiBaseUrl, authorizedFetch]
  );

  const updateUserRoles = useCallback(
    async (userId: string, roles: UserRole[]) => {
      const normalizedRoles = roles.reduce<UserRole[]>((acc, role) => {
        if (role !== 'manager' && role !== 'performer') {
          return acc;
        }
        if (!acc.includes(role)) {
          acc.push(role);
        }
        return acc;
      }, []);

      if (normalizedRoles.length === 0) {
        throw new Error('Допустимы только роли менеджера и исполнителя');
      }

      try {
        const response = await authorizedFetch(
          `${apiBaseUrl}/users/${encodeURIComponent(userId)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ roles: normalizedRoles }),
          }
        );

        if (!response.ok) {
          const detail = await response.json().catch(() => ({} as Record<string, unknown>));
          const message = typeof detail?.detail === 'string' ? detail.detail : 'Не удалось изменить роль пользователя';
          throw new Error(message);
        }

        const data = mapUserRecord(await response.json());
        dispatch({ type: 'upsert-user', user: data });
        const isManager = data.roles.includes('manager');
        const primaryRole = data.roles[0] ?? data.role;
        state.individuals
          .filter((individual) => individual.userId === data.id)
          .forEach((individual) => {
            dispatch({
              type: 'upsert-individual',
              individual: {
                ...individual,
                isApprovalManager: isManager,
                userRole: primaryRole,
              },
            });
          });
        loadDocuments().catch((error) => {
          console.warn('[DataContext] Unable to refresh documents after role change', error);
        });
        return data;
      } catch (error) {
        console.error('[DataContext] Unable to update user role:', error);
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('Не удалось изменить роль пользователя');
      }
    },
    [apiBaseUrl, authorizedFetch, mapUserRecord, state.individuals, loadDocuments]
  );

  useEffect(() => {
    loadWorkPackages();
    loadDocuments();
  }, [loadWorkPackages, loadDocuments]);

  const getLegalEntityById = (id: string) => state.legalEntities.find((entity) => entity.id === id);
  const getIndividualById = (id: string) => state.individuals.find((individual) => individual.id === id);
  const getContractById = (id: string) => state.contracts.find((contract) => contract.id === id);
  const getWorkPackageById = (id: string) => state.workPackages.find((pkg) => pkg.id === id);

  const setTaskForceInclude = useCallback(
    async (taskId: string, value: boolean) => {
      try {
        const response = await authorizedFetch(`${apiBaseUrl}/tasks/${encodeURIComponent(taskId)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ forceIncluded: value }),
        });

        if (!response.ok) {
          const detail = await response.text();
          throw new Error(detail || 'Не удалось обновить задачу');
        }

        const updated = mapTask(await response.json());
        dispatch({ type: 'upsert-task', task: updated });
        return updated;
      } catch (error) {
        console.error('[DataContext] Unable to update task forceIncluded', error);
        throw error;
      }
    },
    [apiBaseUrl, authorizedFetch, mapTask]
  );

  const toggleTaskForceInclude = useCallback(
    async (taskId: string) => {
      const current = state.tasks.find((task) => task.id === taskId);
      if (!current) {
        return;
      }
      await setTaskForceInclude(taskId, !current.forceIncluded);
    },
    [setTaskForceInclude, state.tasks]
  );

  const createWorkPackageFromTasks = (
    payload: Omit<DocumentCreationPayload, 'documentType' | 'format'> & { audience?: WorkPackageMetadata['preparedFor'] }
  ): WorkPackage | null => {
    const tasks = state.tasks.filter((task) => payload.taskIds.includes(task.id));
    if (tasks.length === 0) {
      return null;
    }

    const contract = getContractById(payload.contractId);
    const client = contract ? getLegalEntityById(contract.clientId) : undefined;
    const contractor = contract ? getIndividualById(contract.contractorId) : undefined;

    if (!contract || !client || !contractor) {
      return null;
    }

    const projectReference = tasks[0];
    const totalHoursRaw = tasks.reduce((sum, task) => sum + Math.max(task.hours ?? 0, 0), 0);
    const totalHours = Number(totalHoursRaw.toFixed(2));
    const totalAmount = Math.round(payload.hourlyRate * totalHours);

    const now = new Date();
    const workPackageId = `wp-${now.getTime()}`;

    const taskSnapshots: TaskCostSnapshot[] = tasks.map((task) => {
      const snapshot = createTaskSnapshot(task);
      const hours = snapshot.hours;
      return {
        ...snapshot,
        hourlyRate: payload.hourlyRate,
        hours,
        amount: Math.round(hours * payload.hourlyRate),
      };
    });

    const preparedFor = payload.audience ?? ['act', 'invoice', 'tax-report'];
    const tags = Array.from(
      new Set(
        [payload.period, projectReference.projectKey, ...(payload.tags ?? []), ...preparedFor, payload.includeTimesheet ? 'timesheet' : '']
          .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
          .map((tag) => tag.trim())
      )
    );

    const metadata: WorkPackageMetadata = {
      preparedFor,
      tags,
      taxCategory:
        payload.taxCategory
        ?? (preparedFor.includes('tax-report') ? 'Налоговая отчётность' : undefined),
      benefitCategory:
        payload.benefitCategory
        ?? (preparedFor.includes('benefit-report') ? 'Льготы / субсидии' : undefined),
      currency: 'RUB',
    };

    const vatIncluded = Boolean(payload.vatIncluded);
    const vatPercent = vatIncluded ? Number(payload.vatPercent ?? 20) : 0;
    const vatAmount = vatIncluded ? Math.round(totalAmount - totalAmount / (1 + vatPercent / 100)) : 0;
    const performerType = payload.performerType ?? 'individual';

    const workPackage: WorkPackage = {
      id: workPackageId,
      createdAt: now.toISOString(),
      period: payload.period,
      projectKey: projectReference.projectKey,
      projectName: projectReference.projectName,
      contractId: contract.id,
      clientId: client.id,
      contractorId: contractor.id,
      totalHours,
      totalAmount,
      hourlyRate: payload.hourlyRate,
      baseRate: payload.baseRate,
      rateType: payload.rateType,
      includeTimesheet: payload.includeTimesheet,
      currency: 'RUB',
      performerType,
      vatIncluded,
      vatPercent,
      vatAmount,
      taskSnapshots,
      metadata,
    };

    dispatch({ type: 'create-work-package', workPackage, taskIds: payload.taskIds });

    return workPackage;
  };

  const saveLegalEntity = useCallback(
    async (entity: Omit<LegalEntity, 'status'> & { status?: LegalEntity['status'] }) => {
      const normalizedVat = normalizeVatSettings(entity.defaultVatSettings, entity.defaultVatMode);
      const normalizedBasis = (entity.basis ?? '').trim();
      const basisLower = normalizedBasis.toLowerCase();
      const shouldIncludePowerOfAttorney = basisLower.includes('довер');
      const trimOrNull = (value: string | null | undefined) => {
        if (!value) {
          return null;
        }
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
      };
      const payload = {
        id: entity.id?.trim() || undefined,
        name: entity.name ?? '',
        inn: entity.inn ?? '',
        kpp: entity.kpp ?? '',
        signatory: entity.signatory ?? '',
        basis: normalizedBasis,
        powerOfAttorneyNumber: shouldIncludePowerOfAttorney ? trimOrNull(entity.powerOfAttorneyNumber) : null,
        powerOfAttorneyDate: shouldIncludePowerOfAttorney ? trimOrNull(entity.powerOfAttorneyDate) : null,
        defaultVatMode: settingsToLegacyVatMode(normalizedVat),
        defaultVatSettings: normalizedVat,
        requireInvoice: entity.requireInvoice ?? false,
      };

      const hasId = Boolean(payload.id);
      const endpoint = `${apiBaseUrl}/directory/legal-entities${hasId ? `/${payload.id}` : ''}`;
      const response = await authorizedFetch(endpoint, {
        method: hasId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || 'Не удалось сохранить юридическое лицо');
      }

      const serverEntity = mapLegalEntity(await response.json());
      const mergedEntity: LegalEntity = {
        ...serverEntity,
        defaultVatSettings: serverEntity.defaultVatSettings ?? normalizedVat,
        defaultVatMode: serverEntity.defaultVatMode ?? settingsToLegacyVatMode(normalizedVat),
        requireInvoice: serverEntity.requireInvoice ?? payload.requireInvoice,
      };
      dispatch({ type: 'upsert-legal-entity', entity: mergedEntity });
      await loadDirectory();
      return mergedEntity;
    },
    [apiBaseUrl, authorizedFetch, loadDirectory, mapLegalEntity]
  );

  const saveIndividual = useCallback(
    async (individual: Omit<Individual, 'status'> & { status?: Individual['status'] }) => {
      const payload = {
        id: individual.id?.trim() || undefined,
        name: individual.name ?? '',
        inn: individual.inn ?? '',
        passport: individual.passport ?? '',
        address: individual.address ?? '',
        email: individual.email ?? '',
        externalId: individual.externalId ?? null,
        source: individual.source ?? 'manual',
        isApprovalManager: Boolean(individual.isApprovalManager),
        approvalManagerId: individual.approvalManagerId ?? null,
      };

      const hasId = Boolean(payload.id);
      const endpoint = `${apiBaseUrl}/directory/individuals${hasId ? `/${payload.id}` : ''}`;
      const response = await authorizedFetch(endpoint, {
        method: hasId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || 'Не удалось сохранить физическое лицо');
      }

      const data = mapIndividual(await response.json());
      dispatch({ type: 'upsert-individual', individual: data });
      loadDocuments().catch((error) => {
        console.warn('[DataContext] Unable to refresh documents after saving individual', error);
      });
      await loadDirectory();
      return data;
    },
    [apiBaseUrl, authorizedFetch, loadDirectory, mapIndividual, loadDocuments]
  );

  const saveContract = useCallback(
    async (contract: Contract) => {
      const normalizedVat = normalizeVatSettings(contract.vatSettings, contract.vatMode);
      const payload = {
        id: contract.id?.trim() || undefined,
        number: contract.number ?? '',
        clientId: contract.clientId ?? '',
        contractorId: contract.contractorId ?? '',
        contractDate:
          typeof contract.contractDate === 'string' && contract.contractDate.trim().length === 0
            ? undefined
            : contract.contractDate ?? undefined,
        rate: typeof contract.rate === 'number' ? contract.rate : Number(contract.rate ?? 0),
        rateType: contract.rateType,
        currency: contract.currency ?? 'RUB',
        performerType: contract.performerType ?? 'gph',
        vatMode: settingsToLegacyVatMode(normalizedVat),
        vatSettings: normalizedVat,
        includeTimesheetByDefault: Boolean(contract.includeTimesheetByDefault),
        timesheetToggleLocked: Boolean(contract.timesheetToggleLocked),
        requireNpdReceipt: Boolean(contract.requireNpdReceipt),
        actByProjects: Boolean(contract.actByProjects),
        normHours: typeof contract.normHours === 'number' ? contract.normHours : undefined,
        templateAvrId: contract.templateAvrId ?? undefined,
        templateIprId: contract.templateIprId ?? undefined,
        templateInvoiceId: contract.templateInvoiceId ?? undefined,
        validFrom: contract.validFrom && contract.validFrom.trim() ? contract.validFrom : undefined,
        validTo: contract.validTo && contract.validTo.trim() ? contract.validTo : undefined,
        expirationReminderEnabled: contract.expirationReminderEnabled ?? false,
        expirationReminderDays:
          typeof contract.expirationReminderDays === 'number'
            ? contract.expirationReminderDays
            : contract.expirationReminderDays
              ? Number(contract.expirationReminderDays)
              : undefined,
        requireIsDocument: Boolean(contract.requireIsDocument),
        allowedTemplateIds: contract.allowedTemplateIds ?? [],
        usageActEnabled: contract.usageActEnabled ?? false,
        usageInvoiceEnabled: contract.usageInvoiceEnabled ?? false,
        usageTaxReportingEnabled: contract.usageTaxReportingEnabled ?? false,
        usageGrantsEnabled: contract.usageGrantsEnabled ?? false,
        usageInternalEnabled: contract.usageInternalEnabled ?? false,
      };

      const hasId = Boolean(payload.id);
      const endpoint = `${apiBaseUrl}/directory/contracts${hasId ? `/${payload.id}` : ''}`;
      const response = await authorizedFetch(endpoint, {
        method: hasId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || 'Не удалось сохранить контракт');
      }

      const serverContract = mapContract(await response.json());
      const mergedContract: Contract = {
        ...serverContract,
        vatSettings: serverContract.vatSettings ?? normalizedVat,
        vatMode: serverContract.vatMode ?? settingsToLegacyVatMode(normalizedVat),
      };
      dispatch({ type: 'upsert-contract', contract: mergedContract });
      await loadDirectory();
      return mergedContract;
    },
    [apiBaseUrl, authorizedFetch, loadDirectory, mapContract]
  );

  const deleteLegalEntity = useCallback(
    async (entityId: string) => {
      let response: Response | null = null;
      try {
        response = await authorizedFetch(`${apiBaseUrl}/directory/legal-entities/${encodeURIComponent(entityId)}`, {
          method: 'DELETE',
        });
      } catch (error) {
        console.warn('[DataContext] Falling back to local legal-entity deletion', error);
      }

      if (response && !response.ok && response.status !== 404) {
        const detail = await response.text();
        throw new Error(detail || 'Не удалось удалить юридическое лицо');
      }

      dispatch({ type: 'delete-legal-entity', entityId });
    },
    [apiBaseUrl, authorizedFetch]
  );

  const deleteIndividual = useCallback(
    async (individualId: string) => {
      let response: Response | null = null;
      try {
        response = await authorizedFetch(`${apiBaseUrl}/directory/individuals/${encodeURIComponent(individualId)}`, {
          method: 'DELETE',
        });
      } catch (error) {
        console.warn('[DataContext] Falling back to local individual deletion', error);
      }

      if (response && !response.ok && response.status !== 404) {
        const detail = await response.text();
        throw new Error(detail || 'Не удалось удалить физическое лицо');
      }

      dispatch({ type: 'delete-individual', individualId });
    },
    [apiBaseUrl, authorizedFetch]
  );

  const deleteContract = useCallback(
    async (contractId: string) => {
      let response: Response | null = null;
      try {
        response = await authorizedFetch(`${apiBaseUrl}/directory/contracts/${encodeURIComponent(contractId)}`, {
          method: 'DELETE',
        });
      } catch (error) {
        console.warn('[DataContext] Falling back to local contract deletion', error);
      }

      if (response && !response.ok && response.status !== 404) {
        const detail = await response.text();
        throw new Error(detail || 'Не удалось удалить контракт');
      }

      dispatch({ type: 'delete-contract', contractId });
    },
    [apiBaseUrl, authorizedFetch]
  );

  const deleteDocument = useCallback(
    async (documentId: string) => {
      const record = state.documents.find((doc) => doc.id === documentId);
      const workPackageId = record?.workPackageId;
      const snapshotIds = new Set(record?.taskSnapshots.map((snapshot) => snapshot.id));

      let response: Response | null = null;
      try {
        response = await authorizedFetch(`${apiBaseUrl}/documents/${encodeURIComponent(documentId)}`, {
          method: 'DELETE',
        });
      } catch (error) {
        console.warn('[DataContext] Falling back to local document deletion', error);
      }

      if (response && !response.ok && response.status !== 404 && response.status !== 405) {
        const detail = await response.text();
        throw new Error(detail || 'Не удалось удалить документ');
      }

      if (response && !response.ok) {
        console.warn(`[DataContext] Backend returned ${response.status} for document delete, applying local removal.`);
      }

      let releaseSucceeded = false;
      if (workPackageId) {
        try {
          const result = await releaseWorkPackageTasks(workPackageId);
          releaseSucceeded = Boolean(result);
        } catch (error) {
          console.warn('[DataContext] Unable to release work package tasks after document deletion', error);
        }
      }

      dispatch({ type: 'delete-document', documentId });

      if (workPackageId && !releaseSucceeded) {
        const remainingPackages = state.workPackages.filter((pkg) => pkg.id !== workPackageId);
        dispatch({ type: 'set-work-packages', workPackages: remainingPackages });
      }

      if (snapshotIds.size > 0 || workPackageId) {
        const cleanupPrefixes: string[] = [];
        if (workPackageId?.startsWith('package-v2-')) {
          const suffix = workPackageId.substring('package-v2-'.length);
          if (suffix) {
            cleanupPrefixes.push(`package:${suffix}`);
          }
        }
        if (workPackageId?.startsWith('package:')) {
          cleanupPrefixes.push(workPackageId);
        }

        const updatedTasks = state.tasks.map((task) => {
          const matchedBySnapshot = snapshotIds.size > 0 && snapshotIds.has(task.id);
          const taskPackageId = task.workPackageId ?? '';
          const matchedByPackage = Boolean(
            workPackageId && (taskPackageId === workPackageId || cleanupPrefixes.some((prefix) => taskPackageId.startsWith(prefix)))
          );
          return matchedBySnapshot || matchedByPackage
            ? { ...task, workPackageId: undefined, forceIncluded: false }
            : task;
        });
        dispatch({ type: 'set-tasks', tasks: updatedTasks });
      }
    },
    [apiBaseUrl, authorizedFetch, releaseWorkPackageTasks, state.documents, state.tasks, state.workPackages]
  );

  const advanceDocumentApproval = useCallback(
    async (
      documentId: string,
      action: 'submit' | 'manager_approve' | 'performer_approve' | 'finalize',
      note?: string | null
    ) => {
      const response = await authorizedFetch(
        `${apiBaseUrl}/documents/${encodeURIComponent(documentId)}/approval`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action, note: note ?? null }),
        }
      );

      if (!response.ok) {
        const detail = await response.json().catch(() => ({} as Record<string, unknown>));
        throw new Error((detail?.detail as string | undefined) ?? 'Не удалось обновить статус документа');
      }

      const data = (await response.json()) as Partial<DocumentRecord>;
      const mapped = mapDocumentRecord(data);
      dispatch({ type: 'upsert-document', document: mapped });
      return mapped;
    },
    [apiBaseUrl, authorizedFetch, mapDocumentRecord]
  );

  const addDocumentNote = useCallback(async (documentId: string, message: string) => {
    const response = await authorizedFetch(`${apiBaseUrl}/documents/${encodeURIComponent(documentId)}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => ({} as Record<string, unknown>));
      throw new Error((detail?.detail as string | undefined) ?? 'Не удалось сохранить комментарий');
    }

    const data = (await response.json()) as Partial<DocumentRecord>;
    const mapped = mapDocumentRecord(data);
    dispatch({ type: 'upsert-document', document: mapped });
    return mapped;
  }, [apiBaseUrl, authorizedFetch, mapDocumentRecord]);

  const deleteTrackerProject = useCallback(
    async (projectId: string) => {
      let response: Response | null = null;
      try {
        response = await authorizedFetch(`${apiBaseUrl}/projects/${encodeURIComponent(projectId)}`, {
          method: 'DELETE',
        });
      } catch (error) {
        console.warn('[DataContext] Falling back to local tracker-project deletion', error);
      }

      if (response && !response.ok && response.status !== 404) {
        const detail = await response.text();
        throw new Error(detail || 'Не удалось удалить проект трекера');
      }

      dispatch({ type: 'delete-tracker-project', projectId });
    },
    [apiBaseUrl, authorizedFetch]
  );

  const exportDirectoryData = () => ({
    legalEntities: state.legalEntities,
    individuals: state.individuals,
    contracts: state.contracts,
  });

  const importDirectoryData = useCallback(
    async (payload: {
      legalEntities: LegalEntity[];
      individuals: Individual[];
      contracts: Contract[];
    }) => {
      try {
        await Promise.all(
          payload.legalEntities.map((entity) =>
            saveLegalEntity({ ...entity, id: entity.id })
          )
        );
        await Promise.all(
          payload.individuals.map((individual) =>
            saveIndividual({ ...individual, id: individual.id })
          )
        );
        await Promise.all(payload.contracts.map((contract) => saveContract({ ...contract })));
        await loadDirectory();
      } catch (error) {
        console.error('[DataContext] Failed to import directory data:', error);
        throw error;
      }
    },
    [loadDirectory, saveContract, saveIndividual, saveLegalEntity]
  );

  const updateProjectLinks = useCallback(
    async ({
      projectId,
      clientId,
      contractorId,
      contractId,
      performerIds,
    }: {
      projectId: string;
      clientId?: string | null;
      contractorId?: string | null;
      contractId?: string | null;
      performerIds?: string[];
    }) => {
      const payload: Record<string, unknown> = {
        clientId: clientId ?? null,
        contractorId: contractorId ?? null,
        contractId: contractId ?? null,
      };

      if (performerIds !== undefined) {
        payload.performerIds = performerIds;
      }

      const response = await authorizedFetch(`${apiBaseUrl}/projects/${projectId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || 'Не удалось обновить проект');
      }

      const data = mapTrackerProject(await response.json());
      dispatch({ type: 'merge-tracker-projects', projects: [data] });
      return data;
    },
    [apiBaseUrl, authorizedFetch, mapTrackerProject]
  );

  const saveTemplate = useCallback(
    async (template: Partial<Template>) => {
      const payload = sanitizeTemplatePayload(template);
      const isUpdate = Boolean(template.id);
      const endpoint = `${apiBaseUrl}/templates${isUpdate ? `/${template.id}` : ''}`;

      const localTemplate: Template = {
        id: template.id ?? randomId('template'),
        name: payload.name,
        type: payload.type,
        content: payload.content,
        description: payload.description ?? undefined,
        updatedAt: new Date().toISOString(),
      };

      try {
        const response = await authorizedFetch(endpoint, {
          method: isUpdate ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Не удалось сохранить шаблон: ${response.status}`);
        }

        const saved = normalizeServerTemplate(await response.json());
        dispatch({ type: isUpdate ? 'update-template' : 'create-template', template: saved });
        return saved;
      } catch (error) {
        console.warn('Falling back to local template save', error);
        dispatch({ type: isUpdate ? 'update-template' : 'create-template', template: localTemplate });
        return localTemplate;
      }
    },
    [apiBaseUrl, authorizedFetch, normalizeServerTemplate, sanitizeTemplatePayload]
  );

  const createTemplate = useCallback(
    async (template: {
      name: string;
      type: Template['type'];
      content: string;
      category?: string | null;
      description?: string | null;
    }) => saveTemplate(template),
    [saveTemplate],
  );

  const updateTemplate = useCallback(
    async (id: string, template: Partial<Template>) => saveTemplate({ ...template, id }),
    [saveTemplate],
  );

  const deleteTemplate = useCallback(async (templateId: string) => {
    const response = await authorizedFetch(`${apiBaseUrl}/templates/${templateId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Не удалось удалить шаблон: ${response.status}`);
    }

    dispatch({ type: 'delete-template', templateId });
  }, [apiBaseUrl, authorizedFetch]);

  const connectJira = useCallback(
    async ({ baseUrl, email, apiToken }: { baseUrl: string; email: string; apiToken: string }) => {
      const response = await authorizedFetch(`${apiBaseUrl}/jira/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ baseUrl, email, apiToken }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || 'Не удалось подключиться к Jira');
      }

      const data = await response.json();
      const projects = (data.projects ?? []).map((project: Record<string, unknown>) =>
        mapTrackerProject({
          connectionId: data.connectionId as string,
          id: project.id as string | undefined,
          key: project.key as string | undefined,
          name: project.name as string | undefined,
          status: project.status as TrackerProject['status'] | undefined,
          lastSync: (project.lastSync as string | null | undefined) ?? null,
          tasksCount: typeof project.tasksCount === 'number' ? project.tasksCount : 0,
          tracker: (project.tracker as string) ?? 'Jira',
          connection: (project.connection as string) ?? baseUrl,
          clientId: project.clientId as string | undefined,
          contractorId: project.contractorId as string | undefined,
          contractId: project.contractId as string | undefined,
          performerIds: Array.isArray(project.performerIds)
            ? (project.performerIds as Array<string | null | undefined>).filter(Boolean) as string[]
            : undefined,
          readyForDocs: project.readyForDocs as string | undefined,
          readinessNotes: project.readinessNotes as string | undefined,
        })
      );
      dispatch({ type: 'merge-tracker-projects', projects });
      return {
        connectionId: data.connectionId as string,
        projects,
      };
    },
    [apiBaseUrl, authorizedFetch, mapTrackerProject]
  );

  const importJiraProject = useCallback(
    async ({ connectionId, projectKey, maxIssues }: { connectionId: string; projectKey: string; maxIssues?: number }) => {
      const response = await authorizedFetch(`${apiBaseUrl}/jira/projects/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ connectionId, projectKey, maxIssues }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || 'Не удалось загрузить задачи проекта из Jira');
      }

      const data = await response.json();
      const project = mapTrackerProject({
        connectionId: data.project?.connectionId,
        id: data.project?.id,
        key: data.project?.key,
        name: data.project?.name,
        status: (data.project?.status as TrackerProject['status'] | undefined) ?? 'connected',
        lastSync: (data.project?.lastSync as string | undefined) ?? new Date().toISOString(),
        tasksCount: typeof data.project?.tasksCount === 'number' ? data.project?.tasksCount : Array.isArray(data.tasks) ? data.tasks.length : 0,
        tracker: (data.project?.tracker as string) ?? 'Jira',
        connection: (data.project?.connection as string) ?? '',
        clientId: data.project?.clientId,
        contractorId: data.project?.contractorId,
        contractId: data.project?.contractId,
        performerIds: Array.isArray(data.project?.performerIds)
          ? (data.project?.performerIds as Array<string | null | undefined>).filter(Boolean) as string[]
          : undefined,
        readyForDocs: data.project?.readyForDocs,
        readinessNotes: data.project?.readinessNotes,
      });

      const tasks: Task[] = Array.isArray(data.tasks)
        ? data.tasks.map((task: Record<string, unknown>) => mapTask(task as Partial<Task>))
        : [];

      dispatch({ type: 'merge-tracker-projects', projects: [project] });
      dispatch({ type: 'set-tasks', tasks });

      const createdCount = Number(data.summary?.created ?? tasks.length);
      await loadDirectory();
      await loadTasks(undefined, { acknowledge: false, newCountOverride: createdCount });

      const summary: ImportSummary = {
        created: createdCount,
        updated: Number(data.summary?.updated ?? 0),
        skipped: Number(data.summary?.skipped ?? 0),
        reason: data.summary?.reason ?? null,
      };

      return { project, tasks, summary };
    },
    [apiBaseUrl, authorizedFetch, loadDirectory, loadTasks, mapTask, mapTrackerProject]
  );

  const createDocumentRecord = useCallback(
    async (payload: DocumentCreationPayload) => {
      const response = await authorizedFetch(`${apiBaseUrl}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskIds: payload.taskIds,
          contractId: payload.contractId,
          period: payload.period,
          documentType: payload.documentType,
          includeTimesheet: payload.includeTimesheet,
          format: payload.format,
          hourlyRate: payload.hourlyRate,
          baseRate: payload.baseRate,
          rateType: payload.rateType,
          workPackageId: payload.workPackageId ?? null,
          audience: payload.audience ?? null,
          templateId: payload.templateId ?? null,
          performerType: payload.performerType ?? null,
          vatIncluded: payload.vatIncluded ?? null,
          vatPercent: payload.vatPercent ?? null,
          normHours: payload.normHours ?? null,
          tags: payload.tags ?? null,
          taxCategory: payload.taxCategory ?? null,
          benefitCategory: payload.benefitCategory ?? null,
          variables: payload.variables ?? null,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || 'Не удалось сформировать документы');
      }

      const data = await response.json();
      const record = mapDocumentRecord(data.record as Partial<DocumentRecord>);
      const workPackage = mapWorkPackage(data.workPackage as Partial<WorkPackage>);

      dispatch({ type: 'upsert-work-package', workPackage });
      dispatch({ type: 'upsert-document', document: record });

      if (payload.taskIds.length > 0) {
        const taskIdSet = new Set(payload.taskIds);
        dispatch({
          type: 'set-tasks',
          tasks: state.tasks.map((task) =>
            taskIdSet.has(task.id)
              ? { ...task, workPackageId: workPackage.id, forceIncluded: false }
              : task
          ),
        });
      }

      return record;
    },
    [apiBaseUrl, authorizedFetch, mapDocumentRecord, mapWorkPackage, state.tasks]
  );

  const generatePackage = useCallback(
    async (payload: PackageCreateRequest) => {
      const response = await authorizedFetch(`${apiBaseUrl}/packages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || 'Не удалось сформировать пакет документов');
      }

      return (await response.json()) as PackageCreateResponse;
    },
    [apiBaseUrl, authorizedFetch]
  );

  const value = useMemo<DatabaseContextValue>(
    () => ({
      ...state,
      toggleTaskForceInclude,
      setTaskForceInclude,
      createDocumentRecord,
      generatePackage,
      getContractUiProfile,
      getLegalEntityById,
      getIndividualById,
      getContractById,
      getWorkPackageById,
      createWorkPackageFromTasks,
      saveLegalEntity,
      saveIndividual,
      saveContract,
      deleteLegalEntity,
      deleteIndividual,
      deleteContract,
      deleteDocument,
      advanceDocumentApproval,
      shareDocumentWithParent,
      revokeDocumentShare,
      deleteTrackerProject,
      exportDirectoryData,
      importDirectoryData,
      templates: state.templates,
      loadTemplates,
      createTemplate,
      updateTemplate,
      saveTemplate,
      deleteTemplate,
      trackerProjects: state.trackerProjects,
      connectJira,
      importJiraProject,
      loadJiraProjects,
      loadTasks,
      loadTaskPeriods,
      loadWorkPackages,
      releaseWorkPackageTasks,
      loadDocuments,
      loadImportLogs,
      loadUsers,
      registerUser,
      resetUserPassword,
      deleteUser,
      updateUserRoles,
      updateProjectLinks,
      addDocumentNote,
      tasksLoadToken,
      acknowledgedTasksLoadToken,
      tasksLoadDelta: latestTasksDelta,
    }),
    [
      state,
      toggleTaskForceInclude,
      setTaskForceInclude,
      createDocumentRecord,
      generatePackage,
      getContractUiProfile,
      getLegalEntityById,
      getIndividualById,
      getContractById,
      getWorkPackageById,
      createWorkPackageFromTasks,
      deleteTemplate,
      saveTemplate,
      connectJira,
      importJiraProject,
      loadJiraProjects,
      loadTasks,
      loadTaskPeriods,
      loadWorkPackages,
      releaseWorkPackageTasks,
      loadDocuments,
      loadImportLogs,
      loadUsers,
      registerUser,
      resetUserPassword,
      deleteUser,
      updateUserRoles,
      saveLegalEntity,
      saveIndividual,
      saveContract,
      deleteLegalEntity,
      deleteIndividual,
      deleteContract,
      deleteDocument,
      advanceDocumentApproval,
      shareDocumentWithParent,
      revokeDocumentShare,
      deleteTrackerProject,
      importDirectoryData,
      updateProjectLinks,
      addDocumentNote,
      tasksLoadToken,
      acknowledgedTasksLoadToken,
      latestTasksDelta,
    ]
  );

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
};

export const useDatabase = () => {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabase must be used within DatabaseProvider');
  }
  return context;
};
