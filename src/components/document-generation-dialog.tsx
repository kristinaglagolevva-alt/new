import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { DateRange } from 'react-day-picker';
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronsUpDown,
  Clock,
  Info,
  Loader2,
  Pencil,
  RotateCcw,
  X,
} from 'lucide-react';

import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Checkbox } from './ui/checkbox';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { ScrollArea } from './ui/scroll-area';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { useDatabase } from '../data/DataContext';
import { useAuth } from '../data/AuthContext';
import type { DirectoryFocus } from '../types/navigation';
import type {
  Contract,
  ContractUiProfile,
  FieldRuleMode,
  Individual,
  PackageCreateRequest,
  PackageCreateResponse,
  PackageGeneratedDocument,
  PackageTaskInput,
  PerformerRuleConfig,
  Task,
  Template,
  VatSettings,
} from '../data/models';
import { cn } from './ui/utils';

import './document-generation-dialog.css';

interface DocumentGenerationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskIds: string[];
  defaultPeriod?: string;
  onSuccess?: (record?: any) => void;
  dialogContentClassName?: string;
  onDirectoryFocusRequested?: (focus: DirectoryFocus) => void;
}

type DocServerCode = 'AVR' | 'APP' | 'IPR' | 'INVOICE' | 'SERVICE_ASSIGN' | 'ORDER';
type Step = 'snapshot' | 'confirm';

type GroupWarningSeverity = 'info' | 'warning' | 'danger';

interface GroupWarning {
  type:
    | 'no-contract'
    | 'contract-mismatch'
    | 'contract-ambiguous'
    | 'no-performer'
    | 'performer-incomplete'
    | 'contract-expired'
    | 'contract-expiring'
    | 'timesheet-locked'
    | 'npd-required'
    | 'missing-norm-hours'
    | 'invoice-required'
    | 'no-hours';
  message: string;
  severity: GroupWarningSeverity;
}

interface GroupBadge {
  id: string;
  label: string;
  tone: 'muted' | 'info' | 'warning' | 'danger';
}

interface GroupOverride {
  docs: DocServerCode[];
  rate?: number;
  includeTimesheet?: boolean;
  vatSettings?: VatSettings;
  templates: Record<DocServerCode, string | null>;
  npdReceiptConfirmed?: boolean;
  usage?: UsageFlags;
}

interface GroupMatrixEntry {
  key: string;
  contract: Contract | null;
  contractProfile: ContractUiProfile | null;
  performer: Individual | null;
  performerType: Contract['performerType'];
  projectKey: string | null;
  projectName: string | null;
  tasks: Task[];
  contractDiagnostics: {
    mismatchedContractId?: string | null;
    candidateContracts: Contract[];
  };
  docOptions: DocServerCode[];
  defaultDocs: DocServerCode[];
  rateRule: FieldRuleMode;
  timesheetRule: FieldRuleMode;
  vatRule: FieldRuleMode;
  includeTimesheetDefault: boolean;
  vatSettingsDefault: VatSettings;
  vatPercentDefault: number;
  normHours: number | null;
  requiresNpdReceipt: boolean;
  invoiceRequired: boolean;
  badges: GroupBadge[];
  warnings: GroupWarning[];
  totalHours: number;
  templatesByDoc: Record<DocServerCode, string | null>;
  templateOptions: Record<DocServerCode, Template[]>;
  templateEntries: Array<{
    doc: DocServerCode;
    templateId: string | null;
    templateName: string;
  }>;
  usageFlags: UsageFlags;
}

type UsageKey = 'invoice' | 'tax' | 'grants' | 'internal';

type UsageFlags = Record<UsageKey, boolean>;

const DOC_CODE_LABELS: Record<DocServerCode, string> = {
  AVR: 'Акт выполненных работ',
  APP: 'Акт передачи прав',
  IPR: 'Акт передачи прав',
  INVOICE: 'Счёт-фактура',
  SERVICE_ASSIGN: 'Служебное задание',
  ORDER: 'Приказ',
};

const DOC_CODE_ORDER: DocServerCode[] = ['ORDER', 'SERVICE_ASSIGN', 'AVR', 'APP', 'IPR', 'INVOICE'];

const USAGE_OPTIONS: Array<{
  key: UsageKey;
  label: string;
  description: string;
}> = [
  { key: 'grants', label: 'Льготы / субсидии', description: 'Подтверждение для программ поддержки' },
  { key: 'invoice', label: 'Счёт', description: 'Выставление счёта на оплату' },
  { key: 'tax', label: 'Налоговая отчётность', description: 'Сведения для льгот и деклараций' },
  { key: 'internal', label: 'Внутренний учёт', description: 'Отчёты для финансового и проектного контроля' },
];

const DEFAULT_VAT_SETTINGS: VatSettings = {
  status: 'non_payer',
  rate: null,
  exempt: false,
};

const pluralizePerformers = (count: number) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return 'исполнитель';
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return 'исполнителя';
  }
  return 'исполнителей';
};

const sanitizeVatRate = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number(Math.max(0, numeric).toFixed(2));
};

const toStartOfDay = (input: Date) => {
  const result = new Date(input.getTime());
  result.setHours(0, 0, 0, 0);
  return result;
};

const toEndOfDay = (input: Date) => {
  const result = new Date(input.getTime());
  result.setHours(23, 59, 59, 999);
  return result;
};

const formatIsoDate = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const vatSettingsFromLegacyMode = (
  mode?: ContractUiProfile['default_vat_mode'] | Contract['vatMode'] | null,
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
      return { ...DEFAULT_VAT_SETTINGS };
  }
};

const normalizeVatSettings = (
  settings?: VatSettings | null,
  legacyMode?: ContractUiProfile['default_vat_mode'] | Contract['vatMode'],
): VatSettings => {
  if (!settings) {
    return vatSettingsFromLegacyMode(legacyMode);
  }
  if (settings.status !== 'payer') {
    return { ...DEFAULT_VAT_SETTINGS };
  }
  if (settings.exempt) {
    return { status: 'payer', rate: 0, exempt: true };
  }
  const fallback = vatSettingsFromLegacyMode(legacyMode);
  const rate = sanitizeVatRate(settings.rate) ?? sanitizeVatRate(fallback.rate) ?? 20;
  return {
    status: 'payer',
    rate,
    exempt: false,
  };
};

const vatSettingsToLegacyMode = (settings: VatSettings): ContractUiProfile['default_vat_mode'] => {
  if (settings.status !== 'payer') {
    return 'no_vat';
  }
  if (settings.exempt) {
    return 'vat_0';
  }
  const rate = sanitizeVatRate(settings.rate) ?? 0;
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

const vatPercentFromSettings = (settings: VatSettings): number => {
  if (settings.status !== 'payer' || settings.exempt) {
    return 0;
  }
  return sanitizeVatRate(settings.rate) ?? 0;
};

const describeVatSettings = (settings: VatSettings): string => {
  if (settings.status !== 'payer') {
    return 'Не плательщик';
  }
  if (settings.exempt) {
    return 'Без НДС';
  }
  const rate = vatPercentFromSettings(settings);
  if (rate === 0) {
    return 'НДС 0%';
  }
  return `НДС ${rate}%`;
};

const shouldShowVatBadge = (
  performer?: Individual | null,
  performerType?: Contract['performerType'] | null,
): boolean => {
  const type = performer?.legalType ?? performerType ?? null;
  return type === 'company' || type === 'ip';
};

const VatSettingsControl = ({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: VatSettings;
  onChange: (settings: VatSettings) => void;
  disabled?: boolean;
  idPrefix: string;
}) => {
  const normalized = normalizeVatSettings(value);
  const rateInputId = `${idPrefix}-rate`;
  const radioNonPayerId = `${idPrefix}-non-payer`;
  const radioPayerId = `${idPrefix}-payer`;
  const exemptCheckboxId = `${idPrefix}-exempt`;

  const handleStatusChange = (nextStatus: VatSettings['status']) => {
    if (disabled) {
      return;
    }
    if (nextStatus === 'payer') {
      onChange({ status: 'payer', rate: normalized.rate ?? 20, exempt: normalized.exempt });
    } else {
      onChange({ ...DEFAULT_VAT_SETTINGS });
    }
  };

  const handleRateChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (disabled) {
      return;
    }
    const input = event.target.value;
    if (input.trim() === '') {
      onChange({ status: 'payer', rate: null, exempt: normalized.exempt });
      return;
    }
    const parsed = sanitizeVatRate(input);
    if (parsed === null) {
      return;
    }
    onChange({ status: 'payer', rate: parsed, exempt: false });
  };

  const handleExemptChange = (checked: boolean) => {
    if (disabled) {
      return;
    }
    onChange({ status: 'payer', rate: checked ? 0 : normalized.rate ?? 20, exempt: checked });
  };

  return (
    <div className="space-y-3">
      <RadioGroup
        value={normalized.status}
        onValueChange={(next) => handleStatusChange(next as VatSettings['status'])}
        className="grid gap-2 md:grid-cols-2"
      >
        <label 
          className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm cursor-pointer transition hover:border-gray-300 hover:bg-gray-50" 
          htmlFor={radioNonPayerId}
        >
          <RadioGroupItem id={radioNonPayerId} value="non_payer" disabled={disabled} />
          <span className="flex-1">Не плательщик</span>
        </label>
        <label 
          className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm cursor-pointer transition hover:border-gray-300 hover:bg-gray-50" 
          htmlFor={radioPayerId}
        >
          <RadioGroupItem id={radioPayerId} value="payer" disabled={disabled} />
          <span className="flex-1">Плательщик</span>
        </label>
      </RadioGroup>
      {normalized.status === 'payer' && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor={rateInputId} className="text-sm">Ставка НДС, %</Label>
            <Input
              id={rateInputId}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.1"
              placeholder="20"
              value={normalized.exempt ? '' : normalized.rate ?? ''}
              onChange={handleRateChange}
              disabled={disabled || normalized.exempt}
            />
          </div>
          <label
            htmlFor={exemptCheckboxId}
            className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 cursor-pointer transition hover:border-gray-300"
          >
            <div className="space-y-1">
              <span className="block text-sm font-medium">Без НДС (освоб.)</span>
              <span className="text-xs text-muted-foreground">Операция освобождена от налогообложения</span>
            </div>
            <Checkbox
              id={exemptCheckboxId}
              checked={normalized.exempt}
              onCheckedChange={(next) => handleExemptChange(Boolean(next))}
              disabled={disabled}
            />
          </label>
        </div>
      )}
    </div>
  );
};

const LOCAL_RULES: Record<string, PerformerRuleConfig> = {
  employee: {
    docs: ['ORDER', 'SERVICE_ASSIGN', 'IPR'],
    vatMode: 'hidden',
    rate: { mode: 'hidden' },
    normHours: { mode: 'hidden' },
    timesheet: { mode: 'readonly', default: true },
    extraFlags: { allowMonetaryActs: false, requireNpdReceipt: false },
  },
  gph: {
    docs: ['ORDER', 'SERVICE_ASSIGN', 'AVR', 'IPR'],
    vatMode: 'hidden',
    rate: { mode: 'editable' },
    normHours: { mode: 'readonly' },
    timesheet: { mode: 'editable', default: true },
    extraFlags: { allowMonetaryActs: true, requireNpdReceipt: false },
  },
  selfemployed: {
    docs: ['ORDER', 'SERVICE_ASSIGN', 'AVR', 'IPR'],
    vatMode: 'hidden',
    rate: { mode: 'editable' },
    normHours: { mode: 'readonly' },
    timesheet: { mode: 'editable', default: true },
    extraFlags: { allowMonetaryActs: true, requireNpdReceipt: true },
  },
  ip: {
    docs: ['ORDER', 'SERVICE_ASSIGN', 'AVR', 'IPR', 'INVOICE'],
    vatMode: 'readonly',
    rate: { mode: 'editable' },
    normHours: { mode: 'readonly' },
    timesheet: { mode: 'editable' },
    extraFlags: { allowMonetaryActs: true, requireNpdReceipt: false },
  },
  company: {
    docs: ['ORDER', 'AVR', 'APP', 'INVOICE'],
    vatMode: 'editable',
    rate: { mode: 'editable' },
    normHours: { mode: 'readonly' },
    timesheet: { mode: 'editable' },
    extraFlags: { allowMonetaryActs: true, requireNpdReceipt: false },
  },
};

