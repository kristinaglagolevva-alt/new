import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import {
  FileText,
  Download,
  Search,
  Filter,
  Calendar,
  User,
  Files,
  Trash2,
  Send,
  ShieldCheck,
  CheckCircle2,
  ArrowUpRight,
  Undo2,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { DocumentGenerationDialog } from "./document-generation-dialog";
import type { DirectoryFocus, NavigationPage } from "../types/navigation";
import { useDatabase } from "../data/DataContext";
import { useAuth } from "../data/AuthContext";
import { useWorkspace } from "../data/WorkspaceContext";
import type { DocumentRecord, WorkPackage, UserRole } from "../data/models";
import { Textarea } from "./ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Label } from "./ui/label";

const ROLE_PRIORITY: UserRole[] = ['admin', 'accountant', 'manager', 'performer', 'viewer'];

const formatCurrency = (value: number) => `${value.toLocaleString('ru-RU')} ₽`;

const formatHours = (hours: number) => `${Number.isFinite(hours) ? hours.toFixed(1) : '0.0'} ч`;

const AUDIENCE_LABELS: Record<string, string> = {
  act: 'Акт',
  invoice: 'Счет',
  'tax-report': 'Налоговая отчетность',
  'benefit-report': 'Льготы',
  internal: 'Внутренний учет',
};

const PERFORMER_TYPE_LABELS: Record<string, string> = {
  individual: 'Физическое лицо (ГПХ)',
  self_employed: 'Самозанятый (НПД)',
  sole_proprietor: 'Индивидуальный предприниматель',
  employee: 'Штатный сотрудник',
};

const DOCUMENT_TYPE_LABELS: Record<DocumentRecord['type'], string> = {
  act: 'Акт',
  invoice: 'Счет',
  package: 'Пакет документов',
  timesheet: 'Табель',
  custom: 'Кастомный',
};

const APPROVAL_STATUS_LABELS: Record<DocumentRecord['approvalStatus'], string> = {
  draft: 'Черновик',
  pending_performer: 'На подтверждении исполнителя',
  pending_manager: 'На согласовании менеджера',
  rejected_performer: 'Отклонено исполнителем',
  rejected_manager: 'Отклонено менеджером',
  manager_approved: 'Согласовано менеджером',
  final: 'Завершено',
};

const APPROVAL_STATUS_OPTIONS = (
  Object.entries(APPROVAL_STATUS_LABELS) as Array<[DocumentRecord['approvalStatus'], string]>
).map(([value, label]) => ({ value, label }));

const FilterIconButton = forwardRef<HTMLButtonElement, { active: boolean; label: string }>(
  ({ active, label, ...props }, ref) => (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className={`h-6 w-6 p-0 ${active ? 'text-blue-600 hover:text-blue-700' : 'text-muted-foreground hover:text-foreground'}`}
      aria-label={label}
      {...props}
    >
      <Filter className="w-4 h-4" />
    </Button>
  ),
);

FilterIconButton.displayName = 'FilterIconButton';

const formatPerformerType = (value: string | null | undefined) => {
  if (!value) {
    return '';
  }
  return PERFORMER_TYPE_LABELS[value] ?? value;
};

const parseContentDispositionFilename = (header: string | null): string | null => {
  if (!header) {
    return null;
  }
  const match = header.match(/filename\*?=([^;]+)/i);
  if (!match) {
    return null;
  }
  let value = match[1].trim();
  if (value.startsWith("UTF-8''") || value.startsWith("utf-8''")) {
    value = decodeURIComponent(value.slice(7));
  }
  if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith('\'') && value.endsWith('\''))) {
    value = value.slice(1, -1);
  }
  return value || null;
};

const lookupAdjustmentValue = (record: DocumentRecord, key: string): string | undefined => {
  const adjustments = record.metadata?.adjustments;
  if (!Array.isArray(adjustments)) {
    return undefined;
  }
  for (const raw of adjustments) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const item = raw as Record<string, unknown>;
    const candidateKey = typeof item.key === 'string' ? item.key : typeof item.label === 'string' ? item.label : undefined;
    if (candidateKey === key) {
      const value = item.value;
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
  }
  return undefined;
};

const toCsv = (records: DocumentRecord[]): string => {
  const header = [
    'id',
    'period',
    'type',
    'projectKey',
    'tasksCount',
    'totalHours',
    'amount',
    'status',
    'createdAt',
    'performerType',
    'vatAmount',
  ];

  const rows = records.map((record) => [
    record.id,
    record.period,
    record.type,
    record.projectKey,
    record.tasksCount.toString(),
    record.totalHours.toString(),
    record.amount.toString(),
    record.status,
    record.createdAt,
    formatPerformerType(record.performerType) || '',
    record.vatAmount.toString(),
  ]);

  return [header, ...rows]
    .map((line) => line.map((value) => `"${value.replace(/"/g, '""')}"`).join(','))
    .join('\n');
};

const workPackageToCsv = (packages: WorkPackage[]): string => {
  const header = [
    'id',
    'period',
    'projectKey',
    'contractId',
    'totalHours',
    'totalAmount',
    'hourlyRate',
    'rateType',
    'includeTimesheet',
    'preparedFor',
    'tags',
    'taxCategory',
    'benefitCategory',
    'performerType',
    'performerId',
    'vatAmount',
  ];

  const rows = packages.map((pkg) => [
    pkg.id,
    pkg.period,
    pkg.projectKey,
    pkg.contractId,
    pkg.totalHours.toString(),
    pkg.totalAmount.toString(),
    pkg.hourlyRate.toString(),
    pkg.rateType,
    pkg.includeTimesheet ? 'true' : 'false',
    pkg.metadata.preparedFor.join('|'),
    pkg.metadata.tags.join('|'),
    pkg.metadata.taxCategory ?? '',
    pkg.metadata.benefitCategory ?? '',
    formatPerformerType(pkg.performerType) || '',
    pkg.performerId ?? '',
    pkg.vatAmount.toString(),
  ]);

  return [header, ...rows]
    .map((line) => line.map((value) => `"${value.replace(/"/g, '""')}"`).join(','))
    .join('\n');
};

interface DocumentsPageProps {
  onNavigate?: (page: NavigationPage) => void;
  onDirectoryFocusRequested?: (focus: DirectoryFocus) => void;
}

