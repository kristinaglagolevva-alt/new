import { forwardRef, useEffect, useMemo, useState } from 'react';
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Search, Filter, Clock, AlertTriangle, CalendarRange, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { useDatabase } from "../data/DataContext";
import { DocumentGenerationDialog } from "./document-generation-dialog";
import type { TaskStatus, TaskPeriod, Task } from "../data/models";
import { Calendar } from "./ui/calendar";
import type { DateRange } from "react-day-picker";
import type { DirectoryFocus, NavigationPage } from "../types/navigation";

const formatDuration = (hours: number) => {
  const totalMinutes = Math.round((hours || 0) * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = Math.abs(totalMinutes % 60);
  if (wholeHours > 0 && minutes > 0) {
    return `${wholeHours} ч ${minutes} мин`;
  }
  if (wholeHours > 0) {
    return `${wholeHours} ч`;
  }
  return `${minutes} мин`;
};

const STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'In Progress', label: 'In Progress' },
  { value: 'In Review', label: 'In Review' },
  { value: 'Done', label: 'Done' },
  { value: 'To Do', label: 'To Do' },
  { value: 'Backlog', label: 'Backlog' },
];

const UNASSIGNED_ASSIGNEE = '__unassigned__';
const UNASSIGNED_ASSIGNEE_LABEL = 'Не указан';
const formatDateForSummary = (date: Date) =>
  new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
const formatDateTimeFull = (date: Date) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
const parseTaskDate = (value?: string | null): Date | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

type BillableFilterValue = 'billable' | 'nonBillable' | 'forceIncluded';

const BILLABLE_FILTER_OPTIONS: Array<{ value: BillableFilterValue; label: string; description?: string }> = [
  { value: 'billable', label: 'Биллингуемые задачи', description: 'Флаги биллинга уже выставлены' },
  { value: 'nonBillable', label: 'Небиллингуемые', description: 'Статусы Backlog / To Do без включения' },
  { value: 'forceIncluded', label: 'Принудительно включённые', description: 'Отмечены вручную для акта' },
];

type LockedFilterValue = 'all' | 'locked' | 'available';

const LOCKED_FILTER_OPTIONS: Array<{ value: LockedFilterValue; label: string; description?: string }> = [
  { value: 'all', label: 'Все задачи' },
  { value: 'locked', label: 'Только «в акте»', description: 'Уже входят в сформированные документы' },
  { value: 'available', label: 'Только доступные', description: 'Можно выбрать для формирования' },
];

const FILTER_STORAGE_KEY = 'tasksPageFilters.v1';

type StoredDateRange = { from: string | null; to: string | null } | null;

type PersistedFilters = {
  period: string;
  billableOnly: boolean;
  statuses: TaskStatus[];
  projectFilters: string[];
  assigneeFilters: string[];
  searchTerm: string;
  titleFilter: string;
  taskKeyFilter: string;
  hoursRange: { min: string; max: string };
  billableFilters: BillableFilterValue[];
  customPeriodRange: DateRange | null;
  lockedFilter: LockedFilterValue;
};

type PersistedFiltersPayload = {
  period?: string;
  billableOnly?: boolean;
  statuses?: string[];
  projectFilters?: string[];
  assigneeFilters?: string[];
  searchTerm?: string;
  titleFilter?: string;
  taskKeyFilter?: string;
  hoursRange?: { min?: unknown; max?: unknown };
  billableFilters?: string[];
  customPeriodRange?: StoredDateRange;
  lockedFilter?: string;
};

const STATUS_VALUE_SET = new Set(STATUS_OPTIONS.map((option) => option.value));
const BILLABLE_FILTER_VALUE_SET = new Set(BILLABLE_FILTER_OPTIONS.map((option) => option.value));
const LOCKED_FILTER_VALUE_SET = new Set(LOCKED_FILTER_OPTIONS.map((option) => option.value));

const createDefaultPersistedFilters = (): PersistedFilters => ({
  period: 'all',
  billableOnly: false,
  statuses: [],
  projectFilters: [],
  assigneeFilters: [],
  searchTerm: '',
  titleFilter: '',
  taskKeyFilter: '',
  hoursRange: { min: '', max: '' },
  billableFilters: [],
  customPeriodRange: null,
  lockedFilter: 'all',
});

const parseStoredDate = (value: unknown): Date | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const deserializeDateRange = (value: StoredDateRange): DateRange | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const from = parseStoredDate(value.from ?? undefined);
  const to = parseStoredDate(value.to ?? undefined);
  if (!from && !to) {
    return null;
  }
  return {
    from: from ?? undefined,
    to: to ?? undefined,
  };
};

const serializeDateRange = (range: DateRange | null): StoredDateRange => {
  if (!range) {
    return null;
  }
  const from = range.from instanceof Date && !Number.isNaN(range.from.getTime()) ? range.from.toISOString() : null;
  const to = range.to instanceof Date && !Number.isNaN(range.to.getTime()) ? range.to.toISOString() : null;
  if (!from && !to) {
    return null;
  }
  return { from, to };
};

const sanitizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
};