const shortenFullName = (value?: string | null) => {
  if (!value) {
    return '';
  }
  const normalized = value.replace(/\s+/g, ' ').replace(/\.+/g, '.').trim();
  if (!normalized) {
    return '';
  }
  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  const [surname, ...rest] = parts;
  const initials = rest
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => `${segment[0]?.toUpperCase()}.`)
    .join('');
  return initials ? `${surname} ${initials}`.trim() : surname;
};

const parseContentDispositionFilename = (header: string | null): string | null => {
  if (!header) {
    return null;
  }

  const filenameStarMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (filenameStarMatch?.[1]) {
    try {
      return decodeURIComponent(filenameStarMatch[1]);
    } catch (error) {
      console.warn('[DocumentGenerationDialog] Failed to decode filename*', error);
    }
  }

  const filenameMatch = header.match(/filename="?([^";]+)"?/i);
  return filenameMatch?.[1] ?? null;
};

const formatHours1Dec = (hours: number) =>
  (Math.round(hours * 10) / 10).toLocaleString('ru-RU', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

const formatCurrency = (value: number) =>
  `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

const splitTaskSegments = (value?: string | null): string[] => {
  if (!value) {
    return [];
  }
  return value
    .replace(/\r/g, '\n')
    .split(/[\n;]+/)
    .map((segment) => segment.replace(/^[\s•*+\-–—\d.,)]+/, '').trim())
    .map((segment) => segment.replace(/^\[[^\]]+\]\s*/g, ''))
    .map((segment) => segment.replace(/^ACS-\d+\s*—\s*/i, ''))
    .filter(Boolean);
};

const buildCompactTaskSummary = (title: string, description?: string | null): string => {
  const segments = [...splitTaskSegments(title), ...splitTaskSegments(description)];
  const main = segments.find((segment) => segment.length > 0) ?? title.trim();
  const normalized = main.replace(/\s+/g, ' ').trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized;
};

const buildTaskNarrativeFragment = (title: string, description?: string | null): string => {
  const segments = [...splitTaskSegments(title), ...splitTaskSegments(description)];
  if (segments.length === 0) {
    const fallback = title.trim();
    return fallback ? (fallback.endsWith('.') ? fallback : `${fallback}.`) : '';
  }
  const uniqueSegments = Array.from(new Set(segments.map((segment) => segment.replace(/\.+$/, ''))));
  const [primary, ...rest] = uniqueSegments;
  if (!primary) {
    return '';
  }
  const additions = rest.slice(0, 2).join('; ');
  const base = primary.charAt(0).toUpperCase() + primary.slice(1);
  const fragment = additions ? `${base}: ${additions}` : base;
  return fragment.endsWith('.') ? fragment : `${fragment}.`;
};

const resolveIndividualId = (
  contractorId: string | undefined | null,
  taskEmail: string | undefined,
  taskName: string | undefined,
  taskAccountId: string | undefined,
  individuals: Individual[],
) => {
  if (!individuals.length) {
    return null;
  }
  const directId = contractorId?.toString().trim();
  if (directId) {
    if (/^\d+$/.test(directId)) {
      return Number(directId);
    }
    const directMatch = individuals.find((person) => person.id === directId);
    if (directMatch?.id && /^\d+$/.test(directMatch.id)) {
      return Number(directMatch.id);
    }
  }
  const accountId = taskAccountId?.trim();
  if (accountId) {
    const found = individuals.find((person) => person.externalId?.trim() === accountId);
    if (found?.id && /^\d+$/.test(found.id)) {
      return Number(found.id);
    }
  }
  const email = taskEmail?.trim().toLowerCase();
  if (email) {
    const found = individuals.find((person) => person.email?.toLowerCase() === email);
    if (found?.id && /^\d+$/.test(found.id)) {
      return Number(found.id);
    }
  }
  const name = taskName?.trim();
  if (name) {
    const found = individuals.find((person) => person.name?.trim() === name);
    if (found?.id && /^\d+$/.test(found.id)) {
      return Number(found.id);
    }
  }
  return null;
};

const normalizeProjectKey = (task: Task) => task.projectKey || '—';

const describePerformer = (performer: Individual | null, fallbackType: Contract['performerType']) => {
  if (!performer) {
    switch (fallbackType) {
      case 'employee':
        return 'Штатный сотрудник';
      case 'selfemployed':
        return 'Самозанятый';
      case 'ip':
        return 'Индивидуальный предприниматель';
      case 'company':
        return 'Юрлицо';
      default:
        return 'Исполнитель';
    }
  }
  return performer.name || 'Исполнитель';
};

const performerTypeLabel = (type: Contract['performerType']) => {
  switch (type) {
    case 'employee':
      return 'штатников';
    case 'gph':
      return 'исполнителей (ГПХ)';
    case 'selfemployed':
      return 'самозанятых';
    case 'ip':
      return 'ИП';
    case 'company':
      return 'юрлиц';
    default:
      return 'исполнителей';
  }
};

const isVatVisibleForPerformer = (performerType: Contract['performerType']) =>
  performerType === 'company' || performerType === 'ip';

const getTemplateBucket = (doc: DocServerCode): Template['type'] => {
  switch (doc) {
    case 'INVOICE':
      return 'invoice';
    case 'SERVICE_ASSIGN':
      return 'timesheet';
    case 'ORDER':
      return 'custom';
    case 'IPR':
    case 'APP':
      return 'custom';
    default:
      return 'act';
  }
};

const resolveDocCodeForTemplate = (
  template: Template,
  performerType: Contract['performerType']
): DocServerCode | null => {
  const normalizedName = template.name.toLowerCase();

  if (template.type === 'invoice') {
    return 'INVOICE';
  }

  if (normalizedName.includes('передач') || normalizedName.includes('ipr')) {
    return performerType === 'company' ? 'APP' : 'IPR';
  }

  if (normalizedName.includes('приказ')) {
    return 'ORDER';
  }

  if (template.type === 'timesheet' || normalizedName.includes('служеб') || normalizedName.includes('задани')) {
    return 'SERVICE_ASSIGN';
  }

  if (template.type === 'act' || normalizedName.includes('акт сдачи') || normalizedName.includes('акт выполненных')) {
    return 'AVR';
  }

  if (template.type === 'custom') {
    if (normalizedName.includes('приказ')) {
      return 'ORDER';
    }
    return performerType === 'company' ? 'APP' : 'IPR';
  }

  return null;
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
const monthLabelFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long' });

export function DocumentGenerationDialog({
  open,
  onOpenChange,
  taskIds,
  defaultPeriod,
  onSuccess,
  dialogContentClassName,
  onDirectoryFocusRequested,
}: DocumentGenerationDialogProps) {
  const {
    tasks,
    contracts,
    individuals,
    legalEntities,
    templates,
    taskPeriods,
    trackerProjects,
    generatePackage,
    getContractUiProfile,
    loadDocuments,
    loadWorkPackages,
  } = useDatabase();
  const { token } = useAuth();
  const apiBaseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || 'http://localhost:8000';

  const isBulkDocumentsMode = defaultPeriod === undefined;

  const baseTaskList = useMemo(
    () => tasks.filter((task) => taskIds.includes(task.id)),
    [tasks, taskIds],
  );

  const [selectedPerformerIds, setSelectedPerformerIds] = useState<'all' | string[]>('all');
  const [performerSelectorOpen, setPerformerSelectorOpen] = useState(false);

  const templatesById = useMemo(() => {
    const map = new Map<string, Template>();
    templates.forEach((template) => {
      map.set(template.id, template);
    });
    return map;
  }, [templates]);

  const resolveDocTemplate = useCallback(
    (group: GroupMatrixEntry, doc: DocServerCode, override?: GroupOverride | null): Template | null => {
      const source = override?.templates ?? group.templatesByDoc;
      const templateId = source[doc];
      if (templateId) {
        const template = templatesById.get(templateId);
        if (template) {
          return template;
        }
      }
      return group.templateOptions[doc]?.[0] ?? null;
    },
    [templatesById],
  );

  const resolveDocTemplateName = useCallback(
    (group: GroupMatrixEntry, doc: DocServerCode, override?: GroupOverride | null) =>
      resolveDocTemplate(group, doc, override)?.name ?? DOC_CODE_LABELS[doc] ?? 'Документ',
    [resolveDocTemplate],
  );

  const [step, setStep] = useState<Step>('snapshot');
  const [customPeriodRange, setCustomPeriodRange] = useState<DateRange | undefined>();
  const [customPeriodPopoverOpen, setCustomPeriodPopoverOpen] = useState(false);
  const [period, setPeriod] = useState<string>('custom');
  const customPeriodSummary = useMemo(() => {
    if (!customPeriodRange?.from) {
      return '';
    }
    const rangeEnd = customPeriodRange.to ?? customPeriodRange.from;
    return `${dateFormatter.format(customPeriodRange.from)} — ${dateFormatter.format(rangeEnd)}`;
  }, [customPeriodRange]);
  const createPeriodRange = useCallback((startInput: Date, endInput: Date) => {
    const startDate = toStartOfDay(startInput);
    const endDate = toEndOfDay(endInput);
    return {
      startDate,
      endDate,
      startValue: formatIsoDate(startDate),
      endValue: formatIsoDate(endDate),
    } as const;
  }, []);

  const periodRange = useMemo(() => {

    if (period === 'custom') {
      if (customPeriodRange?.from) {
        const toDate = customPeriodRange.to ?? customPeriodRange.from;
        return createPeriodRange(customPeriodRange.from, toDate);
      }
      return null;
    }

    const preset = taskPeriods.find((item) => item.value === period);
    if (preset?.start && preset?.end) {
      const start = new Date(preset.start);
      const end = new Date(preset.end);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        return createPeriodRange(start, end);
      }
    }

    if (typeof period === 'string') {
      const match = /^([0-9]{4})-([0-9]{2})$/.exec(period);
      if (match) {
        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        if (Number.isFinite(year) && Number.isFinite(monthIndex) && monthIndex >= 0 && monthIndex < 12) {
          return createPeriodRange(new Date(year, monthIndex, 1), new Date(year, monthIndex + 1, 0));
        }
      }
    }

    return null;
  }, [customPeriodRange, period, taskPeriods]);
  const filteredTasks = useMemo(() => {
    if (!periodRange) {
      return baseTaskList;
    }
    const startTime = periodRange.startDate.getTime();
    const endTime = periodRange.endDate.getTime();
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      return baseTaskList;
    }
    return baseTaskList.filter((task) => {
      const marker = task.completedAt ?? task.startedAt ?? task.updatedAt ?? task.createdAt ?? null;
      if (!marker) {
        return true;
      }
      const markerTime = new Date(marker).getTime();
      if (!Number.isFinite(markerTime)) {
        return true;
      }
      return markerTime >= startTime && markerTime <= endTime;
    });
  }, [baseTaskList, periodRange]);
  const selectedTasksAutoRange = useMemo(() => {
    if (baseTaskList.length === 0) {
      return null;
    }
    const timestamps: number[] = [];
    baseTaskList.forEach((task) => {
      const marker = task.completedAt ?? task.startedAt ?? task.updatedAt ?? task.createdAt ?? null;
      if (!marker) {
        return;
      }
      const markerTime = new Date(marker).getTime();
      if (Number.isFinite(markerTime)) {
        timestamps.push(markerTime);
      }
    });
    if (timestamps.length === 0) {
      return null;
    }
    const start = new Date(Math.min(...timestamps));
    const end = new Date(Math.max(...timestamps));
    return createPeriodRange(start, end);
  }, [baseTaskList, createPeriodRange]);
  const [profileMap, setProfileMap] = useState<Record<string, ContractUiProfile | null>>({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [groupOverrides, setGroupOverrides] = useState<Record<string, GroupOverride>>({});
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const [packagePreview, setPackagePreview] = useState<PackageCreateResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [useGptNarrative, setUseGptNarrative] = useState(true);

  const contractsById = useMemo(() => {
    const map = new Map<string, Contract>();
    contracts.forEach((contract) => {
      map.set(contract.id, contract);
    });
    return map;
  }, [contracts]);

  const individualsById = useMemo(() => {
    const map = new Map<string, Individual>();
    individuals.forEach((person) => {
      map.set(person.id, person);
    });
    return map;
  }, [individuals]);

  const projectSystemByKey = useMemo(() => {
    const map = new Map<string, string>();
    trackerProjects.forEach((project) => {
      if (project.key) {
        map.set(project.key, project.tracker || 'Jira');
      }
    });
    return map;
  }, [trackerProjects]);

  const performerOptions = useMemo(() => {
    const unique = new Map<string, { label: string }>();
    baseTaskList.forEach((task) => {
      const contract = task.contractId ? contractsById.get(task.contractId) ?? null : null;
      const performerId = task.contractorId ?? contract?.contractorId ?? null;
      if (!performerId || unique.has(performerId)) {
        return;
      }
      const performer = individualsById.get(performerId) ?? null;
      unique.set(performerId, { label: performer?.name || 'Исполнитель' });
    });
    return Array.from(unique.entries())
      .map(([value, meta]) => ({ value, label: meta.label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [baseTaskList, contractsById, individualsById]);

  const allPerformerIds = useMemo(
    () => performerOptions.map((option) => option.value),
    [performerOptions],
  );

  const performerLabelById = useMemo(() => {
    const map = new Map<string, string>();
    performerOptions.forEach((option) => {
      map.set(option.value, option.label);
    });
    return map;
  }, [performerOptions]);

  const performerSelectionLabel = useMemo(() => {
    const performerCount = performerLabelById.size;
    if (selectedPerformerIds === 'all') {
      return performerCount === 0 ? 'Нет исполнителей' : 'Все исполнители';
    }
    if (selectedPerformerIds.length === 0) {
      return 'Не выбрано';
    }
    if (selectedPerformerIds.length === 1) {
      return performerLabelById.get(selectedPerformerIds[0]) ?? '1 исполнитель';
    }
    return `Выбрано ${selectedPerformerIds.length} ${pluralizePerformers(selectedPerformerIds.length)}`;
  }, [performerLabelById, selectedPerformerIds]);

  const handlePerformerCheckedChange = useCallback(
    (performerId: string, checked: boolean) => {
      setSelectedPerformerIds((current) => {
        const nextSet = new Set(current === 'all' ? allPerformerIds : current);
        if (checked) {
          nextSet.add(performerId);
        } else {
          nextSet.delete(performerId);
        }
        if (nextSet.size === 0) {
          return [];
        }
        if (nextSet.size === allPerformerIds.length) {
          return 'all';
        }
        return allPerformerIds.filter((id) => nextSet.has(id));
      });
    },
    [allPerformerIds],
  );
  const handleCustomRangeSelect = useCallback((range?: DateRange) => {
    if (!range?.from) {
      setCustomPeriodRange(undefined);
      return;
    }
    const nextRange: DateRange = {
      from: range.from,
      to: range.to ?? range.from,
    };
    setCustomPeriodRange(nextRange);
  }, []);

  const selectedTasks = useMemo(() => {
    if (isBulkDocumentsMode) {
      if (selectedPerformerIds === 'all') {
        return filteredTasks;
      }
      const selectedSet = new Set(selectedPerformerIds);
      if (selectedSet.size === 0) {
        return [];
      }
      return filteredTasks.filter((task) => {
        const contract = task.contractId ? contractsById.get(task.contractId) ?? null : null;
        const performerId = task.contractorId ?? contract?.contractorId ?? null;
        return performerId !== null && selectedSet.has(performerId);
      });
    }
    return filteredTasks;
  }, [contractsById, filteredTasks, isBulkDocumentsMode, selectedPerformerIds]);

  const contractsByPerformerId = useMemo(() => {
    const map = new Map<string, Contract[]>();
    contracts.forEach((contract) => {
      if (!contract.contractorId) {
        return;
      }
      const bucket = map.get(contract.contractorId);
      if (bucket) {
        bucket.push(contract);
      } else {
        map.set(contract.contractorId, [contract]);
      }
    });
    return map;
  }, [contracts]);

  const legalEntitiesById = useMemo(() => {
    const map = new Map<string, typeof legalEntities[number]>();
    legalEntities.forEach((entity) => {
      map.set(entity.id, entity);
    });
    return map;
  }, [legalEntities]);

  const periodOptions = useMemo(() => {
    const capitalize = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);
    const buildDescription = (start: Date, end: Date) => `${dateFormatter.format(start)} — ${dateFormatter.format(end)}`;
    const createMonthlyOption = (reference: Date) => {
      const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
      const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
      const value = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
      return {
        value,
        label: capitalize(monthLabelFormatter.format(reference)),
        description: buildDescription(start, end),
      };
    };
    const parseMonthLabel = (value: string, fallback?: string | null) => {
      const match = /^(\d{4})-(\d{2})$/.exec(value);
      if (!match) {
        return fallback ?? value;
      }
      const year = Number(match[1]);
      const monthIndex = Number(match[2]) - 1;
      if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
        return fallback ?? value;
      }
      return capitalize(monthLabelFormatter.format(new Date(year, monthIndex, 1)));
    };
    const dedup = new Map<string, { value: string; label: string; description?: string }>();
    const pushOption = (option: { value: string; label: string; description?: string }) => {
      if (!option.value || dedup.has(option.value)) {
        return;
      }
      dedup.set(option.value, option);
    };

    if (taskPeriods.length === 0) {
      const now = new Date();
      pushOption(createMonthlyOption(now));
      pushOption(createMonthlyOption(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      pushOption(createMonthlyOption(new Date(now.getFullYear(), now.getMonth() - 2, 1)));
    } else {
      taskPeriods.forEach((period) => {
        if (!period?.value) {
          return;
        }
        const startDate = period.start ? new Date(period.start) : null;
        const endDate = period.end ? new Date(period.end) : null;
        const hasValidDates =
          startDate instanceof Date && !Number.isNaN(startDate.getTime()) &&
          endDate instanceof Date && !Number.isNaN(endDate.getTime());
        const label = hasValidDates && startDate
          ? capitalize(monthLabelFormatter.format(startDate))
          : parseMonthLabel(period.value, period.label);
        const description = hasValidDates && startDate && endDate
          ? buildDescription(startDate, endDate)
          : period.label ?? period.value;
        pushOption({
          value: period.value,
          label,
          description,
        });
      });
    }

    return Array.from(dedup.values());
  }, [taskPeriods]);

  const fallbackPeriod = periodOptions[0]?.value ?? 'custom';

  useEffect(() => {
    if (!open) {
      setStep('snapshot');
      setCustomPeriodRange(undefined);
      setPeriod(isBulkDocumentsMode ? (defaultPeriod && defaultPeriod !== 'all' ? defaultPeriod : fallbackPeriod) : 'custom');
      setProfileMap({});
      setGroupOverrides({});
      setActiveGroupKey(null);
      setPackagePreview(null);
      setFormError(null);
      setSelectedPerformerIds('all');
      setPerformerSelectorOpen(false);
      setUseGptNarrative(true);
      return;
    }

    if (!isBulkDocumentsMode) {
      if (selectedTasksAutoRange) {
        setCustomPeriodRange({ from: selectedTasksAutoRange.startDate, to: selectedTasksAutoRange.endDate });
      } else {
        setCustomPeriodRange(undefined);
      }
      setPeriod('custom');
      return;
    }

    if (defaultPeriod && defaultPeriod !== 'all' && periodOptions.some((option) => option.value === defaultPeriod)) {
      setPeriod(defaultPeriod);
    } else {
      setPeriod(fallbackPeriod);
    }
  }, [
    open,
    isBulkDocumentsMode,
    defaultPeriod,
    fallbackPeriod,
    periodOptions,
    selectedTasksAutoRange,
  ]);

  useEffect(() => {
    if (period === 'custom') {
      return;
    }
    const preset = taskPeriods.find((item) => item.value === period);
    if (preset?.start && preset?.end) {
      setCustomPeriodRange({ from: new Date(preset.start), to: new Date(preset.end) });
    }
  }, [period, taskPeriods]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const uniqueContractIds = Array.from(new Set(selectedTasks.map((task) => task.contractId).filter(Boolean))) as string[];
    const missing = uniqueContractIds.filter((id) => profileMap[id] === undefined);
    if (missing.length === 0) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      setProfileLoading(true);
      const entries = await Promise.all(
        missing.map(async (id) => {
          const numericId = Number(id);
          if (!Number.isFinite(numericId)) {
            return [id, null] as const;
          }
          try {
            const profile = await getContractUiProfile(id);
            return [id, profile] as const;
          } catch (error) {
            console.error('[DocumentGenerationDialog] Failed to load profile', id, error);
            return [id, null] as const;
          }
        }),
      );
      if (cancelled) {
        return;
      }
      setProfileMap((prev) => {
        const next = { ...prev };
        entries.forEach(([id, profile]) => {
          next[id] = profile;
        });
        return next;
      });
      setProfileLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, selectedTasks, profileMap, getContractUiProfile]);

  const groupMatrix = useMemo<GroupMatrixEntry[]>(() => {
    const map = new Map<string, {
      tasks: Task[];
      contract: Contract | null;
      performer: Individual | null;
      performerType: Contract['performerType'];
      projectKey: string | null;
      projectName: string | null;
      contractDiagnostics: GroupMatrixEntry['contractDiagnostics'];
    }>();

    selectedTasks.forEach((task) => {
      const performerId = task.contractorId ?? null;
      const performer = performerId ? individualsById.get(performerId) ?? null : null;

      const directContract = task.contractId ? contractsById.get(task.contractId) ?? null : null;
      let contract: Contract | null = null;
      let mismatchedContractId: string | null = null;
      if (directContract) {
        if (!performerId || directContract.contractorId === performerId) {
          contract = directContract;
        } else {
          mismatchedContractId = directContract.id;
        }
      }

      const performerContracts = performerId ? contractsByPerformerId.get(performerId) ?? [] : [];
      let candidateContracts = performerContracts;
      if (performerContracts.length > 0 && task.clientId) {
        const filtered = performerContracts.filter((candidate) => candidate.clientId === task.clientId);
        if (filtered.length > 0) {
          candidateContracts = filtered;
        }
      }

      if (!contract) {
        if (candidateContracts.length === 1) {
          contract = candidateContracts[0];
          candidateContracts = [];
        } else {
          contract = null;
        }
      } else {
        candidateContracts = [];
      }

      const contractDiagnostics: GroupMatrixEntry['contractDiagnostics'] = {
        mismatchedContractId,
        candidateContracts: contract ? [] : candidateContracts,
      };

      const performerType = performer?.legalType ?? contract?.performerType ?? 'gph';
      const projectKey = normalizeProjectKey(task);
      const key = [contract?.id ?? 'no-contract', performerId ?? 'no-performer', projectKey ?? '—'].join('::');
      const bucket = map.get(key);
      if (bucket) {
        bucket.tasks.push(task);
        if (!bucket.contract && contract) {
          bucket.contract = contract;
        }
        if (!bucket.performer && performer) {
          bucket.performer = performer;
        }
        if (bucket.performerType !== performerType) {
          bucket.performerType = performerType;
        }
        if (!bucket.projectName && task.projectName) {
          bucket.projectName = task.projectName;
        }
        if (!bucket.contractDiagnostics.mismatchedContractId && contractDiagnostics.mismatchedContractId) {
          bucket.contractDiagnostics.mismatchedContractId = contractDiagnostics.mismatchedContractId;
        }
        if (contractDiagnostics.candidateContracts.length > 0) {
          const existingIds = new Set(bucket.contractDiagnostics.candidateContracts.map((candidate) => candidate.id));
          contractDiagnostics.candidateContracts.forEach((candidate) => {
            if (!existingIds.has(candidate.id)) {
              bucket.contractDiagnostics.candidateContracts.push(candidate);
            }
          });
        }
      } else {
        map.set(key, {
          tasks: [task],
          contract,
          performer,
          performerType,
          projectKey,
          projectName: task.projectName ?? null,
          contractDiagnostics,
        });
      }
    });

    const entries: GroupMatrixEntry[] = [];
    const now = new Date();

    map.forEach(({ tasks: groupTasks, contract, performer, performerType, projectKey, projectName, contractDiagnostics }, key) => {
      const profile = contract ? profileMap[contract.id] ?? null : null;
      const rulesCatalog = profile?.document_rules ?? LOCAL_RULES;
      const rules = rulesCatalog[performerType ?? 'gph'] ?? LOCAL_RULES.gph;
      const rawDocOptions = (rules.docs as DocServerCode[])
        .filter((doc) => DOC_CODE_LABELS[doc])
        .sort((a, b) => DOC_CODE_ORDER.indexOf(a) - DOC_CODE_ORDER.indexOf(b));
      let docOptions = rawDocOptions;
      let defaultDocs = ((profile?.default_documents as DocServerCode[] | undefined)?.filter((doc) => docOptions.includes(doc)) ?? docOptions).sort(
        (a, b) => DOC_CODE_ORDER.indexOf(a) - DOC_CODE_ORDER.indexOf(b),
      );
      const includeTimesheetDefault = contract?.includeTimesheetByDefault ?? Boolean(rules.timesheet?.default);
      const contractVatSettings = normalizeVatSettings(contract?.vatSettings, contract?.vatMode);
      const profileVatSettings = profile ? vatSettingsFromLegacyMode(profile.default_vat_mode) : null;
      const vatSettingsDefault = contractVatSettings.status === 'payer'
        ? contractVatSettings
        : profileVatSettings ?? contractVatSettings;
      const vatPercentDefault = vatPercentFromSettings(vatSettingsDefault);
      const requiresNpdReceipt = Boolean(contract?.requireNpdReceipt || rules.extraFlags?.requireNpdReceipt);
      const totalHours = groupTasks.reduce((sum, task) => sum + Math.max(task.hours ?? 0, 0), 0);
      const legalEntity = contract?.clientId ? legalEntitiesById.get(contract.clientId) ?? null : null;
      const invoiceRequired = Boolean(legalEntity?.requireInvoice);

      const badges: GroupBadge[] = [];
      if (shouldShowVatBadge(performer, performerType)) {
        const vatBadgeLabel = describeVatSettings(vatSettingsDefault);
        const vatBadgeTone: GroupBadge['tone'] = (() => {
          if (vatSettingsDefault.status !== 'payer') {
            return 'muted';
          }
          if (vatSettingsDefault.exempt || vatPercentDefault === 0) {
            return 'warning';
          }
          return 'info';
        })();
        badges.push({ id: 'vat', label: vatBadgeLabel, tone: vatBadgeTone });
      }
      if (performer && performer.status !== 'complete') {
        badges.push({ id: 'performer-incomplete', label: 'Карточка не заполнена', tone: 'warning' });
      }
      if (performerType === 'employee') {
        badges.push({ id: 'employee', label: 'Штатник', tone: 'info' });
      }
      if (performerType === 'selfemployed') {
        badges.push({ id: 'selfemployed', label: 'НПД', tone: 'info' });
      }
      if (requiresNpdReceipt) {
        badges.push({ id: 'npd', label: 'Чек НПД потребуется', tone: 'warning' });
      }

      const warnings: GroupWarning[] = [];
      if (!contract) {
        if (contractDiagnostics.mismatchedContractId) {
          warnings.push({
            type: 'contract-mismatch',
            message: `Контракт ${contractDiagnostics.mismatchedContractId} привязан к проекту, но исполнитель не совпадает.`,
            severity: 'danger',
          });
        }

        if (contractDiagnostics.candidateContracts.length > 1) {
          const numbers = contractDiagnostics.candidateContracts
            .map((candidate) => candidate.number || candidate.id)
            .filter(Boolean)
            .slice(0, 3)
            .join(', ');
          warnings.push({
            type: 'contract-ambiguous',
            message: `У исполнителя найдено несколько контрактов (${numbers}${contractDiagnostics.candidateContracts.length > 3 ? '…' : ''}). Уточните настройку проекта.`,
            severity: 'danger',
          });
        }

        if (contractDiagnostics.candidateContracts.length === 0 && !contractDiagnostics.mismatchedContractId) {
          warnings.push({ type: 'no-contract', message: 'У исполнителя нет подходящего контракта', severity: 'danger' });
        }
      } else if (contract.validTo) {
        const validToDate = new Date(contract.validTo);
        if (!Number.isNaN(validToDate.valueOf())) {
          if (validToDate.getTime() < now.getTime()) {
            warnings.push({ type: 'contract-expired', message: `Контракт истёк ${dateFormatter.format(validToDate)}`, severity: 'danger' });
            badges.push({ id: 'contract-expired', label: `до ${dateFormatter.format(validToDate)}`, tone: 'danger' });
          } else {
            const diffDays = Math.round((validToDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            if (contract.expirationReminderEnabled && contract.expirationReminderDays && diffDays <= contract.expirationReminderDays) {
              warnings.push({ type: 'contract-expiring', message: `Контракт истекает через ${diffDays} дн.`, severity: 'warning' });
              badges.push({ id: 'contract-expiring', label: `до ${dateFormatter.format(validToDate)}`, tone: 'warning' });
            } else {
              badges.push({ id: 'contract-valid', label: `до ${dateFormatter.format(validToDate)}`, tone: 'muted' });
            }
          }
        }
      }

      if (!performer) {
        warnings.push({ type: 'no-performer', message: 'Исполнитель не найден в справочнике', severity: 'warning' });
      } else if (performer.status !== 'complete') {
        warnings.push({
          type: 'performer-incomplete',
          message: 'Заполните данные исполнителя в справочнике (ИНН, паспорт, адрес).',
          severity: 'warning',
        });
      }

      if (contract?.rateType === 'month' && !contract.normHours) {
        warnings.push({ type: 'missing-norm-hours', message: 'Не задана норма часов для месячной ставки', severity: 'warning' });
      }

      if (totalHours <= 0) {
        warnings.push({
          type: 'no-hours',
          message: 'В задачах нет учтённых часов. Если нужен акт, добавьте часы в выбранные задачи.',
          severity: 'warning',
        });
      }

      if (invoiceRequired) {
        badges.push({ id: 'invoice-required', label: 'Счёт-фактура обязательна', tone: 'info' });
        if (!defaultDocs.includes('INVOICE')) {
          warnings.push({ type: 'invoice-required', message: 'Заказчик требует счёт-фактуру в пакете', severity: 'warning' });
        }
      }

      const templatesByDoc: Record<DocServerCode, string | null> = {
        AVR: contract?.templateAvrId ?? null,
        APP: contract?.templateIprId ?? null,
        IPR: contract?.templateIprId ?? null,
        INVOICE: contract?.templateInvoiceId ?? null,
        SERVICE_ASSIGN: null,
        ORDER: null,
      };

      const allowedTemplateIds = Array.isArray(contract?.allowedTemplateIds)
        ? contract!.allowedTemplateIds.filter(Boolean)
        : [];
      const allowedTemplateSet = new Set(allowedTemplateIds);
      const restrictToAllowedTemplates = allowedTemplateSet.size > 0;

      const allowedTemplatesList = templates.filter((template) => allowedTemplateSet.has(template.id));
      const docCodesFromTemplates = new Set<DocServerCode>();
      allowedTemplatesList.forEach((template) => {
        const docCode = resolveDocCodeForTemplate(template, performerType);
        if (docCode) {
          docCodesFromTemplates.add(docCode);
          templatesByDoc[docCode] = template.id;
        }
      });

      docOptions = Array.from(new Set([...docOptions, ...docCodesFromTemplates])).sort(
        (a, b) => DOC_CODE_ORDER.indexOf(a) - DOC_CODE_ORDER.indexOf(b),
      );
      defaultDocs = Array.from(new Set([...defaultDocs, ...docOptions])).sort(
        (a, b) => DOC_CODE_ORDER.indexOf(a) - DOC_CODE_ORDER.indexOf(b),
      );

      const buildTemplateOptions = (docs: DocServerCode[]) =>
        docs.reduce((acc, doc) => {
          const bucket = getTemplateBucket(doc);
          let options = templates.filter((template) => {
            if (bucket === 'custom') {
              return template.type === 'custom';
            }
            return template.type === bucket;
          });
          if (restrictToAllowedTemplates) {
            options = options.filter((template) => allowedTemplateSet.has(template.id));
          }
          options = options.filter((template) => resolveDocCodeForTemplate(template, performerType) === doc);
          const templateId = templatesByDoc[doc];
          if (templateId && !options.some((template) => template.id === templateId)) {
            const fallbackTemplate = templates.find((template) => template.id === templateId);
            if (fallbackTemplate) {
              options = [fallbackTemplate, ...options];
            }
          }
          acc[doc] = options;
          return acc;
        }, {} as Record<DocServerCode, Template[]>);

      const templateOptions = buildTemplateOptions(docOptions);

      docOptions.forEach((doc) => {
        if (!templatesByDoc[doc]) {
          const firstTemplate = templateOptions[doc]?.[0] ?? null;
          templatesByDoc[doc] = firstTemplate ? firstTemplate.id : null;
        }
      });

      let templateEntries = restrictToAllowedTemplates
        ? allowedTemplatesList.map((template) => {
            const fallbackDoc = template.type === 'timesheet' ? 'SERVICE_ASSIGN' : 'AVR';
            const doc = resolveDocCodeForTemplate(template, performerType) ?? fallbackDoc;
            return {
              doc,
              templateId: template.id,
              templateName: template.name,
            };
          })
        : docOptions.map((doc) => {
            const templateId = templatesByDoc[doc];
            const template = templateId ? templatesById.get(templateId) ?? null : null;
            const templateName = template?.name ?? DOC_CODE_LABELS[doc];
            return {
              doc,
              templateId: template?.id ?? null,
              templateName,
            };
          });

      const existingDocsInEntries = new Set(templateEntries.map((entry) => entry.doc));
      docOptions.forEach((doc) => {
        if (!existingDocsInEntries.has(doc)) {
          templateEntries.push({ doc, templateId: templatesByDoc[doc], templateName: DOC_CODE_LABELS[doc] });
        }
      });

      const usageFlags: UsageFlags = {
        grants: Boolean(contract?.usageGrantsEnabled),
        invoice: Boolean(contract?.usageInvoiceEnabled),
        tax: Boolean(contract?.usageTaxReportingEnabled),
        internal: Boolean(contract?.usageInternalEnabled),
      };

      templatesByDoc.AVR = docOptions.includes('AVR') ? templatesByDoc.AVR : null;
      templatesByDoc.APP = docOptions.includes('APP') ? templatesByDoc.APP : null;
      templatesByDoc.IPR = docOptions.includes('IPR') ? templatesByDoc.IPR : null;
      templatesByDoc.INVOICE = docOptions.includes('INVOICE') ? templatesByDoc.INVOICE : null;
      templatesByDoc.SERVICE_ASSIGN = docOptions.includes('SERVICE_ASSIGN') ? templatesByDoc.SERVICE_ASSIGN : null;
      templatesByDoc.ORDER = docOptions.includes('ORDER') ? templatesByDoc.ORDER : null;

      entries.push({
        key,
        contract,
        contractProfile: profile,
        performer,
        performerType,
        projectKey,
        projectName,
        tasks: groupTasks,
        contractDiagnostics,
        docOptions,
        defaultDocs,
        rateRule: rules.rate.mode ?? 'readonly',
        timesheetRule: rules.timesheet?.mode ?? 'readonly',
        vatRule: rules.vatMode ?? 'hidden',
        includeTimesheetDefault,
        vatSettingsDefault,
        vatPercentDefault,
        normHours: contract?.normHours ?? null,
        requiresNpdReceipt,
        invoiceRequired,
        badges,
        warnings,
        totalHours,
        templatesByDoc,
        templateOptions,
        templateEntries,
        usageFlags,
      });
    });

    return entries.sort((a, b) => a.key.localeCompare(b.key));
  }, [
    selectedTasks,
    contractsById,
    contractsByPerformerId,
    individualsById,
    legalEntitiesById,
    profileMap,
    templates,
    templatesById,
  ]);

  useEffect(() => {
    setGroupOverrides((prev) => {
      const next: Record<string, GroupOverride> = {};
      groupMatrix.forEach((group) => {
        const existing = prev[group.key];
        const mergedDocs = Array.from(new Set([...(existing?.docs ?? []), ...group.defaultDocs])).sort(
          (a, b) => DOC_CODE_ORDER.indexOf(a) - DOC_CODE_ORDER.indexOf(b),
        );
        const mergedTemplates = { ...group.templatesByDoc, ...(existing?.templates ?? {}) };
        const mergedUsage: UsageFlags = {
          grants: existing?.usage?.grants ?? group.usageFlags.grants,
          invoice: existing?.usage?.invoice ?? group.usageFlags.invoice,
          tax: existing?.usage?.tax ?? group.usageFlags.tax,
          internal: existing?.usage?.internal ?? group.usageFlags.internal,
        };
        const normalizedVat = existing?.vatSettings
          ? normalizeVatSettings(existing.vatSettings)
          : group.vatSettingsDefault;
        next[group.key] = {
          docs: mergedDocs,
          rate: existing?.rate ?? group.contract?.rate ?? 0,
          includeTimesheet: existing?.includeTimesheet ?? group.includeTimesheetDefault,
          vatSettings: normalizedVat,
          templates: mergedTemplates,
          npdReceiptConfirmed: existing?.npdReceiptConfirmed ?? false,
          usage: mergedUsage,
        };
      });
      return next;
    });
  }, [groupMatrix]);

  const uniquePerformerStats = useMemo(() => {
    const counts: Record<string, number> = {};
    groupMatrix.forEach((group) => {
      const type = group.performerType ?? 'gph';
      counts[type] = (counts[type] ?? 0) + 1;
    });
    return counts;
  }, [groupMatrix]);

  const totalHours = useMemo(
    () => groupMatrix.reduce((sum, group) => sum + group.totalHours, 0),
    [groupMatrix],
  );

  const totalTasks = selectedTasks.length;

  const resolvePeriodBoundaries = useCallback(() => {
    if (periodRange) {
      return { start: periodRange.startValue, end: periodRange.endValue };
    }

    const preset = taskPeriods.find((item) => item.value === period);
    if (preset?.start && preset?.end) {
      return { start: preset.start, end: preset.end };
    }

    if (selectedTasksAutoRange) {
      return {
        start: selectedTasksAutoRange.startValue,
        end: selectedTasksAutoRange.endValue,
      };
    }

    const today = new Date();
    const startOfMonth = toStartOfDay(new Date(today.getFullYear(), today.getMonth(), 1));
    const endOfMonth = toEndOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    return {
      start: formatIsoDate(startOfMonth),
      end: formatIsoDate(endOfMonth),
    };
  }, [period, periodRange, selectedTasksAutoRange, taskPeriods]);

  const groupSummaries = useMemo(() => {
    return groupMatrix.map((group) => {
      const override = groupOverrides[group.key];
      const docs = (override?.docs ?? group.defaultDocs).slice().sort((a, b) => DOC_CODE_ORDER.indexOf(a) - DOC_CODE_ORDER.indexOf(b));
      const rate = override?.rate ?? group.contract?.rate ?? 0;
      const timesheet = override?.includeTimesheet ?? group.includeTimesheetDefault;
      const vatSettings = normalizeVatSettings(override?.vatSettings ?? group.vatSettingsDefault);
      const vatPercent = vatPercentFromSettings(vatSettings);
      const vatModeLegacy = vatSettingsToLegacyMode(vatSettings);
      const normHours = group.contract?.rateType === 'month' ? group.normHours ?? 0 : null;
      const effectiveRate = group.contract?.rateType === 'month'
        ? normHours && normHours > 0 ? rate / normHours : 0
        : rate;
      const amount = Number((effectiveRate * group.totalHours).toFixed(2));
      const vatAmount = vatPercent ? Number((amount - amount / (1 + vatPercent / 100)).toFixed(2)) : 0;
      const blockingIssues: string[] = [];
      if (group.warnings.some((warning) => warning.severity === 'danger')) {
        blockingIssues.push('Есть критические предупреждения по группе');
      }
      if (group.contract?.rateType === 'month' && (!group.normHours || group.normHours <= 0)) {
        blockingIssues.push('Не указана норма часов для месячной ставки');
      }
      if (group.invoiceRequired && !docs.includes('INVOICE')) {
        blockingIssues.push('Заказчик требует счёт-фактуру в пакете');
      }
      if (group.totalHours <= 0 && docs.includes('AVR')) {
        blockingIssues.push('Акт не сформируется: в выбранных задачах нет учтённых часов.');
      }
      const npdReceiptMissing = group.requiresNpdReceipt && !(override?.npdReceiptConfirmed ?? false);
      return {
        group,
        docs,
        rate,
        timesheet,
        vatSettings,
        vatModeLegacy,
        vatPercent,
        amount,
        vatAmount,
        effectiveRate,
        blockingIssues,
        npdReceiptMissing,
        override,
      };
    });
  }, [groupMatrix, groupOverrides]);

  const hasBlockingIssues = groupSummaries.some((summary) => summary.blockingIssues.length > 0);

  const suggestionsDigest = useMemo(() => {
    return groupSummaries
      .map((summary) => {
        const performerName = describePerformer(summary.group.performer, summary.group.performerType);
        const contractLabel = summary.group.contract?.number || summary.group.contract?.id || null;
        const criticalWarnings = summary.group.warnings
          .filter((warning) => warning.severity === 'danger')
          .map((warning) => warning.message);
        const explicitBlocking = summary.blockingIssues.filter((message) => message !== 'Есть критические предупреждения по группе');
        const performerNeedsAttention = Boolean(summary.group.performer && summary.group.performer.status !== 'complete');
        const directoryMessages = performerNeedsAttention ? ['Карточка исполнителя требует заполнения в справочнике.'] : [];
        const mergedMessages = Array.from(new Set([...criticalWarnings, ...explicitBlocking, ...directoryMessages])).filter((message) => Boolean(message));
        const hasIssues = mergedMessages.length > 0;
        return hasIssues
          ? {
              key: summary.group.key,
              performerName,
              contractLabel,
              messages: mergedMessages,
            }
          : null;
      })
      .filter((item): item is { key: string; performerName: string; contractLabel: string | null; messages: string[] } => Boolean(item));
  }, [groupSummaries]);

  const pendingNpdGroups = useMemo(
    () => groupSummaries.filter((summary) => summary.npdReceiptMissing),
    [groupSummaries],
  );

  const groupSummaryMap = useMemo(() => {
    const map = new Map<string, (typeof groupSummaries)[number]>();
    groupSummaries.forEach((summary) => {
      map.set(summary.group.key, summary);
    });
    return map;
  }, [groupSummaries]);

  const handleDirectoryRedirect = useCallback(
    (groupKey: string) => {
      const summary = groupSummaryMap.get(groupKey);
      if (!summary || !onDirectoryFocusRequested) {
        setActiveGroupKey(groupKey);
        return;
      }

      const performerNeedsAttention = Boolean(summary.group.performer && summary.group.performer.status !== 'complete');
      const shouldRedirectToDirectory = summary.blockingIssues.length > 0 || performerNeedsAttention;

      if (!shouldRedirectToDirectory) {
        setActiveGroupKey(groupKey);
        return;
      }

      const performerId = summary.group.performer?.id ?? null;
      const contractId = summary.group.contract?.id ?? null;

      const focus: DirectoryFocus =
        performerNeedsAttention && performerId
          ? {
              section: 'individual',
              performerId,
              ...(contractId ? { contractId } : {}),
            }
          : {
              section: 'contracts',
              ...(contractId ? { contractId } : {}),
              ...(performerId ? { performerId } : {}),
            };

      setActiveGroupKey(null);
      onOpenChange(false);
      onDirectoryFocusRequested(focus);
    },
    [groupSummaryMap, onDirectoryFocusRequested, onOpenChange],
  );

  const packageTotals = useMemo(() => {
    const docNameSet = new Set<string>();
    const docCount = groupSummaries.reduce((sum, summary) => {
      const seenEntries = new Set<string>();
      summary.group.templateEntries
        .filter((entry) => summary.docs.includes(entry.doc))
        .forEach((entry) => {
          const key = `${entry.doc}:${entry.templateId ?? entry.templateName}`;
          if (!seenEntries.has(key)) {
            seenEntries.add(key);
            docNameSet.add(entry.templateName);
          }
        });
      if (seenEntries.size === 0) {
        summary.docs.forEach((doc) => docNameSet.add(DOC_CODE_LABELS[doc]));
        return sum + summary.docs.length;
      }
      return sum + seenEntries.size;
    }, 0);

    const totalAmount = groupSummaries.reduce((sum, summary) => sum + summary.amount, 0);
    const totalVat = groupSummaries.reduce((sum, summary) => sum + summary.vatAmount, 0);

    return {
      docCount,
      docNames: Array.from(docNameSet),
      amount: totalAmount,
      vat: totalVat,
      hours: groupSummaries.reduce((sum, summary) => sum + summary.group.totalHours, 0),
      performers: groupSummaries.length,
      tasks: totalTasks,
    };
  }, [groupSummaries, totalTasks]);

  const handleSubmit = useCallback(async () => {
    const { start: periodStart, end: periodEnd } = resolvePeriodBoundaries();
    if (!periodStart || !periodEnd) {
      setFormError('Не удалось определить период. Укажите даты вручную.');
      return;
    }
    if (groupSummaries.length === 0) {
      setFormError('Нет данных для формирования документов.');
      return;
    }
    if (hasBlockingIssues) {
      setFormError('Устраните блокирующие предупреждения перед запуском.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    setPackagePreview(null);

    let includeTimesheets = false;
    const templatesOption: Record<string, string> = {};
    const tasksPayload: PackageTaskInput[] = [];
    const narrativeChunks: string[] = [];
    const narrativeFacts = new Set<string>();

    groupSummaries.forEach((summary) => {
      const { group, docs, rate, timesheet, vatModeLegacy, vatSettings, vatPercent, override } = summary;
      includeTimesheets = includeTimesheets || Boolean(timesheet);
      const groupNarrativeFragments: string[] = [];

      const templateSource = override?.templates ?? group.templatesByDoc;
      docs.forEach((doc) => {
        const templateId = templateSource[doc];
        if (templateId && !templatesOption[doc]) {
          templatesOption[doc] = templateId;
        }
      });

      const clientEntity = group.contract?.clientId ? legalEntitiesById.get(group.contract.clientId) ?? null : null;
      const fallbackLegacyContractId = group.contract?.id
        ?? group.contractDiagnostics.candidateContracts?.[0]?.id
        ?? null;
      const legacyContractId = fallbackLegacyContractId ? String(fallbackLegacyContractId) : undefined;
      const normalizedVatRate = vatSettings.status === 'payer' ? sanitizeVatRate(vatSettings.rate) : null;

      summary.group.tasks.forEach((task) => {
        const compactSummary = buildCompactTaskSummary(task.title, task.description);
        const narrativeFragment = buildTaskNarrativeFragment(task.title, task.description);
        if (narrativeFragment) {
          groupNarrativeFragments.push(narrativeFragment);
        }
        if (compactSummary) {
          narrativeFacts.add(compactSummary.replace(/\.+$/u, '').trim());
        }
        const performerId = resolveIndividualId(
          task.contractorId,
          task.assigneeEmail,
          task.assigneeDisplayName,
          task.assigneeAccountId,
          individuals,
        );
        const contractNumericId = group.contract?.id ? Number(group.contract.id) : NaN;

        const metaPayload: Record<string, unknown> = {
          group_key: group.key,
          performer_type: group.performerType,
          project_key: group.projectKey,
          project_name: group.projectName,
          projectKey: task.projectKey ?? undefined,
          projectName: task.projectName ?? undefined,
          doc_types: docs,
          vat_mode: vatModeLegacy,
          vat_status: vatSettings.status,
          vat_percent: vatPercent,
          vat_rate: normalizedVatRate ?? undefined,
          vat_exempt: vatSettings.status === 'payer' ? Boolean(vatSettings.exempt) : false,
          rate_override: rate,
          include_timesheet: timesheet,
          templates: templateSource,
          legacy_contract_id: legacyContractId,
          npd_receipt_confirmed: group.requiresNpdReceipt ? override?.npdReceiptConfirmed ?? false : undefined,
          task_id: task.id,
          billable: task.billable,
          force_included: task.forceIncluded,
          summary: compactSummary,
          status: task.status,
          assignee: task.assigneeDisplayName ?? undefined,
          email: task.assigneeEmail ?? undefined,
          account_id: task.assigneeAccountId ?? undefined,
        };

        const trackerLabel = projectSystemByKey.get(task.projectKey ?? '')
          ?? projectSystemByKey.get(summary.group.projectKey ?? '')
          ?? undefined;
        if (trackerLabel) {
          metaPayload.project_system = trackerLabel;
        }

        Object.keys(metaPayload).forEach((key) => {
          if (metaPayload[key] === undefined) {
            delete metaPayload[key];
          }
        });

        const payload: PackageTaskInput = {
          jira_id: task.key || task.id,
          hours: task.hours ?? 0,
          status: task.status,
          assignee_id: performerId ?? undefined,
          contract_id: Number.isFinite(contractNumericId) ? contractNumericId : undefined,
          performer_type: group.performerType,
          company_inn: clientEntity?.inn ?? undefined,
          meta: metaPayload,
        };
        tasksPayload.push(payload);
      });

      const uniqueFragments = Array.from(new Set(groupNarrativeFragments.map((fragment) => fragment.replace(/\s+/g, ' ').trim()))).filter(Boolean);
      if (uniqueFragments.length > 0) {
        const limitedFragments = uniqueFragments.slice(0, 3).map((fragment) => fragment.replace(/[.;\s]+$/u, ''));
        const projectLabel =
          summary.group.projectName ||
          summary.group.projectKey ||
          summary.group.contract?.number ||
          summary.group.contract?.id ||
          'проект';
        const performerLabel = summary.group.performer ? describePerformer(summary.group.performer, summary.group.performerType) : null;
        const performerClause = performerLabel ? ` исполнителя ${performerLabel}` : '';
        narrativeChunks.push(`По проекту ${projectLabel}${performerClause} выполнены задачи: ${limitedFragments.join('; ')}.`);
      }
    });

    const primaryGroup = groupSummaries[0];
    let templateVariables: Record<string, string> | undefined;
    if (primaryGroup) {
      const client = primaryGroup.group.contract?.clientId
        ? legalEntitiesById.get(primaryGroup.group.contract.clientId) ?? null
        : null;
      const performerName = primaryGroup.group.performer?.name ?? '';
      const candidate: Record<string, string> = {};
      if (client?.name) {
        candidate.companyName = client.name;
      }
      if (client?.signatory) {
        candidate.seoFullName = client.signatory;
        candidate.seoShortName = shortenFullName(client.signatory);
      }
      if (performerName) {
        candidate.contractorCompanyName = performerName;
        candidate.contractorSeoFullName = performerName;
        candidate.contractorseoShortName = shortenFullName(performerName);
      }
      if (Object.keys(candidate).length > 0) {
        templateVariables = candidate;
      }
    }

    const requestOptions: PackageCreateRequest['options'] = {
      include_timesheets: includeTimesheets,
      include_by_projects: 'auto',
      autopick_contract: true,
      allow_selfemployed_without_receipt: true,
      templates: templatesOption,
    };

    if (templateVariables) {
      requestOptions.template_variables = templateVariables;
    }

    if (useGptNarrative) {
      const periodStartDate = new Date(`${periodStart}T00:00:00`);
      const periodEndDate = new Date(`${periodEnd}T00:00:00`);
      const startLabel = Number.isNaN(periodStartDate.getTime()) ? periodStart : dateFormatter.format(periodStartDate);
      const endLabel = Number.isNaN(periodEndDate.getTime()) ? periodEnd : dateFormatter.format(periodEndDate);
      const totalHoursValue = groupSummaries.reduce((sum, summary) => sum + summary.group.totalHours, 0);
      const totalAmountValue = groupSummaries.reduce((sum, summary) => sum + summary.amount, 0);
      const totalTasksCount = groupSummaries.reduce((sum, summary) => sum + summary.group.tasks.length, 0);
      const condensedNarrative = (() => {
        if (narrativeChunks.length === 0) {
          return '';
        }
        const limited = narrativeChunks.slice(0, 4);
        if (narrativeChunks.length > 4) {
          limited.push(`Дополнительно закрыты ещё ${narrativeChunks.length - 4} направлений, отражённых в таблице работ.`);
        }
        return limited.join(' ');
      })();
      const factListForPrompt = (() => {
        if (narrativeFacts.size === 0) {
          return '';
        }
        const items = Array.from(narrativeFacts).slice(0, 12);
        return items
          .map((fact, index) => `${index + 1}) ${fact}`)
          .join(' ');
      })();
      const gptExtraNotes = [
        `Период отчёта: ${startLabel} — ${endLabel}.`,
        `Всего задач: ${totalTasksCount}. Отработано ${formatHours1Dec(totalHoursValue)} часов. Сумма к закрытию: ${formatCurrency(totalAmountValue)}.`,
        condensedNarrative ? `Контекст работ: ${condensedNarrative}` : '',
        factListForPrompt ? `Факты для описания: ${factListForPrompt}` : '',
        `Сформируй финальный текст максимум из шести предложений. Начни с фразы "С ${startLabel} по ${endLabel}..." и опиши ключевые результаты.`,
        'Не используй списки, маркировку, нумерацию или дословные перечни задач в финальном тексте. Объедини работы по смыслу и заверши абзац предложением с суммарными часами и стоимостью.',
      ]
        .filter(Boolean)
        .join(' ');
      requestOptions.gpt = {
        enabled: true,
        language: 'ru',
        style: 'concise',
        extraNotes: gptExtraNotes,
      };
    }

    const request: PackageCreateRequest = {
      ta_id: null,
      period_start: periodStart,
      period_end: periodEnd,
      tasks: tasksPayload,
      options: requestOptions,
    };

    try {
      const response = await generatePackage(request);
      setPackagePreview(response);
      await Promise.all([loadDocuments(), loadWorkPackages()]);
      onSuccess?.();
    } catch (error) {
      console.error('[DocumentGenerationDialog] Failed to generate package', error);
      setFormError('Не удалось сформировать пакет. Проверьте данные и попробуйте снова.');
    } finally {
      setIsSubmitting(false);
    }
  }, [generatePackage, groupSummaries, hasBlockingIssues, individuals, legalEntitiesById, loadDocuments, loadWorkPackages, onSuccess, projectSystemByKey, resolvePeriodBoundaries, useGptNarrative]);

  const handleDownload = useCallback(async (doc: PackageGeneratedDocument) => {
    if (!doc.file_url) {
      return;
    }
    const normalizedBase = apiBaseUrl.replace(/\/+$/, '');
    const downloadUrl = doc.file_url.startsWith('http://') || doc.file_url.startsWith('https://')
      ? doc.file_url
      : `${normalizedBase}${doc.file_url.startsWith('/') ? '' : '/'}${doc.file_url}`;

    try {
      const response = await fetch(downloadUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      if (!buffer.byteLength) {
        throw new Error('Файл получен пустым');
      }

      const contentType = response.headers.get('content-type') ?? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const blob = new Blob([buffer], { type: contentType });
      const url = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      const headerName = parseContentDispositionFilename(response.headers.get('content-disposition'));
      const fallbackName = doc.file_path ? doc.file_path.toString().split(/[\\/]/).pop() : null;
      link.href = url;
      link.download = headerName ?? fallbackName ?? `document-${doc.id}.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 1000);
    } catch (error) {
      console.error('Failed to download document', error);
    }
  }, [apiBaseUrl, token]);

  const renderGroupRow = (group: GroupMatrixEntry) => {
    const override = groupOverrides[group.key];
    const docs = (override?.docs ?? group.defaultDocs).slice().sort((a, b) => DOC_CODE_ORDER.indexOf(a) - DOC_CODE_ORDER.indexOf(b));
    const summarySnapshot = groupSummaryMap.get(group.key);
    const hasBlocking = Boolean(summarySnapshot?.blockingIssues.length);
    const performerNeedsAttention = Boolean(group.performer && group.performer.status !== 'complete');
    const showDirectoryButton = hasBlocking || performerNeedsAttention;
    const fixButtonVariant = hasBlocking ? 'destructive' : 'outline';
    const seenEntryKeys = new Set<string>();
    const activeEntries = group.templateEntries.filter((entry) => {
      if (!docs.includes(entry.doc)) {
        return false;
      }
      const key = `${entry.doc}:${entry.templateId ?? entry.templateName}`;
      if (seenEntryKeys.has(key)) {
        return false;
      }
      seenEntryKeys.add(key);
      return true;
    });
    const presentDocs = new Set(activeEntries.map((entry) => entry.doc));
    docs.forEach((doc) => {
      if (!presentDocs.has(doc)) {
        activeEntries.push({ doc, templateId: null, templateName: DOC_CODE_LABELS[doc] });
        presentDocs.add(doc);
      }
    });
    const performerName = describePerformer(group.performer, group.performerType);
    const contractTitle = group.contract?.number || group.contract?.id || '—';
    const warningsToShow = [...group.warnings];
    if (group.invoiceRequired && !docs.includes('INVOICE')) {
      warningsToShow.push({ type: 'invoice-required', message: 'Добавьте счёт-фактуру для этого заказчика', severity: 'warning' });
    }
    return (
      <div
        key={group.key}
        className="grid grid-cols-1 lg:grid-cols-[minmax(200px,1fr)_minmax(140px,0.8fr)_minmax(100px,0.6fr)_minmax(180px,1fr)_auto] items-start gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
      >
        <div className="min-w-0">
          <p className="font-medium text-sm text-gray-900 truncate">{performerName}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {group.performer?.legalType ? `Тип: ${group.performer.legalType}` : `Категория: ${group.performerType ?? '—'}`}
          </p>
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm text-gray-900 truncate">{contractTitle}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {group.badges.map((badge) => (
              <Badge
                key={badge.id}
                variant={badge.tone === 'danger' ? 'destructive' : badge.tone === 'warning' ? 'secondary' : 'outline'}
                className="text-xs"
              >
                {badge.label}
              </Badge>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm text-gray-900 truncate">{group.projectName || group.projectKey || 'Без проекта'}</p>
          <p className="text-xs text-gray-500 mt-0.5">Задач: {group.tasks.length}</p>
        </div>
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap gap-1.5">
            {activeEntries.map(({ doc, templateId, templateName }, index) => {
              const name = templateName || DOC_CODE_LABELS[doc];
              const canRemove = docs.length > 1;
              return (
                <div
                  key={`${doc}-${templateId ?? index}`}
                  className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs hover:bg-gray-100 transition-colors"
                  title={name}
                >
                  <span className="font-medium text-gray-900 truncate max-w-[120px]">{name}</span>
                  {canRemove && (
                    <button
                      type="button"
                      className="rounded p-0.5 text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
                      onClick={() => {
                        const nextDocs = docs.filter((item) => item !== doc);
                        const currentTemplates = override?.templates ?? group.templatesByDoc;
                        const nextTemplates = { ...currentTemplates };
                        if (templateId && nextTemplates[doc] === templateId) {
                          delete nextTemplates[doc];
                        }
                        updateGroupOverride(group.key, {
                          docs: nextDocs,
                          templates: nextTemplates,
                        });
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {warningsToShow.map((warning) => (
            <div key={warning.type} className={cn('flex items-center gap-1 text-xs', warning.severity === 'danger' ? 'text-red-600' : warning.severity === 'warning' ? 'text-amber-600' : 'text-gray-500')}>
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              <span className="line-clamp-2">{warning.message}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 document-actions-grid">
          {showDirectoryButton && (
            <Button
              size="sm"
              variant={fixButtonVariant}
              onClick={() => handleDirectoryRedirect(group.key)}
              className="whitespace-nowrap"
            >
              Внести правки
            </Button>
          )}
          {(group.rateRule === 'editable'
            || group.timesheetRule === 'editable'
            || (group.vatRule === 'editable' && isVatVisibleForPerformer(group.performerType))
            || group.requiresNpdReceipt
            || group.docOptions.length > 1) && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 flex-shrink-0"
              onClick={() => setActiveGroupKey(group.key)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  const activeGroup = activeGroupKey ? groupMatrix.find((group) => group.key === activeGroupKey) ?? null : null;
  const activeOverride = activeGroup ? groupOverrides[activeGroup.key] : null;

  const updateGroupOverride = (groupKey: string, patch: Partial<GroupOverride>) => {
    setGroupOverrides((prev) => {
      const current = prev[groupKey] ?? { docs: [], templates: {} };
      const next: GroupOverride = {
        ...current,
        ...patch,
      };
      if (patch.vatSettings) {
        next.vatSettings = normalizeVatSettings(patch.vatSettings);
      }
      return {
        ...prev,
        [groupKey]: next,
      };
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-h-[95vh] w-[96vw] max-w-[1550px] sm:max-w-[1550px]', dialogContentClassName)} aria-describedby="docgen-desc">
        <DialogHeader>
          <DialogTitle>Мастер формирования документов</DialogTitle>
          <DialogDescription id="docgen-desc" className="sr-only">
            Настройка групп документов по выбранным задачам.
          </DialogDescription>
        </DialogHeader>

        <div className="document-dialog-scroll space-y-5 overflow-y-auto pr-1">
          {/* Summary Block */}
          <div className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-gray-600" />
              <span className="font-medium text-gray-900">Снимем срез задач</span>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 text-gray-700">
              <span>Задач: <strong>{totalTasks}</strong></span>
              <span>Групп: <strong>{groupMatrix.length}</strong></span>
              <span>Часы: <strong>{formatHours1Dec(totalHours)}</strong></span>
              <span>
                Исполнители: <strong>{groupMatrix.length}</strong>
                {groupMatrix.length > 0 && (
                  <span className="text-xs text-gray-500 ml-1">
                    ({Object.entries(uniquePerformerStats)
                      .map(([key, count]) => `${count} ${performerTypeLabel(key as Contract['performerType'])}`)
                      .join(', ')})
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Critical Warnings Block - Always on Top */}
          {suggestionsDigest.length > 0 && (
            <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <span className="font-medium text-red-900">Подсказки</span>
              </div>
              <ul className="space-y-0.5 text-[11px] text-red-900">
                <li>• Нажмите "Внести правки", чтобы быстро открыть нужного исполнителя.</li>
                <li>• Красные предупреждения блокируют генерацию документов.</li>
                <li>• Если контракт истёк, обновите его в справочнике и обновите срез.</li>
              </ul>
              <div className="space-y-1.5 mt-2 pt-2 border-t border-red-300">
                <p className="font-medium text-red-700 text-xs">Нужно поправить:</p>
                <ul className="space-y-1.5">
                  {suggestionsDigest.map((item) => (
                    <li key={`suggest-${item.key}`} className="flex items-start justify-between gap-3">
                      <span className="text-red-600 text-[11px] leading-relaxed">
                        {item.performerName}
                        {item.contractLabel && item.contractLabel !== '—' ? ` • ${item.contractLabel}` : ''}: {item.messages.join('; ')}
                      </span>
                      <Button
                        variant="link"
                        size="sm"
                        className="px-0 text-red-600 hover:text-red-700 flex-shrink-0 h-auto text-[11px]"
                        onClick={() => handleDirectoryRedirect(item.key)}
                      >
                        Внести правки
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Tips Block - Only when no critical issues */}
          {groupMatrix.length > 0 && suggestionsDigest.length === 0 && (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4 text-sm">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-gray-600" />
                <span className="font-medium text-gray-900">Подсказки</span>
              </div>
              <ul className="space-y-1 text-xs text-gray-600">
                <li>• Нажмите "Внести правки", чтобы быстро открыть нужного исполнителя</li>
                <li>• Красные предупреждения блокируют генерацию документов</li>
                <li>• Если контракт истёк, обновите его в справочнике и обновите срез</li>
              </ul>
            </div>
          )}

          <div className="grid gap-4 document-matrix-grid md:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-gray-900">Матрица прав</h3>
                {profileLoading && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Загружаем профиль контрактов…
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500">
                Настройки подтянуты из справочника. При необходимости обновите карточку контракта или исполнителя.
              </p>
              <div className="space-y-3">
                {groupMatrix.map((group) => renderGroupRow(group))}
                {groupMatrix.length === 0 && (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
                    Выберите задачи, чтобы сформировать группы
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
              {isBulkDocumentsMode && (
                <>
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 mb-1">Исполнитель</h3>
                    <p className="text-xs text-gray-500 mb-2">
                      Выберите исполнителя для формирования пакета
                    </p>
                    <Popover open={performerSelectorOpen} onOpenChange={setPerformerSelectorOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-between">
                          <span className="truncate">{performerSelectionLabel}</span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedPerformerIds('all');
                              setPerformerSelectorOpen(false);
                            }}
                            disabled={selectedPerformerIds === 'all'}
                          >
                            Все исполнители
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedPerformerIds([])}
                            disabled={selectedPerformerIds !== 'all' && selectedPerformerIds.length === 0}
                          >
                            Очистить
                          </Button>
                        </div>
                        <ScrollArea className="mt-3 max-h-56 pr-2">
                          <div className="space-y-2">
                            {performerOptions.length === 0 ? (
                              <div className="text-xs text-muted-foreground">Нет доступных исполнителей</div>
                            ) : (
                              performerOptions.map((option) => {
                                const checked =
                                  selectedPerformerIds === 'all'
                                    ? true
                                    : selectedPerformerIds.includes(option.value);
                                return (
                                  <label key={option.value} className="flex items-center gap-2 text-sm">
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(value) =>
                                        handlePerformerCheckedChange(option.value, value === true)
                                      }
                                    />
                                    <span className="truncate">{option.label}</span>
                                  </label>
                                );
                              })
                            )}
                          </div>
                        </ScrollArea>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 mb-1">Период</h3>
                    <p className="text-xs text-gray-500 mb-2">Период применяется ко всем документам</p>
                    <Select value={period} onValueChange={setPeriod}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {periodOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <div>
                              <p className="text-sm font-medium">{option.label}</p>
                              {option.description && (
                                <p className="text-xs text-gray-500">{option.description}</p>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">
                          <div>
                            <p className="text-sm font-medium">Настраиваемый период</p>
                            <p className="text-xs text-gray-500">
                              {customPeriodSummary || 'Выберите даты вручную'}
                            </p>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {period === 'custom' && (
                      <Popover open={customPeriodPopoverOpen} onOpenChange={setCustomPeriodPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="mt-2 w-full justify-start">
                            <CalendarRange className="mr-2 h-4 w-4" />
                            {customPeriodSummary || 'Диапазон'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            initialFocus
                            mode="range"
                            defaultMonth={customPeriodRange?.from}
                            selected={customPeriodRange}
                            onSelect={handleCustomRangeSelect}
                            numberOfMonths={1}
                          />
                          <div className="flex items-center justify-between gap-2 border-t p-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setCustomPeriodRange(undefined);
                                setPeriod(fallbackPeriod);
                                setCustomPeriodPopoverOpen(false);
                              }}
                            >
                              Сбросить
                            </Button>
                            <Button
                              size="sm"
                              disabled={!customPeriodRange?.from}
                              onClick={() => {
                                if (customPeriodRange?.from) {
                                  setPeriod('custom');
                                  setCustomPeriodPopoverOpen(false);
                                }
                              }}
                            >
                              Применить
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  {filteredTasks.length === 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-600" />
                      <div>
                        <p className="text-sm font-medium text-red-800">Нет задач за выбранный период</p>
                        <p className="text-[11px] leading-relaxed">
                          Измените период или снимите фильтры, иначе документы не сформируются.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">Использовать GPT</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Текстовое описание вместо таблицы</p>
                  </div>
                  <Switch checked={useGptNarrative} onCheckedChange={setUseGptNarrative} />
                </div>
              </div>
              {pendingNpdGroups.length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900">
                  <div className="flex items-start gap-2">
                    <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-blue-600" />
                    <div className="space-y-1">
                      <p className="font-medium text-blue-900">Чек «Мой налог» не подтверждён</p>
                      <p className="text-blue-700 text-[11px] leading-relaxed">
                        Документы сформируем без задержки. После согласования вернитесь и отметьте получение чека.
                      </p>
                      <ul className="space-y-0.5 text-[11px] text-blue-800 mt-1">
                        {pendingNpdGroups.map((summary) => (
                          <li key={`npd-${summary.group.key}`} className="flex items-start gap-1">
                            <span className="text-blue-400 mt-0.5">•</span>
                            <span>
                              {describePerformer(summary.group.performer, summary.group.performerType)}
                              {summary.group.contract?.number ? ` • ${summary.group.contract.number}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              {groupSummaries.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-gray-900">Предварительный итог</h3>
                    <span className="text-gray-600">{packageTotals.performers} исполнителей</span>
                  </div>
                  <div className="grid gap-x-3 gap-y-1.5 md:grid-cols-2 text-gray-700">
                    <div><span className="text-gray-500">Документов:</span> <strong>{packageTotals.docCount}</strong></div>
                    <div><span className="text-gray-500">Задач:</span> <strong>{packageTotals.tasks}</strong></div>
                    <div><span className="text-gray-500">Часы:</span> <strong>{formatHours1Dec(packageTotals.hours)}</strong></div>
                    <div><span className="text-gray-500">Сумма:</span> <strong>{formatCurrency(packageTotals.amount)}</strong></div>
                    <div><span className="text-gray-500">НДС:</span> <strong>{formatCurrency(packageTotals.vat)}</strong></div>
                  </div>
                  {packageTotals.docNames.length > 0 && (() => {
                    const preview = packageTotals.docNames.slice(0, 4);
                    const remaining = packageTotals.docNames.length - preview.length;
                    return (
                      <div className="text-gray-700">
                        <span className="text-gray-500">Шаблоны:</span> {preview.join(', ')}
                        {remaining > 0 && ` и ещё ${remaining}`}
                      </div>
                    );
                  })()}
                  <div className="text-gray-700">
                    <span className="text-gray-500">GPT описания:</span> {useGptNarrative ? 'включено' : 'выключено'}
                  </div>
                </div>
              )}
            </div>
          </div>

          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-gray-900">Предпросмотр документов</h3>
                <span className="text-xs text-gray-500">Проверьте шаблоны, суммы и предупреждения</span>
              </div>
              <div className="space-y-3">
                {groupSummaries.map((summary) => (
                  <div key={summary.group.key} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {describePerformer(summary.group.performer, summary.group.performerType)} • {summary.group.contract?.number || summary.group.contract?.id}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {summary.group.projectName || summary.group.projectKey || 'Без проекта'}
                        </p>
                      </div>
                      <div className="text-right text-sm font-medium text-gray-900">
                        {formatCurrency(summary.amount)}
                        {summary.vatSettings.status === 'payer' ? (
                          summary.vatSettings.exempt || summary.vatPercent === 0 ? (
                            <div className="text-xs text-gray-500">Без НДС</div>
                          ) : (
                            <div className="text-xs text-gray-500">НДС {summary.vatPercent}% ({formatCurrency(summary.vatAmount)})</div>
                          )
                        ) : (
                          <div className="text-xs text-gray-500">Не плательщик</div>
                        )}
                      </div>
                    </div>
                      <div className="flex flex-wrap gap-2">
                      {(() => {
                        const seen = new Set<string>();
                        const entries = summary.group.templateEntries.filter((entry) => {
                          if (!summary.docs.includes(entry.doc)) {
                            return false;
                          }
                          const key = `${entry.doc}:${entry.templateId ?? entry.templateName}`;
                          if (seen.has(key)) {
                            return false;
                          }
                          seen.add(key);
                          return true;
                        });
                        return entries.map((entry) => (
                          <div
                            key={`${entry.doc}-${entry.templateId ?? 'default'}`}
                            className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs"
                          >
                            <span className="font-medium text-gray-900">{entry.templateName}</span>
                          </div>
                        ));
                      })()}
                      <Badge variant="secondary" className="text-xs">
                        Ставка: {summary.group.contract?.rateType === 'month' ? `${formatCurrency(summary.rate ?? 0)}/мес` : `${formatCurrency(summary.rate ?? 0)}/ч`}
                      </Badge>
                      {summary.group.contract?.rateType === 'month' && summary.group.normHours ? (
                        <Badge variant="outline" className="text-xs">Норма: {summary.group.normHours} ч</Badge>
                      ) : null}
                      {shouldShowVatBadge(summary.group.performer, summary.group.performerType) && (
                        <Badge variant="outline" className="text-xs">{describeVatSettings(summary.vatSettings)}</Badge>
                      )}
                      <Badge variant={summary.timesheet ? 'secondary' : 'outline'} className="text-xs">
                        Таймшит {summary.timesheet ? 'включён' : 'не включён'}
                      </Badge>
                      {summary.npdReceiptMissing && (
                        <Badge variant="destructive" className="text-xs">Чек НПД не подтверждён</Badge>
                      )}
                    </div>
                    {summary.blockingIssues.length > 0 && (
                      <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                        <p className="font-medium mb-1">Нужно исправить:</p>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {summary.blockingIssues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {summary.npdReceiptMissing && (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                        <p className="font-medium mb-1">Чек «Мой налог» не подтверждён</p>
                        <p>Сохраните документы сейчас и отметьте чек после получения.</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {packagePreview && (
            <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-5 w-5" />
                Документы сформированы: {packagePreview.documents.length}
              </div>
              <ScrollArea className="max-h-48">
                <div className="space-y-2">
                  {packagePreview.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between gap-3 rounded-md border border-green-200 bg-white p-2">
                      <span className="text-xs text-green-800 font-medium">
                        {DOC_CODE_LABELS[(doc.doc_type as DocServerCode) ?? 'AVR'] || doc.doc_type}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => handleDownload(doc)}>
                        Скачать
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {formError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <RotateCcw className="h-4 w-4" />
            <span>Шаг {step === 'snapshot' ? 1 : 2} из 2</span>
          </div>
          <div className="flex items-center gap-2">
            {step === 'confirm' && (
              <Button variant="outline" onClick={() => setStep('snapshot')} disabled={isSubmitting}>
                Назад к настройкам
              </Button>
            )}
            {step === 'snapshot' && (
              <Button
                variant="secondary"
                onClick={() => setStep('confirm')}
                disabled={groupMatrix.length === 0}
              >
                К подтверждению
              </Button>
            )}
            <Button onClick={handleSubmit} disabled={hasBlockingIssues || isSubmitting || groupMatrix.length === 0}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Формируем…
                </>
              ) : (
                'Сформировать'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>

      {activeGroup && activeOverride && (
        <Dialog open={Boolean(activeGroup)} onOpenChange={(openState) => !openState && setActiveGroupKey(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby="group-settings-desc">
            <DialogHeader>
              <DialogTitle>
                Настройки группы • {describePerformer(activeGroup.performer, activeGroup.performerType)}
              </DialogTitle>
              <DialogDescription id="group-settings-desc">
                Контракт: {activeGroup.contract?.number || activeGroup.contract?.id || '—'}
              </DialogDescription>
            </DialogHeader>
            {(() => {
              const client = activeGroup.contract?.clientId ? legalEntitiesById.get(activeGroup.contract.clientId) ?? null : null;
              const performerEntity = activeGroup.performer;
              const templateNames = Array.from(new Set(activeGroup.templateEntries.map((entry) => entry.templateName)));
              const rateLabel = activeGroup.contract?.rate
                ? `${formatCurrency(activeGroup.contract.rate)} / ${activeGroup.contract?.rateType === 'month' ? 'мес' : 'ч'}`
                : '—';
              return (
                <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Использование среза</Label>
                <div className="mt-2 space-y-2">
                  {USAGE_OPTIONS.map((option) => {
                    const usageState = activeOverride.usage ?? activeGroup.usageFlags;
                    const checked = usageState[option.key];
                    return (
                      <label key={option.key} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm cursor-pointer hover:bg-gray-50 transition">
                        <div className="flex-1">
                          <p className="font-medium">{option.label}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{option.description}</p>
                        </div>
                        <Switch
                          checked={checked}
                          onCheckedChange={(value) =>
                            updateGroupOverride(activeGroup.key, {
                              usage: {
                                ...usageState,
                                [option.key]: Boolean(value),
                              },
                            })
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label className="text-sm font-medium">
                    Ставка
                    {activeGroup.contract?.rateType ? ` · ${activeGroup.contract.rateType === 'month' ? 'за месяц' : 'за час'}` : ''}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={activeOverride.rate ?? ''}
                    onChange={(event) => updateGroupOverride(activeGroup.key, { rate: Number(event.target.value) || 0 })}
                    disabled={activeGroup.rateRule !== 'editable' || activeGroup.performerType === 'employee'}
                    className="mt-1.5"
                  />
                  {activeGroup.rateRule !== 'editable' && (
                    <p className="mt-1 text-xs text-gray-500">Ставка фиксирована договором</p>
                  )}
                </div>
                <div>
                  <Label className="text-sm font-medium mb-1.5 block">НДС</Label>
                  {isVatVisibleForPerformer(activeGroup.performerType) && activeGroup.vatRule !== 'hidden' ? (
                    <div>
                      <VatSettingsControl
                        idPrefix={`override-${activeGroup.key}`}
                        value={normalizeVatSettings(activeOverride.vatSettings ?? activeGroup.vatSettingsDefault)}
                        onChange={(next) => updateGroupOverride(activeGroup.key, { vatSettings: next })}
                        disabled={activeGroup.vatRule !== 'editable'}
                      />
                      {activeGroup.vatRule !== 'editable' && (
                        <p className="mt-1 text-xs text-gray-500">Режим НДС фиксирован контрактом</p>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 mt-1">Поле скрыто для выбранного типа исполнителя</div>
                  )}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm cursor-pointer hover:bg-gray-50 transition">
                  <span className="font-medium">Таймшит</span>
                  <Switch
                    checked={Boolean(activeOverride.includeTimesheet)}
                    onCheckedChange={(checked) => updateGroupOverride(activeGroup.key, { includeTimesheet: checked })}
                    disabled={activeGroup.timesheetRule !== 'editable'}
                  />
                </label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-sm font-medium text-gray-900">Норма часов</div>
                  <div className="text-sm text-gray-600 mt-1">{activeGroup.normHours ?? '—'} ч</div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-sm font-medium text-gray-900 mb-2">Реквизиты</div>
                  <div className="space-y-1.5 text-xs text-gray-600">
                    <div>
                      <span className="text-gray-500">Заказчик:</span> {client?.name ?? '—'}
                    </div>
                    <div>
                      <span className="text-gray-500">Исполнитель:</span> {performerEntity?.name ?? describePerformer(activeGroup.performer, activeGroup.performerType)}
                    </div>
                    <div>
                      <span className="text-gray-500">Тип:</span> {performerEntity?.legalType ? performerEntity.legalType : activeGroup.performerType}
                    </div>
                    <div>
                      <span className="text-gray-500">Ставка:</span> {rateLabel}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-sm font-medium text-gray-900 mb-2">Шаблоны</div>
                  <div className="space-y-1 text-xs text-gray-600">
                    {templateNames.length === 0 ? (
                      <div>—</div>
                    ) : (
                      templateNames.map((name) => <div key={name}>{name}</div>)
                    )}
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium mb-2 block">Задачи группы</Label>
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3">
                  {activeGroup.tasks.length === 0 ? (
                    <p className="text-xs text-gray-500">Задач нет</p>
                  ) : (
                    activeGroup.tasks.map((task) => (
                      <div key={task.id} className="rounded-md border border-gray-300 bg-white p-2">
                        <div className="text-sm font-medium text-gray-900">
                          {task.key ? `${task.key} — ${task.title}` : task.title}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              {activeGroup.requiresNpdReceipt && (
                <label className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 cursor-pointer">
                  <div>
                    <p className="font-medium">Чек «Мой налог» получен</p>
                    <p className="text-xs mt-0.5">Можно закрыть пакет без чека и отметить его позже</p>
                  </div>
                  <Checkbox
                    checked={Boolean(activeOverride.npdReceiptConfirmed)}
                    onCheckedChange={(checked) => updateGroupOverride(activeGroup.key, { npdReceiptConfirmed: Boolean(checked) })}
                  />
                </label>
              )}
            </div>
              );
            })()}
            <div className="flex justify-end gap-2 pt-4 border-t border-gray-200">
              <Button variant="outline" onClick={() => setActiveGroupKey(null)}>
                Готово
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