export function DocumentsPage({ onNavigate, onDirectoryFocusRequested }: DocumentsPageProps) {
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [showGenerationDialog, setShowGenerationDialog] = useState(false);
  const [detailsRecord, setDetailsRecord] = useState<DocumentRecord | null>(null);
  const [activeTab, setActiveTab] = useState<'documents' | 'exports'>('documents');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilters, setStatusFilters] = useState<DocumentRecord['approvalStatus'][]>([]);
  const [performerFilters, setPerformerFilters] = useState<string[]>([]);
  const [clientFilters, setClientFilters] = useState<string[]>([]);
  const [workspaceFilters, setWorkspaceFilters] = useState<string[]>([]);
  const [contractFilters, setContractFilters] = useState<string[]>([]);
  const [periodFilters, setPeriodFilters] = useState<string[]>([]);
  const apiBaseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || 'http://localhost:8000';
  const { user, token } = useAuth();
  const { currentWorkspace } = useWorkspace();

  const effectiveRoles = useMemo(() => {
    const set = new Set<UserRole>();
    if (user?.role && ROLE_PRIORITY.includes(user.role)) {
      set.add(user.role);
    }
    (user?.roles ?? []).forEach((role) => {
      if (role && ROLE_PRIORITY.includes(role)) {
        set.add(role);
      }
    });
    return set;
  }, [user?.role, user?.roles]);

  const workspaceHasParent = Boolean(currentWorkspace?.parentId);
  const currentWorkspaceId = currentWorkspace?.id ?? null;

  const isSystemAdmin = effectiveRoles.has('admin');
  const isAccountant = effectiveRoles.has('accountant');
  const isAdminLike = isSystemAdmin || isAccountant;
  const isManager = effectiveRoles.has('manager');
  const isPerformer = effectiveRoles.has('performer');

  const {
    documents,
    tasks,
    workPackages,
    getLegalEntityById,
    getIndividualById,
    getContractById,
    getWorkPackageById,
    releaseWorkPackageTasks,
    deleteDocument,
    loadTasks,
    advanceDocumentApproval,
    addDocumentNote,
    shareDocumentWithParent,
    revokeDocumentShare,
    loadDocuments,
    loadWorkPackages,
  } = useDatabase();

  const handleStatusFilterChange = useCallback(
    (status: DocumentRecord['approvalStatus'], checked: boolean) => {
      setStatusFilters((prev) => {
        if (checked) {
          return prev.includes(status) ? prev : [...prev, status];
        }
        return prev.filter((value) => value !== status);
      });
    },
    [],
  );

  const handlePerformerToggle = useCallback((performerId: string, checked: boolean) => {
    setPerformerFilters((prev) => {
      if (checked) {
        return prev.includes(performerId) ? prev : [...prev, performerId];
      }
      return prev.filter((value) => value !== performerId);
    });
  }, []);

  const handleClientToggle = useCallback((clientId: string, checked: boolean) => {
    setClientFilters((prev) => {
      if (checked) {
        return prev.includes(clientId) ? prev : [...prev, clientId];
      }
      return prev.filter((value) => value !== clientId);
    });
  }, []);

  const handleWorkspaceToggle = useCallback((workspaceId: string, checked: boolean) => {
    setWorkspaceFilters((prev) => {
      if (checked) {
        return prev.includes(workspaceId) ? prev : [...prev, workspaceId];
      }
      return prev.filter((value) => value !== workspaceId);
    });
  }, []);

  const handleContractToggle = useCallback((contractId: string, checked: boolean) => {
    setContractFilters((prev) => {
      if (checked) {
        return prev.includes(contractId) ? prev : [...prev, contractId];
      }
      return prev.filter((value) => value !== contractId);
    });
  }, []);

  const handlePeriodToggle = useCallback((period: string, checked: boolean) => {
    setPeriodFilters((prev) => {
      if (checked) {
        return prev.includes(period) ? prev : [...prev, period];
      }
      return prev.filter((value) => value !== period);
    });
  }, []);

  const clearFilters = useCallback(() => {
    setStatusFilters([]);
    setPerformerFilters([]);
    setClientFilters([]);
    setWorkspaceFilters([]);
    setContractFilters([]);
    setPeriodFilters([]);
  }, []);

  const activeFiltersCount =
    statusFilters.length +
    performerFilters.length +
    clientFilters.length +
    workspaceFilters.length +
    contractFilters.length +
    periodFilters.length;
  const hasActiveFilters = activeFiltersCount > 0;

  const normalizedBaseUrl = useMemo(() => apiBaseUrl.replace(/\/+$/, ''), [apiBaseUrl]);

  const resolveDownloadUrl = useCallback(
    (fileUrl: string) => {
      if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
        return fileUrl;
      }
      return `${normalizedBaseUrl}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
    },
    [normalizedBaseUrl],
  );

  const downloadFromBackend = useCallback(
    async (fileUrl: string, fallbackName: string) => {
      const url = resolveDownloadUrl(fileUrl);
      try {
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) {
          throw new Error(`Download failed with status ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        if (!buffer.byteLength) {
          throw new Error('Получен пустой файл');
        }
        const contentType =
          response.headers.get('content-type') ??
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const blob = new Blob([buffer], { type: contentType });
        const link = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        const headerName = parseContentDispositionFilename(response.headers.get('content-disposition'));
        link.href = objectUrl;
        link.download = headerName ?? fallbackName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      } catch (error) {
        console.error('[DocumentsPage] Failed to download file', error);
        throw error;
      }
    },
    [resolveDownloadUrl, token],
  );

  const [approvalLoading, setApprovalLoading] = useState<string | null>(null);
  const [releasedPackages, setReleasedPackages] = useState<string[]>([]);
  const [isReleasing, setIsReleasing] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteSavingId, setNoteSavingId] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!detailsRecord) {
      return;
    }
    setNoteDrafts((prev) => (prev[detailsRecord.id] === undefined ? { ...prev, [detailsRecord.id]: '' } : prev));
  }, [detailsRecord]);

  const currentUserId = user?.id ?? null;
  const currentUserEmail = user?.email?.toLowerCase() ?? null;

  const assigneeMatchesCurrentUser = useCallback(
    (assignee: DocumentRecord['performerAssignee'] | DocumentRecord['managerAssignee'] | null | undefined) => {
      if (!assignee) {
        return false;
      }
      if (currentUserId && assignee.id === currentUserId) {
        return true;
      }
      if (currentUserEmail && assignee.email?.toLowerCase() === currentUserEmail) {
        return true;
      }
      return false;
    },
    [currentUserEmail, currentUserId],
  );

  const sortedDocuments = useMemo(
    () => [...documents].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [documents]
  );

  const canSubmit = isAdminLike || isManager;
  const canManagerApprove = isAdminLike || isManager;
  const canPerformerApprove = isAdminLike || isPerformer;
  const canFinalize = isAdminLike || isManager;
  const canViewExports = isAdminLike;

  useEffect(() => {
    if (!canViewExports && activeTab === 'exports') {
      setActiveTab('documents');
    }
  }, [canViewExports, activeTab]);

  useEffect(() => {
    loadDocuments().catch((error) => console.error('[DocumentsPage] Initial documents load failed', error));
    loadWorkPackages().catch((error) => console.error('[DocumentsPage] Initial work packages load failed', error));
  }, [loadDocuments, loadWorkPackages]);

  const getApprovalBadgeClass = (status: DocumentRecord['approvalStatus']) => {
    switch (status) {
      case 'draft':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'pending_performer':
        return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'pending_manager':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'manager_approved':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'rejected_performer':
      case 'rejected_manager':
        return 'bg-rose-100 text-rose-800 border-rose-200';
      case 'final':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const determineAvailableActions = (record: DocumentRecord) => {
    const actions: Array<{
      action: 'submit' | 'manager_approve' | 'performer_approve' | 'finalize';
      label: string;
      icon: JSX.Element;
      disabled?: boolean;
      disabledReason?: string;
    }> = [];

    const performerAssigned = Boolean(record.performerAssignee && (record.performerAssignee.fullName || record.performerAssignee.email));
    const managerAssigned = Boolean(record.managerAssignee && (record.managerAssignee.fullName || record.managerAssignee.email));
    const isPerformerAssignee = assigneeMatchesCurrentUser(record.performerAssignee);
    const isManagerAssignee = assigneeMatchesCurrentUser(record.managerAssignee);

    if (
      ['draft', 'rejected_performer', 'rejected_manager'].includes(record.approvalStatus)
      && canSubmit
    ) {
      const requiresPerformer = record.approvalStatus !== 'rejected_manager';
      const requiresManager = record.approvalStatus === 'rejected_manager';
      const missingPerformer = requiresPerformer && !performerAssigned;
      const missingManager = requiresManager && !managerAssigned;
      actions.push({
        action: 'submit',
        label: record.approvalStatus === 'draft' ? 'Отправить исполнителю' : 'Отправить повторно',
        icon: <Send className="w-4 h-4 mr-1" />,
        disabled: missingPerformer || missingManager,
        disabledReason: missingPerformer
          ? 'Назначьте исполнителя'
          : missingManager
            ? 'Назначьте менеджера'
            : undefined,
      });
    }

    if (record.approvalStatus === 'pending_performer' && canPerformerApprove) {
      const allowed = isAdminLike || isPerformerAssignee;
      actions.push({
        action: 'performer_approve',
        label: 'Подтвердить',
        icon: <CheckCircle2 className="w-4 h-4 mr-1" />,
        disabled: !allowed,
        disabledReason: allowed ? undefined : 'Доступно назначенному исполнителю',
      });
    }

    if (record.approvalStatus === 'pending_manager' && canManagerApprove) {
      const allowed = isAdminLike || (managerAssigned && isManagerAssignee);
      const missingManager = !managerAssigned && !isAdminLike;
      actions.push({
        action: 'manager_approve',
        label: 'Согласовать',
        icon: <ShieldCheck className="w-4 h-4 mr-1" />,
        disabled: !allowed,
        disabledReason: missingManager
          ? 'Назначьте менеджера'
          : allowed
            ? undefined
            : 'Доступно назначенному менеджеру',
      });
    }

    if (
      canFinalize
      && record.approvalStatus !== 'final'
      && (record.approvalStatus === 'manager_approved' || isAdminLike)
    ) {
      actions.push({
        action: 'finalize',
        label: 'Завершить',
        icon: <CheckCircle2 className="w-4 h-4 mr-1" />,
      });
    }

    return actions;
  };

  const formatDateTime = (value?: string | null) => (value ? new Date(value).toLocaleString('ru-RU') : '—');

  const handleApprovalAction = async (
    record: DocumentRecord,
    action: 'submit' | 'manager_approve' | 'performer_approve' | 'finalize'
  ) => {
    const key = `${record.id}:${action}`;
    setApprovalLoading(key);
    const draftNote = noteDrafts[record.id]?.trim();
    try {
      const updated = await advanceDocumentApproval(record.id, action, draftNote || undefined);
      if (detailsRecord && detailsRecord.id === record.id) {
        setDetailsRecord(updated);
      }
      if (draftNote) {
        setNoteDrafts((prev) => ({ ...prev, [record.id]: '' }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось обновить статус документа';
      window.alert(message);
    } finally {
      setApprovalLoading((current) => (current === key ? null : current));
    }
  };

  const handleShareToggle = async (record: DocumentRecord) => {
    setShareLoading(record.id);
    try {
      const updated = record.sharedWithParent
        ? await revokeDocumentShare(record.id)
        : await shareDocumentWithParent(record.id);
      if (detailsRecord && detailsRecord.id === record.id) {
        setDetailsRecord(updated);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось изменить доступ к документу';
      window.alert(message);
    } finally {
      setShareLoading((current) => (current === record.id ? null : current));
    }
  };

  const readyTaskIds = useMemo(
    () =>
      tasks
        .filter((task) => (task.billable || task.forceIncluded) && !task.workPackageId && Math.max(task.hours ?? 0) > 0)
        .map((task) => task.id),
    [tasks]
  );

  const selectedSet = useMemo(() => new Set(selectedDocs), [selectedDocs]);

  const updateNoteDraft = (docId: string, value: string) => {
    setNoteDrafts((prev) => ({ ...prev, [docId]: value }));
  };

  const handleSaveNote = async (documentId: string) => {
    const draft = noteDrafts[documentId]?.trim();
    if (!draft) {
      window.alert('Введите текст комментария');
      return;
    }

    setNoteSavingId(documentId);
    try {
      const updated = await addDocumentNote(documentId, draft);
      setNoteDrafts((prev) => ({ ...prev, [documentId]: '' }));
      if (detailsRecord && detailsRecord.id === documentId) {
        setDetailsRecord(updated);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось сохранить комментарий';
      window.alert(message);
    } finally {
      setNoteSavingId((current) => (current === documentId ? null : current));
    }
  };

  const detailsWorkPackage = detailsRecord ? getWorkPackageById(detailsRecord.workPackageId) : null;
  const detailTaskSnapshots = detailsRecord ? (detailsWorkPackage?.taskSnapshots ?? detailsRecord.taskSnapshots) : [];
  const detailMetadata = detailsWorkPackage?.metadata ?? detailsRecord?.metadata ?? null;
  const detailPreparedFor = detailMetadata?.preparedFor ?? [];
  const detailTags = detailMetadata?.tags ?? [];
  const detailAdjustments = detailMetadata?.adjustments ?? [];
  const detailPerformerType = detailsRecord ? formatPerformerType(detailsRecord.performerType) || '—' : '—';
  const detailVatAmount = detailsRecord?.vatAmount ?? 0;
  const detailOwnedByCurrent = detailsRecord && currentWorkspaceId ? detailsRecord.workspaceId === currentWorkspaceId : false;
  const detailsShareReady = detailsRecord ? (detailsRecord.approvalStatus === 'manager_approved' || detailsRecord.approvalStatus === 'final') : false;
  const detailWorkspaceLabel = detailsRecord
    ? detailOwnedByCurrent
      ? currentWorkspace?.name ?? detailsRecord.workspaceName ?? 'Текущий контур'
      : detailsRecord.workspaceName ?? 'Контур'
    : '—';

  const scopedDocuments = useMemo(() => {
    if (isAdminLike) {
      return sortedDocuments;
    }

    return sortedDocuments.filter((doc) => {
      const performerMatch = assigneeMatchesCurrentUser(doc.performerAssignee);
      const managerMatch = assigneeMatchesCurrentUser(doc.managerAssignee);
      return (isPerformer && performerMatch) || (isManager && managerMatch);
    });
  }, [assigneeMatchesCurrentUser, isAdminLike, isManager, isPerformer, sortedDocuments]);

  const performerOptions = useMemo(() => {
    const map = new Map<string, { label: string; description?: string }>();
    scopedDocuments.forEach((doc) => {
      const performerId = doc.contractorId?.trim();
      if (!performerId || map.has(performerId)) {
        return;
      }
      const individual = getIndividualById(doc.contractorId);
      const label =
        individual?.name?.trim() ||
        lookupAdjustmentValue(doc, 'performerName') ||
        doc.performerAssignee?.fullName ||
        doc.performerAssignee?.email ||
        '—';
      const description =
        individual?.email?.trim() ||
        doc.performerAssignee?.email?.trim() ||
        (doc.performerAssignee?.fullName?.trim() && doc.performerAssignee?.email?.trim()
          ? doc.performerAssignee.email.trim()
          : undefined);
      map.set(performerId, {
        label,
        description,
      });
    });
    return Array.from(map.entries())
      .map(([value, info]) => ({ value, ...info }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [scopedDocuments, getIndividualById]);

  const clientOptions = useMemo(() => {
    const map = new Map<string, { label: string }>();
    scopedDocuments.forEach((doc) => {
      const clientId = doc.clientId?.trim();
      if (!clientId || map.has(clientId)) {
        return;
      }
      const entity = getLegalEntityById(doc.clientId);
      const label =
        entity?.name?.trim() ||
        lookupAdjustmentValue(doc, 'clientName') ||
        doc.projectName ||
        '—';
      map.set(clientId, { label });
    });
    return Array.from(map.entries())
      .map(([value, info]) => ({ value, ...info }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [scopedDocuments, getLegalEntityById]);

  const workspaceOptions = useMemo(() => {
    const map = new Map<string, { label: string }>();
    scopedDocuments.forEach((doc) => {
      const workspaceId = doc.workspaceId?.trim();
      if (!workspaceId || map.has(workspaceId)) {
        return;
      }
      const label =
        doc.workspaceName?.trim() ||
        (workspaceId === currentWorkspace?.id ? currentWorkspace.name : null) ||
        'Контур';
      map.set(workspaceId, { label });
    });
    return Array.from(map.entries())
      .map(([value, info]) => ({ value, ...info }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [scopedDocuments, currentWorkspace]);

  const contractOptions = useMemo(() => {
    const map = new Map<string, { label: string }>();
    scopedDocuments.forEach((doc) => {
      const contractId = doc.contractId?.trim();
      if (!contractId || map.has(contractId)) {
        return;
      }
      const contract = getContractById(doc.contractId);
      const label =
        contract?.number?.trim() ||
        lookupAdjustmentValue(doc, 'contractNumber') ||
        contractId;
      map.set(contractId, { label });
    });
    return Array.from(map.entries())
      .map(([value, info]) => ({ value, ...info }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [scopedDocuments, getContractById]);

  const periodOptions = useMemo(() => {
    const set = new Set<string>();
    scopedDocuments.forEach((doc) => {
      const period = doc.period?.trim();
      if (period) {
        set.add(period);
      }
    });
    return Array.from(set)
      .map((value) => ({ value, label: value }))
      .sort((a, b) => b.value.localeCompare(a.value, 'ru'));
  }, [scopedDocuments]);

  useEffect(() => {
    setPerformerFilters((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const available = new Set(performerOptions.map((option) => option.value));
      const filtered = prev.filter((value) => available.has(value));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [performerOptions]);

  useEffect(() => {
    setClientFilters((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const available = new Set(clientOptions.map((option) => option.value));
      const filtered = prev.filter((value) => available.has(value));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [clientOptions]);

  useEffect(() => {
    setWorkspaceFilters((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const available = new Set(workspaceOptions.map((option) => option.value));
      const filtered = prev.filter((value) => available.has(value));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [workspaceOptions]);

  useEffect(() => {
    setContractFilters((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const available = new Set(contractOptions.map((option) => option.value));
      const filtered = prev.filter((value) => available.has(value));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [contractOptions]);

  useEffect(() => {
    setPeriodFilters((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const available = new Set(periodOptions.map((option) => option.value));
      const filtered = prev.filter((value) => available.has(value));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [periodOptions]);

  const performerLabelById = useMemo(() => {
    const map = new Map<string, string>();
    performerOptions.forEach((option) => map.set(option.value, option.label));
    return map;
  }, [performerOptions]);

  const clientLabelById = useMemo(() => {
    const map = new Map<string, string>();
    clientOptions.forEach((option) => map.set(option.value, option.label));
    return map;
  }, [clientOptions]);

  const workspaceLabelById = useMemo(() => {
    const map = new Map<string, string>();
    workspaceOptions.forEach((option) => map.set(option.value, option.label));
    return map;
  }, [workspaceOptions]);

  const contractLabelById = useMemo(() => {
    const map = new Map<string, string>();
    contractOptions.forEach((option) => map.set(option.value, option.label));
    return map;
  }, [contractOptions]);

  const visibleDocuments = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const hasSearch = normalizedSearch.length > 0;
    const statusSet = statusFilters.length > 0 ? new Set(statusFilters) : null;
    const performerSet = performerFilters.length > 0 ? new Set(performerFilters) : null;
    const clientSet = clientFilters.length > 0 ? new Set(clientFilters) : null;
    const workspaceSet = workspaceFilters.length > 0 ? new Set(workspaceFilters) : null;
    const contractSet = contractFilters.length > 0 ? new Set(contractFilters) : null;
    const periodSet = periodFilters.length > 0 ? new Set(periodFilters) : null;

    if (
      !hasSearch &&
      !statusSet &&
      !performerSet &&
      !clientSet &&
      !workspaceSet &&
      !contractSet &&
      !periodSet
    ) {
      return scopedDocuments;
    }

    return scopedDocuments.filter((doc) => {
      if (statusSet && !statusSet.has(doc.approvalStatus)) {
        return false;
      }

      if (performerSet) {
        const performerId = doc.contractorId?.trim();
        if (!performerId || !performerSet.has(performerId)) {
          return false;
        }
      }

      if (clientSet) {
        const clientId = doc.clientId?.trim();
        if (!clientId || !clientSet.has(clientId)) {
          return false;
        }
      }

      if (workspaceSet) {
        const workspaceId = doc.workspaceId?.trim();
        if (!workspaceId || !workspaceSet.has(workspaceId)) {
          return false;
        }
      }

      if (contractSet) {
        const contractId = doc.contractId?.trim();
        if (!contractId || !contractSet.has(contractId)) {
          return false;
        }
      }

      if (periodSet) {
        const periodValue = doc.period?.trim();
        if (!periodValue || !periodSet.has(periodValue)) {
          return false;
        }
      }

      if (!hasSearch) {
        return true;
      }

      const performerName =
        getIndividualById(doc.contractorId)?.name ??
        lookupAdjustmentValue(doc, 'performerName') ??
        '';
      const clientName =
        getLegalEntityById(doc.clientId)?.name ??
        lookupAdjustmentValue(doc, 'clientName') ??
        '';
      const contractNumber =
        getContractById(doc.contractId)?.number ??
        lookupAdjustmentValue(doc, 'contractNumber') ??
        '';
      const approvalLabel = APPROVAL_STATUS_LABELS[doc.approvalStatus] ?? doc.approvalStatus;
      const documentTypeLabel = DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type;

      const haystacks = [
        doc.id,
        doc.projectKey,
        doc.projectName,
        doc.period,
        doc.status,
        approvalLabel,
        documentTypeLabel,
        doc.workspaceName,
        performerName,
        clientName,
        contractNumber,
      ];

      return haystacks.some(
        (value) => typeof value === 'string' && value.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [
    scopedDocuments,
    searchTerm,
    statusFilters,
    performerFilters,
    clientFilters,
    workspaceFilters,
    contractFilters,
    periodFilters,
    getContractById,
    getIndividualById,
    getLegalEntityById,
  ]);

  const storageStats = useMemo(() => {
    const sourceDocuments = isAdminLike ? documents : scopedDocuments;

    const relevantPackageIds = new Set<string>();
    sourceDocuments.forEach((doc) => {
      if (doc.workPackageId) {
        relevantPackageIds.add(doc.workPackageId);
      }
    });

    const relevantPackages = isAdminLike
      ? workPackages
      : workPackages.filter((pkg) => relevantPackageIds.has(pkg.id));

    const totalHours = sourceDocuments.reduce(
      (sum, doc) => sum + (Number.isFinite(doc.totalHours) ? doc.totalHours : 0),
      0
    );
    const totalAmount = sourceDocuments.reduce(
      (sum, doc) => sum + (Number.isFinite(doc.amount) ? doc.amount : 0),
      0
    );

    return {
      packages: relevantPackages.length,
      documents: sourceDocuments.length,
      totalHours,
      totalAmount,
    };
  }, [documents, scopedDocuments, workPackages, isAdminLike]);

  const selectedCount = useMemo(
    () => visibleDocuments.reduce((acc, doc) => (selectedSet.has(doc.id) ? acc + 1 : acc), 0),
    [selectedSet, visibleDocuments]
  );

  useEffect(() => {
    setSelectedDocs((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const visibleIds = new Set(visibleDocuments.map((doc) => doc.id));
      const filtered = prev.filter((id) => visibleIds.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [visibleDocuments]);

  const handleSelectDoc = (docId: string) => {
    setSelectedDocs((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const handleSelectAll = () => {
    const visibleIds = visibleDocuments.map((doc) => doc.id);
    setSelectedDocs((prev) => {
      const allSelected = visibleIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...prev, ...visibleIds]));
    });
  };

  const exportRecords = (records: DocumentRecord[], format: 'json' | 'csv', suffix: string) => {
    if (records.length === 0) {
      return;
    }
    const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
    const fileName = `paid-works-${suffix}-${timestamp}.${format}`;

    if (format === 'json') {
      const enriched = records.map((record) => {
        const workPackage = getWorkPackageById(record.workPackageId);
        return workPackage ? { ...record, workPackage } : record;
      });
      downloadFile(JSON.stringify(enriched, null, 2), 'application/json', fileName);
    } else {
      downloadFile(toCsv(records), 'text/csv;charset=utf-8;', fileName);
    }
  };

  const exportAll = (format: 'json' | 'csv') => exportRecords(visibleDocuments, format, 'all');
  const exportSelected = (format: 'json' | 'csv') =>
    exportRecords(visibleDocuments.filter((record) => selectedSet.has(record.id)), format, 'selected');

  const downloadDocumentFile = async (record: DocumentRecord, file?: DocumentRecord['files'][number]) => {
    const targetFile =
      file ??
      record.files.find((item) => ['docx', 'doc'].includes(item.format.toLowerCase())) ??
      record.files[0];
    if (!targetFile || !targetFile.url) {
      console.warn('[DocumentsPage] No downloadable document file found');
      return;
    }
    const safeLabel = targetFile.label.replace(/\s+/g, '-').toLowerCase() || 'document';
    const fallbackName = `${record.id}-${safeLabel}.docx`;
    await downloadFromBackend(targetFile.url, fallbackName);
  };

  const exportWorkPackages = (packages: WorkPackage[], format: 'json' | 'csv', suffix: string) => {
    if (packages.length === 0) {
      return;
    }
    const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
    const fileName = `work-packages-${suffix}-${timestamp}.${format}`;

    if (format === 'json') {
      downloadFile(JSON.stringify(packages, null, 2), 'application/json', fileName);
    } else {
      downloadFile(workPackageToCsv(packages), 'text/csv;charset=utf-8;', fileName);
    }
  };

  const handleDownloadFile = async (record: DocumentRecord, file: DocumentRecord['files'][number]) => {
    if (!file.url) {
      console.warn('[DocumentsPage] File URL is not available');
      return;
    }
    const safeLabel = file.label.replace(/\s+/g, '-').toLowerCase() || 'document';
    const fallbackName = `${record.id}-${safeLabel}.docx`;
    await downloadFromBackend(file.url, fallbackName);
  };

  const handleDeleteDocument = async (record: DocumentRecord) => {
    const labelParts = [record.projectName?.trim(), record.period?.trim()].filter(Boolean);
    const label = labelParts.length > 0 ? labelParts.join(' • ') : record.id;
    if (!window.confirm(`Удалить документ «${label}»?`)) {
      return;
    }
    try {
      await deleteDocument(record.id);
      setSelectedDocs((prev) => prev.filter((id) => id !== record.id));
      setDetailsRecord((current) => (current?.id === record.id ? null : current));
    } catch (error) {
      console.error('Failed to delete document', error);
      window.alert('Не удалось удалить документ. Попробуйте ещё раз.');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'documents' | 'exports')} className="space-y-6">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="documents">Документы</TabsTrigger>
          {canViewExports ? <TabsTrigger value="exports">Выгрузки</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="documents" className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h1>Документы</h1>
              <div className="text-sm text-muted-foreground">Управление → Документы</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canSubmit && (
                <Button
                  variant="outline"
                  onClick={() => setShowGenerationDialog(true)}
                  disabled={readyTaskIds.length === 0}
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  Подготовить пакет
                </Button>
              )}
              {canViewExports ? (
                <>
                  <Button variant="outline" onClick={() => exportAll('json')}>
                    <Download className="w-4 h-4 mr-2" />
                    Скачать JSON
                  </Button>
                  <Button variant="outline" onClick={() => exportAll('csv')}>
                    <Download className="w-4 h-4 mr-2" />
                    Скачать CSV
                  </Button>
                </>
              ) : null}
          </div>
        </div>

          <div className="space-y-2">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Поиск по проекту, периоду или статусу"
                  className="pl-10"
                />
              </div>
              <div className="text-sm text-muted-foreground md:whitespace-nowrap">
                {hasActiveFilters ? `Фильтры: ${activeFiltersCount} · ` : ''}
                Выбрано: {selectedCount}
              </div>
            </div>
            {hasActiveFilters ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {performerFilters.map((id) => (
                  <Badge key={`performer-${id}`} variant="outline" className="flex items-center gap-1">
                    Исполнитель: {performerLabelById.get(id) ?? id}
                  </Badge>
                ))}
                {clientFilters.map((id) => (
                  <Badge key={`client-${id}`} variant="outline" className="flex items-center gap-1">
                    Заказчик: {clientLabelById.get(id) ?? id}
                  </Badge>
                ))}
                {workspaceFilters.map((id) => (
                  <Badge key={`workspace-${id}`} variant="outline" className="flex items-center gap-1">
                    Контур: {workspaceLabelById.get(id) ?? id}
                  </Badge>
                ))}
                {contractFilters.map((id) => (
                  <Badge key={`contract-${id}`} variant="outline" className="flex items-center gap-1">
                    Контракт: {contractLabelById.get(id) ?? id}
                  </Badge>
                ))}
                {periodFilters.map((value) => (
                  <Badge key={`period-${value}`} variant="outline" className="flex items-center gap-1">
                    Период: {value}
                  </Badge>
                ))}
                {statusFilters.map((status) => (
                  <Badge key={`status-${status}`} variant="outline" className="flex items-center gap-1">
                    {APPROVAL_STATUS_LABELS[status] ?? status}
                  </Badge>
                ))}
                <Button variant="link" size="sm" className="h-auto px-0" onClick={clearFilters}>
                  Сбросить все
                </Button>
              </div>
            ) : null}
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedCount > 0 && selectedCount === visibleDocuments.length}
                        onCheckedChange={handleSelectAll}
                        disabled={visibleDocuments.length === 0}
                      />
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Исполнитель
                        <Popover>
                          <PopoverTrigger asChild>
                            <FilterIconButton
                              active={performerFilters.length > 0}
                              label="Фильтр по исполнителю"
                            />
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-72" sideOffset={8}>
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="px-2"
                                onClick={() => setPerformerFilters(performerOptions.map((option) => option.value))}
                                disabled={performerOptions.length === 0}
                              >
                                Выбрать всех
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setPerformerFilters([])}>
                                Сбросить
                              </Button>
                            </div>
                            <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
                              {performerOptions.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  Исполнители появятся после загрузки документов.
                                </p>
                              ) : (
                                performerOptions.map((option, index) => {
                                  const id = `performer-filter-${index}`;
                                  return (
                                    <div key={option.value} className="flex items-start gap-2">
                                      <Checkbox
                                        id={id}
                                        checked={performerFilters.includes(option.value)}
                                        onCheckedChange={(checked) => handlePerformerToggle(option.value, Boolean(checked))}
                                      />
                                      <Label htmlFor={id} className="text-sm leading-snug cursor-pointer">
                                        <span className="block">{option.label}</span>
                                        {option.description ? (
                                          <span className="block text-xs text-muted-foreground">{option.description}</span>
                                        ) : null}
                                      </Label>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Заказчик
                        <Popover>
                          <PopoverTrigger asChild>
                            <FilterIconButton
                              active={clientFilters.length > 0}
                              label="Фильтр по заказчику"
                            />
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-72" sideOffset={8}>
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="px-2"
                                onClick={() => setClientFilters(clientOptions.map((option) => option.value))}
                                disabled={clientOptions.length === 0}
                              >
                                Выбрать всех
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setClientFilters([])}>
                                Сбросить
                              </Button>
                            </div>
                            <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
                              {clientOptions.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  Заказчики появятся после загрузки документов.
                                </p>
                              ) : (
                                clientOptions.map((option, index) => {
                                  const id = `client-filter-${index}`;
                                  return (
                                    <div key={option.value} className="flex items-start gap-2">
                                      <Checkbox
                                        id={id}
                                        checked={clientFilters.includes(option.value)}
                                        onCheckedChange={(checked) => handleClientToggle(option.value, Boolean(checked))}
                                      />
                                      <Label htmlFor={id} className="text-sm leading-snug cursor-pointer">
                                        {option.label}
                                      </Label>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Контур
                        <Popover>
                          <PopoverTrigger asChild>
                            <FilterIconButton
                              active={workspaceFilters.length > 0}
                              label="Фильтр по контуру"
                            />
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-64" sideOffset={8}>
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="px-2"
                                onClick={() => setWorkspaceFilters(workspaceOptions.map((option) => option.value))}
                                disabled={workspaceOptions.length === 0}
                              >
                                Выбрать все
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setWorkspaceFilters([])}>
                                Сбросить
                              </Button>
                            </div>
                            <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
                              {workspaceOptions.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  Контуры появятся после загрузки документов.
                                </p>
                              ) : (
                                workspaceOptions.map((option, index) => {
                                  const id = `workspace-filter-${index}`;
                                  return (
                                    <div key={option.value} className="flex items-start gap-2">
                                      <Checkbox
                                        id={id}
                                        checked={workspaceFilters.includes(option.value)}
                                        onCheckedChange={(checked) => handleWorkspaceToggle(option.value, Boolean(checked))}
                                      />
                                      <Label htmlFor={id} className="text-sm leading-snug cursor-pointer">
                                        {option.label}
                                      </Label>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Период
                        <Popover>
                          <PopoverTrigger asChild>
                            <FilterIconButton
                              active={periodFilters.length > 0}
                              label="Фильтр по периоду"
                            />
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-56" sideOffset={8}>
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="px-2"
                                onClick={() => setPeriodFilters(periodOptions.map((option) => option.value))}
                                disabled={periodOptions.length === 0}
                              >
                                Выбрать все
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setPeriodFilters([])}>
                                Сбросить
                              </Button>
                            </div>
                            <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
                              {periodOptions.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  Периоды появятся после загрузки документов.
                                </p>
                              ) : (
                                periodOptions.map((option, index) => {
                                  const id = `period-filter-${index}`;
                                  return (
                                    <div key={option.value} className="flex items-start gap-2">
                                      <Checkbox
                                        id={id}
                                        checked={periodFilters.includes(option.value)}
                                        onCheckedChange={(checked) => handlePeriodToggle(option.value, Boolean(checked))}
                                      />
                                      <Label htmlFor={id} className="text-sm leading-snug cursor-pointer">
                                        {option.label}
                                      </Label>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Задачи
                        <Filter className="w-4 h-4" />
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Сумма
                        <Filter className="w-4 h-4" />
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Файлы
                        <Filter className="w-4 h-4" />
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Согласование
                        <Popover>
                          <PopoverTrigger asChild>
                            <FilterIconButton
                              active={statusFilters.length > 0}
                              label="Фильтр по статусу согласования"
                            />
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-64" sideOffset={8}>
                            <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
                              {APPROVAL_STATUS_OPTIONS.map((option, index) => {
                                const id = `status-filter-${index}`;
                                return (
                                  <div key={option.value} className="flex items-start gap-2">
                                    <Checkbox
                                      id={id}
                                      checked={statusFilters.includes(option.value)}
                                      onCheckedChange={(checked) =>
                                        handleStatusFilterChange(option.value, checked === true)
                                      }
                                    />
                                    <Label htmlFor={id} className="text-sm leading-snug cursor-pointer">
                                      {option.label}
                                    </Label>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex justify-end mt-3">
                              <Button variant="outline" size="sm" onClick={() => setStatusFilters([])}>
                                Сбросить
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Контракт
                        <Popover>
                          <PopoverTrigger asChild>
                            <FilterIconButton
                              active={contractFilters.length > 0}
                              label="Фильтр по контракту"
                            />
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-64" sideOffset={8}>
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="px-2"
                                onClick={() => setContractFilters(contractOptions.map((option) => option.value))}
                                disabled={contractOptions.length === 0}
                              >
                                Выбрать все
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setContractFilters([])}>
                                Сбросить
                              </Button>
                            </div>
                            <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
                              {contractOptions.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  Контракты появятся после загрузки документов.
                                </p>
                              ) : (
                                contractOptions.map((option, index) => {
                                  const id = `contract-filter-${index}`;
                                  return (
                                    <div key={option.value} className="flex items-start gap-2">
                                      <Checkbox
                                        id={id}
                                        checked={contractFilters.includes(option.value)}
                                        onCheckedChange={(checked) => handleContractToggle(option.value, Boolean(checked))}
                                      />
                                      <Label htmlFor={id} className="text-sm leading-snug cursor-pointer">
                                        {option.label}
                                      </Label>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>
                    <TableHead className="w-28 pr-4 text-right">
                      <span className="sr-only">Действия</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleDocuments.map((doc) => {
                  const executor =
                    getIndividualById(doc.contractorId)?.name
                    ?? lookupAdjustmentValue(doc, 'performerName')
                    ?? '—';
                  const client =
                    getLegalEntityById(doc.clientId)?.name
                    ?? lookupAdjustmentValue(doc, 'clientName')
                    ?? '—';
                  const contract =
                    getContractById(doc.contractId)?.number
                    ?? lookupAdjustmentValue(doc, 'contractNumber')
                    ?? '—';
                  const isOwnedByCurrentWorkspace = currentWorkspaceId ? doc.workspaceId === currentWorkspaceId : true;
                  const shareReady = doc.approvalStatus === 'manager_approved' || doc.approvalStatus === 'final';
                  const canShareUpwards = isOwnedByCurrentWorkspace && workspaceHasParent;
                  const workspaceLabel = isOwnedByCurrentWorkspace
                    ? (doc.workspaceName ?? currentWorkspace?.name ?? 'Текущий контур')
                    : doc.workspaceName ?? 'Контур';
                  const isShareInProgress = shareLoading === doc.id;
                  const showStatusIndicator = ['rejected_performer', 'rejected_manager', 'manager_approved']
                    .includes(doc.approvalStatus);
                  const performerAssignee = doc.performerAssignee ?? null;
                  const managerAssignee = doc.managerAssignee ?? null;
                  const performerAssigneeName = performerAssignee?.fullName || performerAssignee?.email || null;
                  const managerAssigneeName = managerAssignee?.fullName || managerAssignee?.email || null;
                  const performerProfile = getIndividualById(doc.contractorId) ?? null;
                  const managerProfile = performerProfile?.approvalManagerId
                    ? getIndividualById(performerProfile.approvalManagerId)
                    : null;

                  const openPerformerDirectory = () => {
                    onDirectoryFocusRequested?.({ section: 'individual', performerId: doc.contractorId });
                  };

                  const openManagerDirectory = () => {
                    const targetId = managerProfile?.id ?? doc.contractorId;
                    onDirectoryFocusRequested?.({ section: 'individual', performerId: targetId });
                  };

                  return (
                    <TableRow key={doc.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedSet.has(doc.id)}
                            onCheckedChange={() => handleSelectDoc(doc.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-2">
                            <div className="flex items-start gap-2">
                              <User className="w-4 h-4 mt-1" />
                              <div>
                                <div className="font-medium text-foreground">{executor}</div>
                                <div className="text-xs text-muted-foreground">по договору</div>
                              </div>
                              {showStatusIndicator ? (
                                <span className="inline-flex h-2 w-2 rounded-full bg-blue-500" aria-hidden="true" />
                              ) : null}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {performerAssigneeName ? (
                                <span>
                                  Аккаунт исполнителя: {' '}
                                  <span className="font-medium text-foreground">{performerAssigneeName}</span>
                                </span>
                              ) : (
                                <span className="text-red-600">Аккаунт исполнителя не назначен</span>
                              )}
                            </div>
                            {!performerAssigneeName ? (
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                                  Требует настройки
                                </Badge>
                                {onDirectoryFocusRequested ? (
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="h-auto px-0"
                                    onClick={openPerformerDirectory}
                                  >
                                    Настроить в справочнике
                                  </Button>
                                ) : null}
                                <div className="basis-full">
                                  Добавьте email и пользователя у физлица, чтобы документы отправлялись автоматически.
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            {client}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{workspaceLabel}</span>
                              {!isOwnedByCurrentWorkspace ? (
                                <Badge variant="outline" className="text-xs">Получено</Badge>
                              ) : doc.sharedWithParent ? (
                                <Badge variant="outline" className="text-xs">Отправлено</Badge>
                              ) : null}
                            </div>
                            {doc.sharedWithParent ? (
                              isOwnedByCurrentWorkspace ? (
                                <span className="text-xs text-muted-foreground">
                                  Отправлено родителю {formatDateTime(doc.sharedAt)}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Получено из нижестоящего контура
                                </span>
                              )
                            ) : canShareUpwards ? (
                              <span className="text-xs text-muted-foreground">Не отправлено выше</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>{doc.period}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">{doc.tasksCount}</span>
                            <span className="text-sm text-muted-foreground">{formatHours(doc.totalHours)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            {formatCurrency(doc.amount)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{doc.files.length}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-2">
                            <Badge variant="outline" className={getApprovalBadgeClass(doc.approvalStatus)}>
                              {APPROVAL_STATUS_LABELS[doc.approvalStatus]}
                            </Badge>
                            <div className="text-xs text-muted-foreground">
                              {managerAssigneeName ? (
                                <span>
                                  Менеджер: {' '}
                                  <span className="font-medium text-foreground">{managerAssigneeName}</span>
                                </span>
                              ) : managerProfile?.name ? (
                                <span className="text-amber-600">Менеджер {managerProfile.name} (нет аккаунта)</span>
                              ) : (
                                <span className="text-amber-600">Менеджер не назначен</span>
                              )}
                            </div>
                            {!managerAssigneeName ? (
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                                  Назначьте менеджера
                                </Badge>
                                {onDirectoryFocusRequested ? (
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="h-auto px-0"
                                    onClick={openManagerDirectory}
                                  >
                                    Настроить в справочнике
                                  </Button>
                                ) : null}
                                <div className="basis-full">
                                  Укажите согласующего менеджера в карточке исполнителя.
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={contract === '—' ? 'destructive' : 'default'}>{contract}</Badge>
                        </TableCell>
                        <TableCell className="pr-4">
                          <div className="flex items-center justify-end gap-1">
                            {determineAvailableActions(doc).map(({ action, label, icon, disabled, disabledReason }) => {
                              const key = `${doc.id}:${action}`;
                              return (
                                <Button
                                  key={action}
                                  variant="outline"
                                  size="sm"
                                  disabled={disabled || approvalLoading === key}
                                  title={disabledReason}
                                  onClick={() => handleApprovalAction(doc, action)}
                                >
                                  {approvalLoading === key ? (
                                    <span className="w-4 h-4 mr-1 animate-spin border-2 border-primary border-r-transparent rounded-full" />
                                  ) : (
                                    icon
                                  )}
                                  {label}
                                </Button>
                              );
                            })}
                            {canShareUpwards ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isShareInProgress || !shareReady}
                                title={shareReady ? undefined : 'Отправить можно после согласования менеджером'}
                                onClick={() => handleShareToggle(doc)}
                              >
                                {isShareInProgress ? (
                                  <span className="w-4 h-4 mr-1 animate-spin border-2 border-primary border-r-transparent rounded-full" />
                                ) : doc.sharedWithParent ? (
                                  <>
                                    <Undo2 className="w-4 h-4 mr-1" />
                                    Отозвать
                                  </>
                                ) : (
                                  <>
                                    <ArrowUpRight className="w-4 h-4 mr-1" />
                                    Отправить
                                  </>
                                )}
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDetailsRecord(doc)}
                              aria-label="Подробности документа"
                            >
                              <Files className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => downloadDocumentFile(doc)}
                              aria-label="Скачать пакет документов"
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                            {isSystemAdmin ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteDocument(doc)}
                                aria-label="Удалить документ"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {visibleDocuments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="py-12 text-center text-sm text-muted-foreground">
                        {isAdminLike
                          ? 'Пока нет сформированных документов. Подготовьте акт из раздела «Задачи».'
                          : 'Для вас пока нет назначенных документов.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{selectedCount} из {visibleDocuments.length} выбрано.</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">Previous</Button>
              <Button variant="outline" size="sm">Next</Button>
            </div>
          </div>

          {canViewExports ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Files className="w-5 h-5" />
                  Хранилище оплаченных работ
                </CardTitle>
                <CardDescription>После фиксации акта данные замораживаются и доступны для повторных выгрузок</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Пакетов работ</div>
                    <div className="text-2xl font-medium">{storageStats.packages}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Документов</div>
                    <div className="text-2xl font-medium">{storageStats.documents}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Зафиксировано часов</div>
                    <div className="text-2xl font-medium">{formatHours(storageStats.totalHours)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Сумма</div>
                    <div className="text-2xl font-medium">{formatCurrency(storageStats.totalAmount)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {canViewExports ? (
          <TabsContent value="exports" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="w-5 h-5" />
                  Экспорт документов
                </CardTitle>
                <CardDescription>Выгрузите данные для налоговой или внутренней отчётности</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => exportAll('json')}>
                  <Download className="w-4 h-4 mr-2" />
                  Документы JSON
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportAll('csv')}>
                  <Download className="w-4 h-4 mr-2" />
                  Документы CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportSelected('json')}
                  disabled={selectedCount === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Выбранные JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportSelected('csv')}
                  disabled={selectedCount === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Выбранные CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportWorkPackages(workPackages, 'json', 'all')}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Пакеты JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportWorkPackages(workPackages, 'csv', 'all')}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Пакеты CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportWorkPackages(workPackages, 'json', 'selected')}
                  disabled={selectedCount === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Выбранные пакеты JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportWorkPackages(workPackages, 'csv', 'selected')}
                  disabled={selectedCount === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Выбранные пакеты CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportWorkPackages(workPackages, 'json', 'database')}
                  disabled={workPackages.length === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Скачать JSON БД
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportWorkPackages(workPackages, 'csv', 'database')}
                  disabled={workPackages.length === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Скачать БД
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

      </Tabs>

      <Dialog open={Boolean(detailsRecord)} onOpenChange={(open) => (!open ? setDetailsRecord(null) : undefined)}>
        <DialogContent
          className="!flex flex-col gap-4 !max-w-[44rem] w-[min(44rem,calc(100vw-2rem))] max-h-[calc(100vh-4rem)] sm:max-h-[calc(100vh-6rem)] overflow-hidden min-h-0 !translate-y-[-48%] sm:!translate-y-[-44%]"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>Документ {detailsRecord?.id}</DialogTitle>
            <DialogDescription>
              {detailsRecord?.projectName} • {detailsRecord?.period}
            </DialogDescription>
          </DialogHeader>

          {detailsRecord && (
            <div className="flex-1 min-h-0 space-y-4 overflow-y-auto pr-2 pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-muted-foreground">
                <div>Период: {detailsRecord.period}</div>
                <div>Проект: {detailsRecord.projectName} ({detailsRecord.projectKey})</div>
                <div>Контур: {detailWorkspaceLabel}</div>
                <div>
                  Отправка родителю:{' '}
                  {detailsRecord.sharedWithParent
                    ? `активна (${formatDateTime(detailsRecord.sharedAt)})`
                    : detailOwnedByCurrent
                      ? 'не выполнена'
                      : 'получено от нижестоящего контура'}
                </div>
                {detailOwnedByCurrent && workspaceHasParent ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={shareLoading === detailsRecord.id || !detailsShareReady}
                    title={detailsShareReady ? undefined : 'Отправить можно после согласования менеджером'}
                    onClick={() => handleShareToggle(detailsRecord)}
                  >
                    {shareLoading === detailsRecord.id ? (
                      <span className="w-4 h-4 mr-2 animate-spin border-2 border-primary border-r-transparent rounded-full" />
                    ) : detailsRecord.sharedWithParent ? (
                      <>
                        <Undo2 className="w-4 h-4 mr-2" />
                        Отозвать отправку
                      </>
                    ) : (
                      <>
                        <ArrowUpRight className="w-4 h-4 mr-2" />
                        Отправить родителю
                      </>
                    )}
                  </Button>
                ) : null}
                <div>Согласование: {APPROVAL_STATUS_LABELS[detailsRecord.approvalStatus]}</div>
                <div>Статус документа: {detailsRecord.status}</div>
                <div>Создан: {new Date(detailsRecord.createdAt).toLocaleString('ru-RU')}</div>
                <div>Часовая ставка: {detailsRecord.hourlyRate.toLocaleString()} ₽</div>
                <div>Сумма: {formatCurrency(detailsRecord.amount)}</div>
                <div>Тип исполнителя: {detailPerformerType}</div>
                <div>В т.ч. НДС: {formatCurrency(detailVatAmount)}</div>
                <div className="md:col-span-2">
                  <div className="flex flex-col gap-1 text-xs">
                    <span>Отправлен менеджеру: {formatDateTime(detailsRecord.submittedAt)}</span>
                    <span>
                      Согласован менеджером: {formatDateTime(detailsRecord.managerApprovedAt)}
                      {detailsRecord.managerApprovedBy ? ` (${detailsRecord.managerApprovedBy})` : ''}
                    </span>
                    <span>
                      Подтверждён исполнителем: {formatDateTime(detailsRecord.performerApprovedAt)}
                      {detailsRecord.performerApprovedBy ? ` (${detailsRecord.performerApprovedBy})` : ''}
                    </span>
                    <span>
                      Завершён: {formatDateTime(detailsRecord.finalizedAt)}
                      {detailsRecord.finalizedBy ? ` (${detailsRecord.finalizedBy})` : ''}
                    </span>
                  </div>
                </div>
                {detailPreparedFor.length > 0 && (
                  <div className="md:col-span-2">
                    Назначение: {detailPreparedFor.map((item) => AUDIENCE_LABELS[item] ?? item).join(', ')}
                  </div>
                )}
                {detailTags.length > 0 && (
                  <div className="md:col-span-2">Теги: {detailTags.join(', ')}</div>
                )}
                {detailAdjustments.length > 0 && (
                  <div className="md:col-span-2 space-y-1">
                    <div>Корректировки:</div>
                    {detailAdjustments.map((item, index) => {
                      const key = typeof item.type === 'string' ? item.type : `adjustment-${index}`;
                      const description = typeof item.description === 'string' && item.description.trim().length > 0
                        ? item.description
                        : typeof (item as Record<string, unknown>).label === 'string'
                          ? ((item as Record<string, unknown>).label as string)
                          : typeof (item as Record<string, unknown>).key === 'string'
                            ? ((item as Record<string, unknown>).key as string)
                            : `Запись ${index + 1}`;
                      const amountSource = (item as Record<string, unknown>).amount ?? (item as Record<string, unknown>).value;
                      const amount = typeof amountSource === 'number'
                        ? amountSource.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })
                        : typeof amountSource === 'string'
                          ? amountSource
                          : '—';
                      return (
                        <div key={`${key}-${index}`} className="text-xs text-muted-foreground">
                          {description} — {amount}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Файлы</CardTitle>
                  <CardDescription>
                    {detailsRecord.files.length > 0
                      ? 'Скачайте готовые документы'
                      : 'Файлы будут доступны после генерации'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Комментарии согласования</div>
                    <div className="max-h-48 overflow-y-auto border rounded-md p-3 bg-muted/40 space-y-2 text-xs">
                      {detailsRecord.approvalNotes.length > 0 ? (
                        detailsRecord.approvalNotes.map((noteEntry, index) => (
                          <div key={`${noteEntry.timestamp}-${index}`} className="space-y-1">
                            <div className="flex flex-col gap-1 min-[420px]:flex-row min-[420px]:items-baseline min-[420px]:justify-between">
                              <span className="font-medium">{noteEntry.author}</span>
                              <span className="text-muted-foreground">{new Date(noteEntry.timestamp).toLocaleString('ru-RU')}</span>
                            </div>
                            <div className="text-muted-foreground break-words">
                              {noteEntry.message}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-muted-foreground">Комментарии пока не добавлялись.</div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Textarea
                      value={noteDrafts[detailsRecord.id] ?? ''}
                      onChange={(event) => updateNoteDraft(detailsRecord.id, event.target.value)}
                      placeholder="Добавьте комментарий (необязательно)"
                      rows={3}
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
                      <span>
                        Комментарий можно сохранить отдельно или просто выполнить действие — он прикрепится к истории.
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={noteSavingId === detailsRecord.id || !(noteDrafts[detailsRecord.id]?.trim())}
                          onClick={() => handleSaveNote(detailsRecord.id)}
                        >
                          {noteSavingId === detailsRecord.id ? 'Сохраняем…' : 'Сохранить'}
                        </Button>
                        {noteDrafts[detailsRecord.id]?.trim() ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => updateNoteDraft(detailsRecord.id, '')}
                          >
                            Очистить
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {detailsRecord.workPackageId && !releasedPackages.includes(detailsRecord.workPackageId) ? (
                    <Button
                      className="w-full sm:w-auto"
                      variant="outline"
                      size="sm"
                      disabled={isReleasing}
                      onClick={async () => {
                        setIsReleasing(true);
                        try {
                          const result = await releaseWorkPackageTasks(detailsRecord.workPackageId);
                          if (result) {
                            void loadTasks();
                            setReleasedPackages((prev) =>
                              prev.includes(detailsRecord.workPackageId)
                                ? prev
                                : [...prev, detailsRecord.workPackageId]
                            );
                          } else {
                            window.alert('Не удалось разблокировать задачи. Попробуйте ещё раз.');
                          }
                        } catch (error) {
                          console.error('[DocumentsPage] Failed to release work package', error);
                          window.alert('Не удалось разблокировать задачи. Попробуйте ещё раз.');
                        } finally {
                          setIsReleasing(false);
                        }
                      }}
                    >
                      Сделать задачи доступными снова
                    </Button>
                  ) : null}
                  {detailsRecord.files.length > 0 ? (
                    detailsRecord.files.map((file) => (
                      <div
                        key={file.id}
                        className="flex flex-col gap-3 rounded border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex-1">
                          <div className="font-medium">{file.label}</div>
                          <div className="text-xs text-muted-foreground uppercase">
                            {file.format} · {file.status}
                          </div>
                        </div>
                        <Button
                          className="w-full sm:w-auto"
                          variant="outline"
                          size="sm"
                          onClick={() => downloadDocumentFile(detailsRecord, file)}
                          disabled={!file.url}
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Скачать
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Файлы ещё не сформированы для этого документа.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Состав работ</CardTitle>
                  <CardDescription>
                    Часов: {formatHours(detailsRecord.totalHours)} • Задач: {detailsRecord.tasksCount}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  {detailTaskSnapshots.length > 0 ? (
                    <Table className="min-w-[640px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Задача</TableHead>
                          <TableHead className="whitespace-normal">Название</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead>Часы</TableHead>
                          <TableHead>Ставка</TableHead>
                          <TableHead>Сумма</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailTaskSnapshots.map((task) => (
                          <TableRow key={task.id}>
                            <TableCell>
                              <span className="font-mono text-sm">{task.key}</span>
                            </TableCell>
                            <TableCell className="whitespace-normal break-words">{task.title}</TableCell>
                            <TableCell>{task.status}</TableCell>
                            <TableCell>{formatHours(task.hours)}</TableCell>
                            <TableCell>{'hourlyRate' in task ? `${task.hourlyRate.toLocaleString()} ₽` : '—'}</TableCell>
                            <TableCell>{'amount' in task ? formatCurrency(task.amount) : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-4 text-sm text-muted-foreground">
                      Снимок задач не был сохранён для этого документа.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <DocumentGenerationDialog
        open={showGenerationDialog}
        onOpenChange={setShowGenerationDialog}
        taskIds={readyTaskIds}
        onSuccess={(record) => {
          setShowGenerationDialog(false);
          if (record?.id) {
            setSelectedDocs([record.id]);
          }
          setActiveTab('documents');
        }}
        onDirectoryFocusRequested={(focus) => {
          setShowGenerationDialog(false);
          onDirectoryFocusRequested?.(focus);
          onNavigate?.('directory');
        }}
      />
    </div>
  );
}