const loadPersistedFilters = (): PersistedFilters => {
  const defaults = createDefaultPersistedFilters();
  if (typeof window === 'undefined') {
    return defaults;
  }
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as PersistedFiltersPayload;
    const statuses = sanitizeStringArray(parsed.statuses)
      .filter((value): value is TaskStatus => STATUS_VALUE_SET.has(value as TaskStatus));
    const projectFilters = sanitizeStringArray(parsed.projectFilters);
    const assigneeFilters = sanitizeStringArray(parsed.assigneeFilters);
    const billableFilters = sanitizeStringArray(parsed.billableFilters)
      .filter((value): value is BillableFilterValue => BILLABLE_FILTER_VALUE_SET.has(value as BillableFilterValue));
    const hoursRange = (() => {
      if (!parsed.hoursRange || typeof parsed.hoursRange !== 'object') {
        return { ...defaults.hoursRange };
      }
      const min = typeof parsed.hoursRange.min === 'string' ? parsed.hoursRange.min : '';
      const max = typeof parsed.hoursRange.max === 'string' ? parsed.hoursRange.max : '';
      return { min, max };
    })();
    const range = deserializeDateRange(parsed.customPeriodRange ?? null);
    const lockedFilter =
      typeof parsed.lockedFilter === 'string' && LOCKED_FILTER_VALUE_SET.has(parsed.lockedFilter as LockedFilterValue)
        ? (parsed.lockedFilter as LockedFilterValue)
        : defaults.lockedFilter;

    return {
      period: typeof parsed.period === 'string' ? parsed.period : defaults.period,
      billableOnly: typeof parsed.billableOnly === 'boolean' ? parsed.billableOnly : defaults.billableOnly,
      statuses,
      projectFilters,
      assigneeFilters,
      searchTerm: typeof parsed.searchTerm === 'string' ? parsed.searchTerm : defaults.searchTerm,
      titleFilter: typeof parsed.titleFilter === 'string' ? parsed.titleFilter : defaults.titleFilter,
      taskKeyFilter: typeof parsed.taskKeyFilter === 'string' ? parsed.taskKeyFilter : defaults.taskKeyFilter,
      hoursRange,
      billableFilters,
      customPeriodRange: range,
      lockedFilter,
    } as PersistedFilters;
  } catch (error) {
    console.warn('[TasksPage] Unable to restore filters from storage:', error);
    return defaults;
  }
};

const getProjectFilterValue = (task: Task) => {
  const key = task.projectKey?.trim();
  if (key) return `key:${key}`;
  const name = task.projectName?.trim();
  if (name) return `name:${name}`;
  return 'project:unknown';
};

const getProjectFilterLabel = (task: Task) => {
  const primary = task.projectName?.trim();
  if (primary && primary !== task.projectKey) {
    return primary;
  }
  return task.projectKey?.trim() || 'Без проекта';
};

const getAssigneeFilterValue = (task: Task, contractorLookup: Map<string, string>) => {
  const contractorId = task.contractorId?.trim();
  if (contractorId && contractorLookup.has(contractorId)) {
    return `contractor:${contractorId}`;
  }
  const accountId = task.assigneeAccountId?.trim();
  if (accountId) return `id:${accountId}`;
  const display = task.assigneeDisplayName?.trim();
  if (display) return `name:${display}`;
  return UNASSIGNED_ASSIGNEE;
};

const getAssigneeFilterLabel = (task: Task, contractorLookup: Map<string, string>) => {
  const contractorId = task.contractorId?.trim();
  if (contractorId) {
    const contractorName = contractorLookup.get(contractorId)?.trim();
    if (contractorName) {
      return contractorName;
    }
  }
  return task.assigneeDisplayName?.trim() || UNASSIGNED_ASSIGNEE_LABEL;
};

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

interface TasksPageProps {
  onNavigate?: (page: NavigationPage) => void;
  onDirectoryFocusRequested?: (focus: DirectoryFocus) => void;
}

export function TasksPage({ onNavigate, onDirectoryFocusRequested }: TasksPageProps) {
  const persistedFilters = useMemo(() => loadPersistedFilters(), []);

  const [billableOnly, setBillableOnly] = useState(persistedFilters.billableOnly);
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [period, setPeriod] = useState<string>(persistedFilters.period);
  const [availablePeriods, setAvailablePeriods] = useState<TaskPeriod[]>([]);
  const [statuses, setStatuses] = useState<TaskStatus[]>(() => [...persistedFilters.statuses]);
  const [projectFilters, setProjectFilters] = useState<string[]>(() => [...persistedFilters.projectFilters]);
  const [assigneeFilters, setAssigneeFilters] = useState<string[]>(() => [...persistedFilters.assigneeFilters]);
  const [searchTerm, setSearchTerm] = useState(persistedFilters.searchTerm);
  const [titleFilter, setTitleFilter] = useState(persistedFilters.titleFilter);
  const [taskKeyFilter, setTaskKeyFilter] = useState(persistedFilters.taskKeyFilter);
  const [hoursRange, setHoursRange] = useState<{ min: string; max: string }>(() => ({ ...persistedFilters.hoursRange }));
  const [billableFilters, setBillableFilters] = useState<BillableFilterValue[]>(() => [...persistedFilters.billableFilters]);
  const [customPeriodRange, setCustomPeriodRange] = useState<DateRange | null>(persistedFilters.customPeriodRange);
  const [customPeriodPopoverOpen, setCustomPeriodPopoverOpen] = useState(false);
  const [showGenerationDialog, setShowGenerationDialog] = useState(false);
  const [showLockedWarning, setShowLockedWarning] = useState(false);
  const [lockedTaskId, setLockedTaskId] = useState<string | null>(null);
  const [lockedFilter, setLockedFilter] = useState<LockedFilterValue>(persistedFilters.lockedFilter);
  
  const {
    tasks,
    taskPeriods,
    toggleTaskForceInclude,
    loadTasks,
    loadTaskPeriods,
    legalEntities,
    individuals,
    contracts,
  } = useDatabase();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const payload: PersistedFiltersPayload = {
      period,
      billableOnly,
      statuses,
      projectFilters,
      assigneeFilters,
      searchTerm,
      titleFilter,
      taskKeyFilter,
      hoursRange,
      billableFilters,
      customPeriodRange: serializeDateRange(customPeriodRange),
      lockedFilter,
    };
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('[TasksPage] Unable to persist filters:', error);
    }
  }, [
    period,
    billableOnly,
    statuses,
    projectFilters,
    assigneeFilters,
    searchTerm,
    titleFilter,
    taskKeyFilter,
    hoursRange,
    billableFilters,
    customPeriodRange,
    lockedFilter,
  ]);

  const legalNameById = useMemo(() => {
    const map = new Map<string, string>();
    legalEntities.forEach((entity) => {
      if (entity.id) {
        map.set(entity.id, entity.name || entity.id);
      }
    });
    return map;
  }, [legalEntities]);

  const individualNameById = useMemo(() => {
    const map = new Map<string, string>();
    individuals.forEach((individual) => {
      if (individual.id) {
        map.set(individual.id, individual.name || individual.id);
      }
    });
    return map;
  }, [individuals]);

  const contractLabelById = useMemo(() => {
    const map = new Map<string, string>();
    contracts.forEach((contract) => {
      if (contract.id) {
        map.set(contract.id, contract.number || contract.id);
      }
    });
    return map;
  }, [contracts]);

  useEffect(() => {
    if (taskPeriods.length === 0) {
      return;
    }
    setAvailablePeriods(taskPeriods);
  }, [taskPeriods]);

  useEffect(() => {
    if (period === 'custom' && (!customPeriodRange?.from || !customPeriodRange?.to)) {
      setCustomPeriodPopoverOpen(true);
    }
  }, [period, customPeriodRange]);

  useEffect(() => {
    let cancelled = false;

    const loadPeriods = async () => {
      const periods = await loadTaskPeriods();
      if (cancelled) {
        return;
      }
      if (periods.length > 0) {
        setAvailablePeriods(periods);
      }
    };

    loadPeriods();

    return () => {
      cancelled = true;
    };
  }, [loadTaskPeriods]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const periodFilter = period === 'all' || period === 'custom' ? null : period;
      await loadTasks({
        statuses: statuses.length > 0 ? statuses : undefined,
        period: periodFilter,
        billableOnly,
      }, { acknowledge: true });
      if (cancelled) {
        return;
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [loadTasks, statuses, period, billableOnly]);

  const handleStatusToggle = (status: TaskStatus, checked: boolean) => {
    setStatuses((prev) => {
      if (checked) {
        return prev.includes(status) ? prev : [...prev, status];
      }
      return prev.filter((item) => item !== status);
    });
  };

  const handleProjectToggle = (projectKey: string, checked: boolean) => {
    setProjectFilters((prev) => {
      if (checked) {
        return prev.includes(projectKey) ? prev : [...prev, projectKey];
      }
      return prev.filter((item) => item !== projectKey);
    });
  };

  const handleAssigneeToggle = (assignee: string, checked: boolean) => {
    setAssigneeFilters((prev) => {
      if (checked) {
        return prev.includes(assignee) ? prev : [...prev, assignee];
      }
      return prev.filter((item) => item !== assignee);
    });
  };

  const handleBillableFilterToggle = (value: BillableFilterValue, checked: boolean) => {
    setBillableFilters((prev) => {
      if (checked) {
        return prev.includes(value) ? prev : [...prev, value];
      }
      return prev.filter((item) => item !== value);
    });
  };

  const handleCustomRangeSelect = (range?: DateRange) => {
    if (!range?.from) {
      setCustomPeriodRange(null);
      return;
    }
    const nextRange: DateRange = {
      from: range.from,
      to: range.to ?? range.from,
    };
    setCustomPeriodRange(nextRange);
  };

  const projectOptions = useMemo(() => {
    const entries = new Map<string, { label: string; subtitle?: string }>();
    tasks.forEach((task) => {
      const value = getProjectFilterValue(task);
      if (!entries.has(value)) {
        const projectName = task.projectName?.trim();
        const projectKey = task.projectKey?.trim();
        const label = getProjectFilterLabel(task);
        const clientName = task.clientId ? legalNameById.get(task.clientId) : undefined;
        const contractorName = task.contractorId ? individualNameById.get(task.contractorId) : undefined;
        const contractLabel = task.contractId ? contractLabelById.get(task.contractId) : undefined;
        const subtitleParts: string[] = [];
        if (projectName && projectKey && projectName !== projectKey) {
          subtitleParts.push(projectKey);
        }
        if (clientName) {
          subtitleParts.push(`Заказчик: ${clientName}`);
        }
        if (contractorName) {
          subtitleParts.push(`Исполнитель: ${contractorName}`);
        }
        if (contractLabel) {
          subtitleParts.push(`Договор: ${contractLabel}`);
        }
        const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' • ') : undefined;
        entries.set(value, { label, subtitle });
      }
    });
    return Array.from(entries.entries())
      .map(([value, data]) => ({ value, label: data.label, subtitle: data.subtitle }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru-RU'));
  }, [tasks, contractLabelById, individualNameById, legalNameById]);

  const assigneeOptions = useMemo(() => {
    const entries = new Map<string, { label: string; description?: string }>();
    tasks.forEach((task) => {
      const value = getAssigneeFilterValue(task, individualNameById);
      if (!entries.has(value)) {
        entries.set(value, {
          label: getAssigneeFilterLabel(task, individualNameById),
          description: task.assigneeEmail ?? task.assigneeDisplayName ?? undefined,
        });
      }
    });
    return Array.from(entries.entries())
      .map(([value, data]) => ({ value, label: data.label, description: data.description }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru-RU'));
  }, [tasks, individualNameById]);

  const customRangeApplied = period === 'custom' ? customPeriodRange : null;

  const customPeriodSummary = useMemo(() => {
    if (!customPeriodRange?.from) {
      return '';
    }
    const rangeEnd = customPeriodRange.to ?? customPeriodRange.from;
    return `${formatDateForSummary(customPeriodRange.from)} — ${formatDateForSummary(rangeEnd)}`;
  }, [customPeriodRange]);

  useEffect(() => {
    setProjectFilters((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const allowed = new Set(projectOptions.map((option) => option.value));
      const cleaned = prev.filter((value) => allowed.has(value));
      return cleaned.length === prev.length ? prev : cleaned;
    });
  }, [projectOptions]);

  useEffect(() => {
    setAssigneeFilters((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const allowed = new Set(assigneeOptions.map((option) => option.value));
      const cleaned = prev.filter((value) => allowed.has(value));
      return cleaned.length === prev.length ? prev : cleaned;
    });
  }, [assigneeOptions]);

  const filteredTasks = useMemo(() => {
    const statusSet = statuses.length > 0 ? new Set(statuses) : null;
    const projectSet = projectFilters.length > 0 ? new Set(projectFilters) : null;
    const assigneeSet = assigneeFilters.length > 0 ? new Set(assigneeFilters) : null;
    const billableSet = billableFilters.length > 0 ? new Set<BillableFilterValue>(billableFilters) : null;
    const search = searchTerm.trim().toLowerCase();
    const titleQuery = titleFilter.trim().toLowerCase();
    const keyQuery = taskKeyFilter.trim().toLowerCase();
    const minRaw = hoursRange.min.trim();
    const maxRaw = hoursRange.max.trim();
    const minHours = minRaw ? Number(minRaw) : null;
    const maxHours = maxRaw ? Number(maxRaw) : null;
    const applyMin = minHours !== null && Number.isFinite(minHours);
    const applyMax = maxHours !== null && Number.isFinite(maxHours);
    const customStart = customRangeApplied?.from ? new Date(customRangeApplied.from) : null;
    const customEnd = customRangeApplied?.to
      ? new Date(customRangeApplied.to ?? customRangeApplied.from ?? 0)
      : customStart;
    if (customStart) {
      customStart.setHours(0, 0, 0, 0);
    }
    if (customEnd) {
      customEnd.setHours(23, 59, 59, 999);
    }

    const base = tasks.filter((task) => {
      const isLocked = Boolean(task.workPackageId);
      if (statusSet && !statusSet.has(task.status)) {
        return false;
      }

      if (projectSet && !projectSet.has(getProjectFilterValue(task))) {
        return false;
      }

      if (assigneeSet && !assigneeSet.has(getAssigneeFilterValue(task, individualNameById))) {
        return false;
      }

      if (titleQuery && !(task.title || '').toLowerCase().includes(titleQuery)) {
        return false;
      }

      if (keyQuery && !(task.key || '').toLowerCase().includes(keyQuery)) {
        return false;
      }

      const secondsSpent = (task as Task & { secondsSpent?: number | null }).secondsSpent ?? 0;
      const billedSeconds = (task as Task & { billedSeconds?: number | null }).billedSeconds ?? 0;
      const fallbackSeconds = Number.isFinite(task.hours) ? Math.max(task.hours as number, 0) * 3600 : 0;
      const remainingSeconds = Math.max(secondsSpent - billedSeconds, fallbackSeconds);
      const hours = remainingSeconds / 3600;
      if (applyMin && hours < (minHours as number)) {
        return false;
      }
      if (applyMax && hours > (maxHours as number)) {
        return false;
      }

      if (billableSet && billableSet.size > 0) {
        const matchesBillable =
          (billableSet.has('billable') && task.billable) ||
          (billableSet.has('nonBillable') && !task.billable && !task.forceIncluded) ||
          (billableSet.has('forceIncluded') && task.forceIncluded);
        if (!matchesBillable) {
          return false;
        }
      }

      if (billableOnly && !(task.billable || task.forceIncluded)) {
        return false;
      }

      if (lockedFilter === 'locked' && !isLocked) {
        return false;
      }

      if (lockedFilter === 'available' && isLocked) {
        return false;
      }

      if (customStart && customEnd) {
        const timelineMarker =
          task.completedAt ?? task.startedAt ?? task.updatedAt ?? task.createdAt ?? null;
        if (timelineMarker) {
          const markerDate = new Date(timelineMarker);
          if (!Number.isNaN(markerDate.getTime())) {
            if (markerDate < customStart || markerDate > customEnd) {
              if (!isLocked) {
                return false;
              }
            }
          }
        }
      }

      if (search) {
        const haystack = [
          task.title,
          task.key,
          task.projectName,
          task.projectKey,
          task.contractorId ? individualNameById.get(task.contractorId) ?? '' : '',
          task.assigneeDisplayName ?? '',
          task.assigneeEmail ?? '',
          task.clientId ? legalNameById.get(task.clientId) ?? '' : '',
          task.contractorId ? individualNameById.get(task.contractorId) ?? '' : '',
          task.contractId ? contractLabelById.get(task.contractId) ?? '' : '',
        ]
          .map((value) => value?.toLowerCase() ?? '')
          .filter(Boolean);
        const matchesSearch = haystack.some((value) => value.includes(search));
        if (!matchesSearch) {
          return false;
        }
      }

      return true;
    });

    return [...base].sort((a, b) => a.key.localeCompare(b.key));
  }, [
    assigneeFilters,
    billableFilters,
    billableOnly,
    contractLabelById,
    customRangeApplied,
    hoursRange,
    individualNameById,
    legalNameById,
    projectFilters,
    searchTerm,
    statuses,
    taskKeyFilter,
    tasks,
    titleFilter,
    lockedFilter,
  ]);

  const visibleTaskIds = useMemo(() => new Set(filteredTasks.map((task) => task.id)), [filteredTasks]);
  const lockedTaskIds = useMemo(
    () => new Set(filteredTasks.filter((task) => Boolean(task.workPackageId)).map((task) => task.id)),
    [filteredTasks]
  );

  const isTitleFiltered = titleFilter.trim().length > 0;
  const isProjectFiltered = projectFilters.length > 0;
  const isAssigneeFiltered = assigneeFilters.length > 0;
  const isStatusFiltered = statuses.length > 0 && statuses.length < STATUS_OPTIONS.length;
  const isTaskKeyFiltered = taskKeyFilter.trim().length > 0;
  const hasHoursFilter = hoursRange.min.trim().length > 0 || hoursRange.max.trim().length > 0;
  const isBillableColumnFiltered = billableFilters.length > 0 || billableOnly;
  const isLockedFiltered = lockedFilter !== 'all';

  useEffect(() => {
    setSelectedTasks((prev) => {
      const cleaned = prev.filter((taskId) => visibleTaskIds.has(taskId) && !lockedTaskIds.has(taskId));
      return cleaned.length === prev.length ? prev : cleaned;
    });
  }, [visibleTaskIds, lockedTaskIds]);

  const totalSeconds = useMemo(
    () => filteredTasks.reduce((sum, task) => {
      const secondsSpent = task.secondsSpent ?? 0;
      const billedSeconds = task.billedSeconds ?? 0;
      const fallbackSeconds = Number.isFinite(task.hours) ? Math.max(task.hours, 0) * 3600 : 0;
      const remainingSeconds = Math.max(secondsSpent - billedSeconds, fallbackSeconds);
      return sum + remainingSeconds;
    }, 0),
    [filteredTasks]
  );
  const totalHours = totalSeconds / 3600;
  const totalHoursDisplay = useMemo(
    () => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(totalHours),
    [totalHours]
  );

  const handleSelectTask = (taskId: string, isLocked: boolean) => {
    if (isLocked) {
      setLockedTaskId(taskId);
      setShowLockedWarning(true);
      setSelectedTasks((prev) => prev.filter((id) => id !== taskId));
      return;
    }
    setSelectedTasks((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId]
    );
  };

  const handleSelectAll = () => {
    const selectable = filteredTasks
      .filter((task) => !lockedTaskIds.has(task.id))
      .map((task) => task.id);
    setSelectedTasks((prev) => (prev.length === selectable.length ? [] : selectable));
  };

  const toggleForceInclude = (taskId: string, isLocked: boolean) => {
    if (isLocked) {
      setShowLockedWarning(true);
      return;
    }
    void toggleTaskForceInclude(taskId);
  };

  const getStatusBadge = (status: string, billable: boolean) => {
    if (status === 'Backlog' || status === 'To Do') {
      return <Badge variant="secondary">{status}</Badge>;
    }
    if (billable) {
      return <Badge variant="default">{status}</Badge>;
    }
    return <Badge variant="secondary">{status}</Badge>;
  };

  const selectedCount = selectedTasks.length;
  const readyForDocuments = filteredTasks.filter((task) => !lockedTaskIds.has(task.id)).length;
  const hasSelectableTasks = filteredTasks.some((task) => !lockedTaskIds.has(task.id));

  const handleGenerationSuccess = () => {
    setSelectedTasks([]);
  };

  const lockedTask = useMemo(
    () => (lockedTaskId ? tasks.find((task) => task.id === lockedTaskId) ?? null : null),
    [lockedTaskId, tasks]
  );
  const lockedTaskLabel = lockedTask ? lockedTask.key ?? lockedTask.title ?? null : null;

  return (
    <>
      <div className="p-6">
        <div className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div>
              <h1 className="text-gray-900 mb-1">Задачи</h1>
              <p className="text-gray-600">
                Справочник → Задачи
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="bg-blue-50">
                <span className="mr-1">{tasks.length}</span>
                всего
              </Badge>
              <Badge variant="outline" className="bg-orange-50">
                <span className="mr-1">{totalHoursDisplay} ч</span>
                готово к акту
              </Badge>
              <Badge variant="outline">
                <span className="mr-1">{readyForDocuments}</span>
                доступно
              </Badge>
              <Button
                size="sm"
                onClick={() => setShowGenerationDialog(true)}
                disabled={selectedCount === 0 && !hasSelectableTasks}
              >
                Сформировать документы
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-4 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Поиск по названию, проекту или исполнителю"
                className="pl-10"
              />
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="billable-filter"
                  checked={billableOnly}
                  onCheckedChange={setBillableOnly}
                />
                <Label htmlFor="billable-filter" className="text-sm">
                  Только биллингуемые статусы
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <AlertTriangle className="w-4 h-4 text-orange-500" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>В акт попадут только выбранные статусы и период</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              <div className="flex items-center gap-2">
                <Select
                  value={period}
                  onValueChange={(value) => {
                    setPeriod(value);
                    if (value !== 'custom') {
                      setCustomPeriodPopoverOpen(false);
                    }
                  }}
                >
                  <SelectTrigger className="w-60 justify-between">
                    <SelectValue placeholder="Выберите период" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все периоды</SelectItem>
                    <SelectItem value="custom">
                      <div className="flex flex-col text-left">
                        <span>Настраиваемый период</span>
                        <span className="text-xs text-muted-foreground">
                          {customPeriodSummary || 'Выберите даты вручную'}
                        </span>
                      </div>
                    </SelectItem>
                    {availablePeriods.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                        {option.tasks > 0 ? ` · ${option.tasks}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Popover open={customPeriodPopoverOpen} onOpenChange={setCustomPeriodPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant={period === 'custom' ? 'default' : 'outline'}
                      size="sm"
                      className="flex items-center gap-2"
                    >
                      <CalendarRange className="w-4 h-4" />
                      {period === 'custom' && customPeriodSummary
                        ? customPeriodSummary
                        : 'Диапазон'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      initialFocus
                      mode="range"
                      selected={customPeriodRange ?? undefined}
                      onSelect={handleCustomRangeSelect}
                    />
                    <div className="flex items-center justify-between gap-2 border-t p-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setCustomPeriodRange(null);
                          setPeriod('all');
                          setCustomPeriodPopoverOpen(false);
                        }}
                      >
                        Сбросить
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          if (customPeriodRange?.from && customPeriodRange?.to) {
                            setPeriod('custom');
                            setCustomPeriodPopoverOpen(false);
                          }
                        }}
                        disabled={!customPeriodRange?.from || !customPeriodRange?.to}
                      >
                        Применить
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          {billableOnly && (
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 mb-4">
              <p className="text-sm text-blue-800">
                <strong>Подсказка:</strong> Показываются только задачи со статусами In Progress и In Review.
                To Do и Backlog исключены из биллинга. Итого для документов: <strong>{formatDuration(totalHours)}</strong>
              </p>
            </div>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedCount > 0 && selectedCount === readyForDocuments}
                      onCheckedChange={handleSelectAll}
                      disabled={readyForDocuments === 0}
                    />
                  </TableHead>
                  <TableHead className="w-[220px] md:w-[320px] lg:w-[420px]">
                    <div className="flex items-center gap-1">
                      Заголовок
                      <Popover>
                        <PopoverTrigger asChild>
                          <FilterIconButton active={isTitleFiltered} label="Фильтр по заголовку" />
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-64" sideOffset={8}>
                          <div className="space-y-3">
                            <div className="space-y-2">
                              <Label htmlFor="title-filter-input" className="text-xs font-medium text-muted-foreground">
                                Содержит текст
                              </Label>
                              <Input
                                id="title-filter-input"
                                value={titleFilter}
                                onChange={(event) => setTitleFilter(event.target.value)}
                                placeholder="Введите часть заголовка"
                              />
                            </div>
                            <div className="flex justify-end">
                              <Button variant="outline" size="sm" onClick={() => setTitleFilter('')}>
                                Сбросить
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </TableHead>
                  <TableHead className="w-32">
                    <div className="flex items-center gap-1">
                      В акте
                      <Popover>
                        <PopoverTrigger asChild>
                          <FilterIconButton active={isLockedFiltered} label="Фильтр по статусу в акте" />
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-64" sideOffset={8}>
                          <div className="space-y-2">
                            {LOCKED_FILTER_OPTIONS.map((option) => (
                              <Button
                                key={option.value}
                                type="button"
                                variant={lockedFilter === option.value ? 'default' : 'outline'}
                                size="sm"
                                className="w-full justify-start"
                                onClick={() => setLockedFilter(option.value)}
                              >
                                <div className="flex flex-col items-start">
                                  <span className="font-medium">{option.label}</span>
                                  {option.description ? (
                                    <span className="text-xs text-muted-foreground">{option.description}</span>
                                  ) : null}
                                </div>
                              </Button>
                            ))}
                            {lockedFilter !== 'all' ? (
                              <div className="flex justify-end">
                                <Button variant="ghost" size="sm" onClick={() => setLockedFilter('all')}>
                                  Сбросить
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Проект
                      <Popover>
                        <PopoverTrigger asChild>
                          <FilterIconButton active={isProjectFiltered} label="Фильтр по проекту" />
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-72" sideOffset={8}>
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="px-2"
                              onClick={() => setProjectFilters(projectOptions.map((option) => option.value))}
                              disabled={projectOptions.length === 0}
                            >
                              Выбрать все
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setProjectFilters([])}
                            >
                              Сбросить
                            </Button>
                          </div>
                          <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
                            {projectOptions.length === 0 ? (
                              <p className="text-sm text-muted-foreground">Проекты появятся после загрузки задач.</p>
                            ) : (
                              projectOptions.map((option, index) => {
                                const id = `project-filter-${index}`;
                                return (
                                  <div key={option.value} className="flex items-start gap-2">
                                    <Checkbox
                                      id={id}
                                      checked={projectFilters.includes(option.value)}
                                      onCheckedChange={(checked) => handleProjectToggle(option.value, Boolean(checked))}
                                    />
                                    <Label htmlFor={id} className="text-sm leading-snug cursor-pointer">
                                      <span className="block">{option.label}</span>
                                      {option.subtitle ? (
                                        <span className="block text-xs text-muted-foreground">{option.subtitle}</span>
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
                      Исполнитель
                      <Popover>
                        <PopoverTrigger asChild>
                          <FilterIconButton active={isAssigneeFiltered} label="Фильтр по исполнителю" />
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-72" sideOffset={8}>
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="px-2"
                              onClick={() => setAssigneeFilters(assigneeOptions.map((option) => option.value))}
                              disabled={assigneeOptions.length === 0}
                            >
                              Выбрать всех
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setAssigneeFilters([])}>
                              Сбросить
                            </Button>
                          </div>
                          <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
                            {assigneeOptions.length === 0 ? (
                              <p className="text-sm text-muted-foreground">Исполнители появятся после загрузки задач.</p>
                            ) : (
                              assigneeOptions.map((option, index) => {
                                const id = `assignee-filter-${index}`;
                                return (
                                  <div key={option.value} className="flex items-start gap-2">
                                    <Checkbox
                                      id={id}
                                      checked={assigneeFilters.includes(option.value)}
                                      onCheckedChange={(checked) => handleAssigneeToggle(option.value, Boolean(checked))}
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
                      Задача
                      <Popover>
                        <PopoverTrigger asChild>
                          <FilterIconButton active={isTaskKeyFiltered} label="Фильтр по ключу задачи" />
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-56" sideOffset={8}>
                          <div className="space-y-3">
                            <div className="space-y-2">
                              <Label htmlFor="task-key-filter" className="text-xs font-medium text-muted-foreground">
                                Содержит текст
                              </Label>
                              <Input
                                id="task-key-filter"
                                value={taskKeyFilter}
                                onChange={(event) => setTaskKeyFilter(event.target.value)}
                                placeholder="Например, ACS"
                              />
                            </div>
                            <div className="flex justify-end">
                              <Button variant="outline" size="sm" onClick={() => setTaskKeyFilter('')}>
                                Сбросить
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Статус
                      <Popover>
                        <PopoverTrigger asChild>
                          <FilterIconButton active={isStatusFiltered} label="Фильтр по статусу" />
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-56" sideOffset={8}>
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="px-2"
                              onClick={() => setStatuses(STATUS_OPTIONS.map((option) => option.value))}
                            >
                              Выбрать все
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setStatuses([])}>
                              Сбросить
                            </Button>
                          </div>
                          <div className="space-y-2">
                            {STATUS_OPTIONS.map((option, index) => {
                              const id = `status-filter-${index}`;
                              return (
                                <div key={option.value} className="flex items-start gap-2">
                                  <Checkbox
                                    id={id}
                                    checked={statuses.includes(option.value)}
                                    onCheckedChange={(checked) => handleStatusToggle(option.value, Boolean(checked))}
                                  />
                                  <Label htmlFor={id} className="text-sm leading-snug cursor-pointer">
                                    {option.label}
                                  </Label>
                                </div>
                              );
                            })}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Время
                      <Popover>
                        <PopoverTrigger asChild>
                          <FilterIconButton active={hasHoursFilter} label="Фильтр по затраченным часам" />
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-64" sideOffset={8}>
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-2">
                                <Label htmlFor="hours-min" className="text-xs font-medium text-muted-foreground">
                                  От (часы)
                                </Label>
                                <Input
                                  id="hours-min"
                                  type="number"
                                  min="0"
                                  step="0.25"
                                  value={hoursRange.min}
                                  onChange={(event) => setHoursRange((prev) => ({ ...prev, min: event.target.value }))}
                                  placeholder="0"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="hours-max" className="text-xs font-medium text-muted-foreground">
                                  До (часы)
                                </Label>
                                <Input
                                  id="hours-max"
                                  type="number"
                                  min="0"
                                  step="0.25"
                                  value={hoursRange.max}
                                  onChange={(event) => setHoursRange((prev) => ({ ...prev, max: event.target.value }))}
                                  placeholder="24"
                                />
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Значения указываются в часах. Оставьте поля пустыми, чтобы показать все задачи.
                            </p>
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setHoursRange({ min: '', max: '' })}>
                                Сбросить
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Биллинг
                      <Popover>
                        <PopoverTrigger asChild>
                          <FilterIconButton active={isBillableColumnFiltered} label="Фильтр по биллингу" />
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-72" sideOffset={8}>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              {BILLABLE_FILTER_OPTIONS.map((option, index) => {
                                const id = `billable-filter-${index}`;
                                return (
                                  <div key={option.value} className="flex items-start gap-2">
                                    <Checkbox
                                      id={id}
                                      checked={billableFilters.includes(option.value)}
                                      onCheckedChange={(checked) => handleBillableFilterToggle(option.value, Boolean(checked))}
                                    />
                                    <Label htmlFor={id} className="text-sm leading-snug cursor-pointer">
                                      <span className="block">{option.label}</span>
                                      {option.description ? (
                                        <span className="block text-xs text-muted-foreground">{option.description}</span>
                                      ) : null}
                                    </Label>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-medium">Только биллингуемые статусы</p>
                                  <p className="text-xs text-muted-foreground">Спрячь задачи без биллинга и без включения в акт</p>
                                </div>
                                <Switch
                                  id="billable-only-popover"
                                  checked={billableOnly}
                                  onCheckedChange={setBillableOnly}
                                />
                              </div>
                            </div>
                            <div className="flex justify-end">
                              <Button variant="outline" size="sm" onClick={() => setBillableFilters([])}>
                                Сбросить фильтр
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTasks.map((task) => {
                  const isLocked = Boolean(task.workPackageId);
                  const isSelected = selectedTasks.includes(task.id);
                  const clientName = task.clientId ? legalNameById.get(task.clientId) : undefined;
                  const contractorName = task.contractorId ? individualNameById.get(task.contractorId) : undefined;
                  const contractLabel = task.contractId ? contractLabelById.get(task.contractId) : undefined;
                  const metadataEntries = (
                    [
                      clientName ? { label: 'Заказчик', value: clientName } : null,
                      contractorName ? { label: 'Исполнитель', value: contractorName } : null,
                      contractLabel ? { label: 'Договор', value: contractLabel } : null,
                    ] as Array<{ label: string; value: string } | null>
                  ).filter((item): item is { label: string; value: string } => Boolean(item));
                  const hasDirectoryMeta = metadataEntries.length > 0;
                  const projectLabel = task.projectName || clientName || task.projectKey;
                  const rawTitle = task.title ?? '';
                  const trimmedTitle = rawTitle.trim();
                  const hasTitle = trimmedTitle.length > 0;
                  const displayTitle = hasTitle ? rawTitle : '—';
                  const titleContainerClassName = `flex w-full min-w-0 items-start gap-2${hasTitle ? ' cursor-help' : ''}`;
                  const titleContent = (
                    <div className={titleContainerClassName}>
                      <span className="flex-1 truncate text-sm text-foreground">{displayTitle}</span>
                      {task.key ? (
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.key}</span>
                      ) : null}
                    </div>
                  );
                  const metadataContent = hasDirectoryMeta ? (
                    <div className="space-y-2 text-xs">
                      <div className="font-medium text-foreground">Метаданные проекта</div>
                      <div className="space-y-1">
                        {metadataEntries.map((entry) => (
                          <div key={entry.label} className="flex gap-2">
                            <span className="text-muted-foreground min-w-[96px]">{entry.label}:</span>
                            <span className="text-foreground">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null;
                  const completedAtDate = parseTaskDate(task.completedAt);
                  const updatedAtDate = parseTaskDate(task.updatedAt);
                  const startedAtDate = parseTaskDate(task.startedAt);
                  const createdAtDate = parseTaskDate(task.createdAt);
                  const taskDateDetails = (
                    [
                      completedAtDate ? { label: 'Завершена', date: completedAtDate } : null,
                      updatedAtDate ? { label: 'Обновлена', date: updatedAtDate } : null,
                      startedAtDate ? { label: 'Начата', date: startedAtDate } : null,
                      createdAtDate ? { label: 'Создана', date: createdAtDate } : null,
                    ] as Array<{ label: string; date: Date } | null>
                  ).filter((item): item is { label: string; date: Date } => Boolean(item));

                  return (
                    <TableRow key={task.id} className="group">
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleSelectTask(task.id, isLocked)}
                          disabled={isLocked}
                        />
                      </TableCell>
                      <TableCell className="w-[220px] md:w-[320px] lg:w-[420px] align-top">
                        {hasTitle ? (
                          <TooltipProvider delayDuration={0}>
                            <Tooltip>
                              <TooltipTrigger asChild>{titleContent}</TooltipTrigger>
                              <TooltipContent align="start" side="top" className="max-w-lg">
                                <p className="text-sm leading-snug">{rawTitle}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          titleContent
                        )}
                      </TableCell>
                      <TableCell>
                        {isLocked ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge variant="outline" className="border-green-300 text-green-700">
                                  В акте
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Пакет: {task.workPackageId}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-xs text-muted-foreground">Доступно</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-start gap-2 text-xs text-muted-foreground">
                          <div className="flex flex-col">
                            <span className="text-sm text-foreground">{projectLabel}</span>
                            <span className="font-mono text-xs text-muted-foreground">{task.projectKey || '—'}</span>
                          </div>
                          {metadataContent ? (
                            <TooltipProvider delayDuration={0}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-80 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                    aria-label="Показать метаданные проекта"
                                  >
                                    <Info className="h-3.5 w-3.5" aria-hidden />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent align="start" side="top" className="max-w-sm">
                                  {metadataContent}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {contractorName ? (
                          <div className="flex flex-col text-xs text-muted-foreground">
                            <span className="text-sm text-foreground">{contractorName}</span>
                            {task.assigneeDisplayName && task.assigneeDisplayName !== contractorName ? (
                              <span>{task.assigneeDisplayName}</span>
                            ) : null}
                            {!task.assigneeDisplayName && task.assigneeEmail ? (
                              <span>{task.assigneeEmail}</span>
                            ) : null}
                          </div>
                        ) : task.assigneeDisplayName ? (
                          <div className="flex flex-col text-xs text-muted-foreground">
                            <span className="text-sm text-foreground">{task.assigneeDisplayName}</span>
                            {task.assigneeEmail ? <span>{task.assigneeEmail}</span> : null}
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Не указан
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {task.key ? (
                          <TooltipProvider delayDuration={100}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="font-mono text-sm cursor-help text-foreground transition-colors hover:text-primary">
                                  {task.key}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                align="center"
                                className="space-y-1 bg-popover text-popover-foreground border border-border shadow-lg"
                              >
                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                  Даты задачи
                                </div>
                                {taskDateDetails.length > 0 ? (
                                  <div className="space-y-1">
                                    {taskDateDetails.map((entry) => (
                                      <div key={entry.label} className="flex items-center gap-2">
                                        <span className="min-w-[88px] text-xs text-muted-foreground">{entry.label}:</span>
                                        <span className="text-sm text-popover-foreground">
                                          {formatDateTimeFull(entry.date)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-muted-foreground">Даты недоступны</p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="font-mono text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(task.status, task.billable)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4 text-muted-foreground" />
                          {formatDuration(task.hours)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {!task.billable && (task.status === 'To Do' || task.status === 'Backlog') && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`force-${task.id}`}
                                    checked={task.forceIncluded}
                                    onCheckedChange={() => toggleForceInclude(task.id, isLocked)}
                                    disabled={isLocked}
                                  />
                                  <Label htmlFor={`force-${task.id}`} className="text-xs">
                                    Разрешить биллинг
                                  </Label>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Вы выбрали незавершенную задачу со статусом {task.status}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {task.billable && (
                          <Badge variant="outline" className="text-green-700 border-green-200">
                            Биллингуемый
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
          <span>
            {selectedCount} of {readyForDocuments} row(s) selected.
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              Previous
            </Button>
            <Button variant="outline" size="sm">
              Next
            </Button>
          </div>
        </div>
      </div>

      <DocumentGenerationDialog
        open={showGenerationDialog}
        onOpenChange={setShowGenerationDialog}
        taskIds={selectedTasks}
        defaultPeriod={period}
        onSuccess={handleGenerationSuccess}
        onDirectoryFocusRequested={(focus) => {
          setShowGenerationDialog(false);
          onDirectoryFocusRequested?.(focus);
          onNavigate?.('directory');
        }}
      />

      <Dialog
        open={showLockedWarning}
        onOpenChange={(open) => {
          setShowLockedWarning(open);
          if (!open) {
            setLockedTaskId(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Задача уже в акте</DialogTitle>
            <DialogDescription>Задача уже включена в документ и заблокирована</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              {lockedTaskLabel ? (
                <span className="font-mono text-xs text-foreground mr-1">{lockedTaskLabel}</span>
              ) : null}
              Эта задача уже входит в сформированный документ. Повторное включение недоступно, чтобы избежать
              дублирования данных.
            </p>
            <p className="text-xs">
              Удалите соответствующий документ в разделе «Документы» или воспользуйтесь действием «Сделать задачи снова доступными»
              перед повторной генерацией.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setShowLockedWarning(false)}>
              Понятно
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
