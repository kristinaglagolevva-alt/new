import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, SVGProps, ChangeEvent } from 'react';
import type { DirectoryFocus } from '../types/navigation';
import * as XLSX from 'xlsx';
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Checkbox } from "./ui/checkbox";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Switch } from "./ui/switch";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import {
  Building,
  Building2,
  User,
  Users,
  FileText,
  Plus,
  Edit,
  CopyPlus,
  CheckCircle,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { useDatabase } from "../data/DataContext";
import type { Contract, Individual, LegalEntity, Template, VatSettings, UserRole } from "../data/models";
import { DirectoryOverview } from "./directory-overview";

const TEMPLATE_PRESET_KEYWORDS: Record<'base' | Contract['performerType'], string[][]> = {
  base: [
    ['приказ'],
    ['служебное', 'задание'],
  ],
  employee: [['передач', 'штат']],
  gph: [
    ['сдачи-приемки', 'выполненных'],
    ['передач', 'гпх'],
  ],
  selfemployed: [['самозан']],
  ip: [['работ', 'ип']],
  company: [['сдачи', 'юл']],
};

const digitsOnly = (input: string | null | undefined, length?: number) => {
  const digits = (input ?? '').replace(/\D/g, '');
  return typeof length === 'number' ? digits.slice(0, length) : digits;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LegalEntityFormErrors = {
  inn?: string;
  kpp?: string;
};

type IndividualFormErrors = {
  inn?: string;
  passport?: string;
  email?: string;
};

const suggestTemplatesForPerformer = (
  performerType: Contract['performerType'] | undefined,
  availableTemplates: Template[] | null | undefined
): string[] => {
  if (!availableTemplates || availableTemplates.length === 0) {
    return [];
  }

  const normalized = availableTemplates.map((template) => ({
    id: template.id,
    normName: template.name.toLowerCase(),
  }));

  const collected = new Set<string>();
  const applyPreset = (key: 'base' | Contract['performerType']) => {
    TEMPLATE_PRESET_KEYWORDS[key].forEach((keywords) => {
      const match = normalized.find((entry) => keywords.every((keyword) => entry.normName.includes(keyword)));
      if (match) {
        collected.add(match.id);
      }
    });
  };

  applyPreset('base');
  applyPreset(performerType ?? 'gph');

  return Array.from(collected);
};

const DEFAULT_VAT_SETTINGS: VatSettings = {
  status: 'non_payer',
  rate: null,
  exempt: false,
};

const normalizeVatSettings = (value?: VatSettings): VatSettings => {
  if (!value) {
    return { ...DEFAULT_VAT_SETTINGS };
  }
  if (value.status !== 'payer') {
    return { ...DEFAULT_VAT_SETTINGS };
  }
  if (value.exempt) {
    return {
      status: 'payer',
      rate: 0,
      exempt: true,
    };
  }

  let parsedRate: number | null = null;
  if (typeof value.rate === 'number') {
    parsedRate = value.rate;
  } else if (typeof value.rate === 'string') {
    const trimmed = value.rate.trim();
    if (trimmed) {
      const numeric = Number(trimmed.replace(',', '.'));
      parsedRate = Number.isFinite(numeric) ? numeric : null;
    }
  }

  const rate =
    parsedRate === null
      ? null
      : Number(Math.max(0, parsedRate).toFixed(2));
  return {
    status: 'payer',
    rate,
    exempt: false,
  };
};

const vatSettingsToLegacyMode = (settings: VatSettings): Contract['vatMode'] => {
  if (settings.status !== 'payer') {
    return 'no_vat';
  }
  if (settings.exempt) {
    return 'vat_0';
  }
  const rate = typeof settings.rate === 'number' ? settings.rate : null;
  if (rate === null || !Number.isFinite(rate)) {
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

const normalizeIsoDate = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return parsed.toISOString().slice(0, 10);
};

const parseIsoDate = (value?: string | null): Date | null => {
  const normalized = normalizeIsoDate(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  const [year, month, day] = normalized.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(candidate.getTime()) ? null : candidate;
};

const toDateInputValue = (value?: string | null): string => {
  const normalized = normalizeIsoDate(value);
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
};

const formatContractDate = (value?: string | null): string | null => {
  const normalized = normalizeIsoDate(value);
  if (!normalized) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split('-');
    return `${day}.${month}.${year}`;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }
  return date.toLocaleDateString('ru-RU');
};

const VatSettingsEditor = ({
  value,
  onChange,
  disabled,
  showExempt = true,
  idPrefix,
}: {
  value: VatSettings;
  onChange: (settings: VatSettings) => void;
  disabled?: boolean;
  showExempt?: boolean;
  idPrefix?: string;
}) => {
  const prefix = idPrefix ?? 'vat';
  const radioNonPayerId = `${prefix}-non-payer`;
  const radioPayerId = `${prefix}-payer`;
  const rateInputId = `${prefix}-rate`;
  const exemptCheckboxId = `${prefix}-exempt`;
  const [rateDraft, setRateDraft] = useState<string>('');

  useEffect(() => {
    if (value.status !== 'payer' || value.exempt) {
      setRateDraft('');
      return;
    }
    if (typeof value.rate === 'number' && Number.isFinite(value.rate)) {
      setRateDraft(value.rate === 0 ? '0' : String(value.rate));
    } else {
      setRateDraft('');
    }
  }, [value.status, value.rate, value.exempt]);

  const handleStatusChange = (nextValue: VatSettings['status']) => {
    if (nextValue === 'payer') {
      const nextRate =
        value.status === 'payer' && !value.exempt && typeof value.rate === 'number' && Number.isFinite(value.rate) && value.rate > 0
          ? value.rate
          : 20;
      setRateDraft(String(nextRate));
      onChange({ status: 'payer', rate: nextRate, exempt: false });
    } else {
      setRateDraft('');
      onChange({ ...DEFAULT_VAT_SETTINGS });
    }
  };

  const handleRateChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target.value;
    setRateDraft(input);
    if (input.trim() === '') {
      onChange({ ...value, status: 'payer', rate: null, exempt: false });
      return;
    }
    const parsed = Number(input.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      return;
    }
    const normalizedRate = Number(Math.max(0, parsed).toFixed(2));
    onChange({
      ...value,
      status: 'payer',
      rate: normalizedRate,
      exempt: normalizedRate === 0 ? value.exempt : false,
    });
  };

  const handleExemptChange = (checked: boolean) => {
    const fallbackRate =
      typeof value.rate === 'number' && Number.isFinite(value.rate) && value.rate > 0 ? value.rate : 20;
    setRateDraft(checked ? '0' : String(fallbackRate));
    if (checked) {
      onChange({
        ...value,
        status: 'payer',
        exempt: true,
        rate: 0,
      });
    } else {
      onChange({
        ...value,
        status: 'payer',
        exempt: false,
        rate: fallbackRate,
      });
    }
  };

  const rateValue =
    value.status === 'payer' && !value.exempt
      ? rateDraft
      : '';

  return (
    <div className="space-y-3">
      <RadioGroup
        value={value.status}
        onValueChange={(next) => handleStatusChange(next as VatSettings['status'])}
        className="grid gap-2 md:grid-cols-2"
      >
        <label className="flex items-center space-x-2 rounded-lg border p-3 text-sm" htmlFor={radioNonPayerId}>
          <RadioGroupItem value="non_payer" id={radioNonPayerId} disabled={disabled} />
          <span className="flex-1">Не плательщик</span>
        </label>
        <label className="flex items-center space-x-2 rounded-lg border p-3 text-sm" htmlFor={radioPayerId}>
          <RadioGroupItem value="payer" id={radioPayerId} disabled={disabled} />
          <span className="flex-1">Плательщик</span>
        </label>
      </RadioGroup>
      {value.status === 'payer' && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_1fr]">
          <div className="space-y-1">
            <Label htmlFor={rateInputId}>Ставка НДС, %</Label>
            <Input
              id={rateInputId}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.1"
              placeholder="20"
              value={rateValue}
              onChange={handleRateChange}
              disabled={disabled || (showExempt && value.exempt)}
            />
          </div>
          {showExempt && (
            <label
              htmlFor={exemptCheckboxId}
              className="flex items-center justify-between gap-3 rounded-lg border p-3 text-xs text-muted-foreground"
            >
              <div className="space-y-1">
                <span className="block text-sm font-medium text-slate-900">Без НДС (освоб.)</span>
                <span>
                  Для освобождённых операций отметьте флажок — ставка будет зафиксирована как 0.
                </span>
              </div>
              <Checkbox
                id={exemptCheckboxId}
                checked={value.exempt}
                onCheckedChange={(checked) => handleExemptChange(Boolean(checked))}
                disabled={disabled}
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
};

type DisplayIndividual = Individual & { duplicateCount: number };

type DirectorySummaryCard = {
  key: 'legal' | 'individuals' | 'contracts';
  label: string;
  current: number;
  total: number;
  status: 'complete' | 'incomplete';
  remaining?: number;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  color: 'blue' | 'green';
};

type DirectoryTab = 'legal' | 'individual' | 'contracts';
type DirectoryStatusFilter = 'all' | 'complete' | 'incomplete';

interface DirectoryPageProps {
  alerts?: Partial<Record<DirectoryTab, number>>;
  onSectionViewed?: (section: DirectoryTab) => void;
  focus?: DirectoryFocus | null;
  onConsumeFocus?: () => void;
}

export function DirectoryPage({ alerts, onSectionViewed, focus, onConsumeFocus }: DirectoryPageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [legalDialog, setLegalDialog] = useState<{ open: boolean; entity: LegalEntity | null }>({ open: false, entity: null });
  const [individualDialog, setIndividualDialog] = useState<{ open: boolean; individual: Individual | null }>({ open: false, individual: null });
  const [contractDialog, setContractDialog] = useState<{ open: boolean; contract: Contract | null; mode: 'create' | 'edit' | 'clone' }>({
    open: false,
    contract: null,
    mode: 'create',
  });
  const tabOrder: DirectoryTab[] = ['legal', 'individual', 'contracts'];
  const tabAlerts = useMemo(() => alerts ?? {}, [alerts]);
  const [activeTab, setActiveTabState] = useState<DirectoryTab>('legal');
  const userSelectedTabRef = useRef(false);
  const [statusFilters, setStatusFilters] = useState<Record<DirectoryTab, DirectoryStatusFilter>>({
    legal: 'all',
    individual: 'all',
    contracts: 'all',
  });

  const setActiveTab = useCallback((value: DirectoryTab) => {
    setActiveTabState(value);
  }, []);

  const {
    legalEntities,
    individuals,
    contracts,
    getLegalEntityById,
    getIndividualById,
    saveLegalEntity,
    saveIndividual,
    saveContract,
    deleteLegalEntity,
    deleteIndividual,
    deleteContract,
    exportDirectoryData,
    importDirectoryData,
    templates,
    updateUserRoles,
  } = useDatabase();

  const handleStatusFilterChange = useCallback((tab: DirectoryTab, value: DirectoryStatusFilter) => {
    setStatusFilters((prev) => ({
      ...prev,
      [tab]: value,
    }));
  }, []);

  useEffect(() => {
    const hasAlerts = tabOrder.some((tab) => (tabAlerts[tab] ?? 0) > 0);
    if (!hasAlerts) {
      userSelectedTabRef.current = false;
      return;
    }

    if (userSelectedTabRef.current) {
      return;
    }

    const firstAlertTab = tabOrder.find((tab) => (tabAlerts[tab] ?? 0) > 0);
    if (firstAlertTab && firstAlertTab !== activeTab) {
      setActiveTab(firstAlertTab);
    }
  }, [activeTab, setActiveTab, tabAlerts]);

  useEffect(() => {
    if (!onSectionViewed) {
      return;
    }
    const count = tabAlerts[activeTab] ?? 0;
    if (count > 0) {
      onSectionViewed(activeTab);
    }
  }, [activeTab, onSectionViewed, tabAlerts]);

  useEffect(() => {
    if (!focus) {
      return;
    }

    const { section, contractId, performerId } = focus;
    if (section === 'contracts') {
      setActiveTab('contracts');
      if (contractId) {
        const targetContract = contracts.find((contract) => contract.id === contractId);
        if (targetContract) {
          setContractDialog({ open: true, contract: targetContract, mode: 'edit' });
          onConsumeFocus?.();
          return;
        }
      }
      if (performerId) {
        const targetIndividual = individuals.find((individual) => individual.id === performerId);
        if (targetIndividual) {
          setIndividualDialog({ open: true, individual: targetIndividual });
          onConsumeFocus?.();
          return;
        }
      }
    } else if (section === 'individual') {
      setActiveTab('individual');
      if (performerId) {
        const targetIndividual = individuals.find((individual) => individual.id === performerId);
        if (targetIndividual) {
          setIndividualDialog({ open: true, individual: targetIndividual });
          onConsumeFocus?.();
          return;
        }
      }
    } else if (section === 'legal') {
      setActiveTab('legal');
      if (contractId) {
        const targetEntity = legalEntities.find((entity) => entity.id === contractId);
        if (targetEntity) {
          setLegalDialog({ open: true, entity: targetEntity });
          onConsumeFocus?.();
          return;
        }
      }
    }

    onConsumeFocus?.();
  }, [focus, onConsumeFocus, contracts, individuals, legalEntities, setActiveTab]);

  const legalOptions = useMemo(
    () => legalEntities.map((entity) => ({ value: entity.id, label: entity.name || entity.id })),
    [legalEntities]
  );

  const referencedIndividualIds = useMemo(() => {
    const ids = new Set<string>();
    contracts.forEach((contract) => {
      if (contract.contractorId) {
        ids.add(contract.contractorId);
      }
    });
    return ids;
  }, [contracts]);

  const individualDisplayList = useMemo<DisplayIndividual[]>(() => {
    const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() ?? '';
    const keyFor = (individual: Individual) => {
      const candidates = [
        normalize(individual.externalId),
        normalize(individual.email),
        individual.inn ? `inn:${individual.inn}` : '',
        individual.passport ? `passport:${individual.passport}` : '',
        normalize(individual.name) ? `name:${normalize(individual.name)}` : '',
        individual.id ? `id:${individual.id}` : '',
      ].filter(Boolean);
      return candidates[0] ?? individual.id;
    };

    const mergeRecords = (base: Individual, extra: Individual): Individual => {
      const merged: Individual = { ...base };
      if (!merged.inn && extra.inn) merged.inn = extra.inn;
      if (!merged.passport && extra.passport) merged.passport = extra.passport;
      if (!merged.address && extra.address) merged.address = extra.address;
      if (!merged.email && extra.email) merged.email = extra.email;
      if (!merged.externalId && extra.externalId) merged.externalId = extra.externalId;
      if (extra.status === 'complete') merged.status = 'complete';
      if (merged.source !== 'manual' && extra.source) merged.source = extra.source;
      return merged;
    };

    const groups = new Map<string, Individual[]>();
    individuals.forEach((individual) => {
      const key = keyFor(individual);
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(individual);
      } else {
        groups.set(key, [individual]);
      }
    });

    const result: DisplayIndividual[] = [];

    groups.forEach((items) => {
      const referenced = items.filter((item) => referencedIndividualIds.has(item.id));
      const unreferenced = items.filter((item) => !referencedIndividualIds.has(item.id));

      referenced.forEach((item) => {
        result.push({ ...item, duplicateCount: 1 });
      });

      if (unreferenced.length > 0) {
        let combined: Individual = { ...unreferenced[0] };
        unreferenced.slice(1).forEach((item) => {
          combined = mergeRecords(combined, item);
        });
        result.push({ ...combined, duplicateCount: unreferenced.length });
      }
    });

    return result.sort((a, b) => normalize(a.name).localeCompare(normalize(b.name), 'ru'));
  }, [individuals, referencedIndividualIds]);

  const filteredLegalEntities = useMemo(() => {
    const filter = statusFilters.legal;
    if (filter === 'all') {
      return legalEntities;
    }
    return legalEntities.filter((entity) => entity.status === filter);
  }, [legalEntities, statusFilters.legal]);

  const filteredIndividualDisplayList = useMemo(() => {
    const filter = statusFilters.individual;
    if (filter === 'all') {
      return individualDisplayList;
    }
    return individualDisplayList.filter((individual) => individual.status === filter);
  }, [individualDisplayList, statusFilters.individual]);

  const filteredContracts = useMemo(() => {
    const filter = statusFilters.contracts;
    if (filter === 'all') {
      return contracts;
    }
    return contracts.filter((contract) => contract.status === filter);
  }, [contracts, statusFilters.contracts]);

  const contractNumberMap = useMemo(() => {
    const map = new Map<string, string>();
    contracts.forEach((contract) => {
      const label = (contract.number || '').trim() || contract.id;
      map.set(contract.id, label);
    });
    return map;
  }, [contracts]);

  const contractContinuations = useMemo(() => {
    const map = new Map<string, Contract[]>();
    contracts.forEach((contract) => {
      const originId = contract.continuationOfId?.trim();
      if (!originId) {
        return;
      }
      const bucket = map.get(originId);
      if (bucket) {
        bucket.push(contract);
      } else {
        map.set(originId, [contract]);
      }
    });
    return map;
  }, [contracts]);

  const individualOptions = useMemo(
    () => individualDisplayList.map((individual) => ({
      value: individual.id,
      label:
        individual.duplicateCount > 1
          ? `${individual.name || individual.id} (×${individual.duplicateCount})`
          : individual.name || individual.id,
    })),
    [individualDisplayList]
  );

  const directorySummary = useMemo(() => {
    const legalComplete = legalEntities.filter((entity) => entity.status === 'complete').length;
    const individualComplete = individualDisplayList.filter((individual) => individual.status === 'complete').length;
    const contractComplete = contracts.filter((contract) => contract.status === 'complete').length;

    return {
      legal: { total: legalEntities.length, complete: legalComplete },
      individuals: { total: individualDisplayList.length, complete: individualComplete },
      contracts: { total: contracts.length, complete: contractComplete },
    };
  }, [legalEntities, individualDisplayList, contracts]);

  const pendingNotes = useMemo(() => {
    const notes: string[] = [];
    if (directorySummary.legal.total > 0 && directorySummary.legal.complete < directorySummary.legal.total) {
      notes.push('Заполните реквизиты юридических лиц (ИНН, КПП, подписант и основание).');
    }
    if (directorySummary.individuals.total > 0 && directorySummary.individuals.complete < directorySummary.individuals.total) {
      notes.push('Дополните данные физлиц: ИНН, паспорт и адрес регистрации.');
    }
    if (directorySummary.contracts.total > 0 && directorySummary.contracts.complete < directorySummary.contracts.total) {
      notes.push('Проверьте контракты: номер, связки и ставка должны быть заполнены.');
    }
    return notes;
  }, [directorySummary]);

  const handleExportExcel = () => {
    const data = exportDirectoryData();
    const pickByStatus = <T extends { status: 'complete' | 'incomplete' }>(
      items: T[],
      tab: DirectoryTab
    ): T[] => {
      const filter = statusFilters[tab];
      if (filter === 'all') {
        return items;
      }
      return items.filter((item) => item.status === filter);
    };

    const legalEntitiesToExport = pickByStatus(data.legalEntities, 'legal');
    const individualsToExport = pickByStatus(data.individuals, 'individual');
    const contractsToExport = pickByStatus(data.contracts, 'contracts');

    const workbook = XLSX.utils.book_new();

      const legalSheet = XLSX.utils.json_to_sheet(
        legalEntitiesToExport.map((entity) => ({
          id: entity.id,
          name: entity.name,
          inn: entity.inn,
          kpp: entity.kpp,
          signatory: entity.signatory,
          basis: entity.basis,
          powerOfAttorneyNumber: entity.powerOfAttorneyNumber ?? '',
          powerOfAttorneyDate: entity.powerOfAttorneyDate ?? '',
          status: entity.status,
          defaultVatMode: entity.defaultVatMode ?? 'no_vat',
          defaultVatStatus: entity.defaultVatSettings?.status ?? 'non_payer',
          defaultVatRate: entity.defaultVatSettings?.rate ?? null,
          defaultVatExempt: entity.defaultVatSettings?.exempt ?? false,
        requireInvoice: entity.requireInvoice ?? false,
      }))
    );
    XLSX.utils.book_append_sheet(workbook, legalSheet, 'LegalEntities');

    const individualsSheet = XLSX.utils.json_to_sheet(
      individualsToExport.map((individual) => ({
        id: individual.id,
        name: individual.name,
        inn: individual.inn,
        passport: individual.passport,
        address: individual.address,
        email: individual.email,
        status: individual.status,
        legalType: individual.legalType ?? '',
        taxDocumentStatus: individual.taxDocumentStatus ?? 'missing',
        taxResidencyStatus: individual.taxResidencyStatus ?? 'unknown',
      }))
    );
    XLSX.utils.book_append_sheet(workbook, individualsSheet, 'Individuals');

    const contractsSheet = XLSX.utils.json_to_sheet(
      contractsToExport.map((contract) => ({
        id: contract.id,
        number: contract.number,
        clientId: contract.clientId,
        contractorId: contract.contractorId,
        rate: contract.rate,
        rateType: contract.rateType,
        status: contract.status,
        performerType: contract.performerType ?? '',
        vatMode: contract.vatMode ?? 'no_vat',
        vatStatus: contract.vatSettings?.status ?? 'non_payer',
        vatRate: contract.vatSettings?.rate ?? null,
        vatExempt: contract.vatSettings?.exempt ?? false,
        includeTimesheetByDefault: contract.includeTimesheetByDefault ?? false,
        timesheetToggleLocked: contract.timesheetToggleLocked ?? false,
        requireNpdReceipt: contract.requireNpdReceipt ?? false,
        actByProjects: contract.actByProjects ?? false,
        normHours: contract.normHours ?? null,
        validFrom: contract.validFrom ?? '',
        validTo: contract.validTo ?? '',
        expirationReminderEnabled: contract.expirationReminderEnabled ?? false,
        expirationReminderDays: contract.expirationReminderDays ?? null,
        requireIsDocument: contract.requireIsDocument ?? false,
        allowedTemplateIds: Array.isArray(contract.allowedTemplateIds)
          ? contract.allowedTemplateIds.join(', ')
          : '',
      }))
    );
    XLSX.utils.book_append_sheet(workbook, contractsSheet, 'Contracts');

    const workbookBlob = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([workbookBlob], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `directory-export-${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });

      const legalSheet = workbook.Sheets['LegalEntities'];
      const individualsSheet = workbook.Sheets['Individuals'];
      const contractsSheet = workbook.Sheets['Contracts'];

      if (!legalSheet && !individualsSheet && !contractsSheet) {
        window.alert('Не найдены листы LegalEntities / Individuals / Contracts.');
        return;
      }

      const toArray = (sheet: XLSX.Sheet | undefined) =>
        sheet ? (XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[]) : [];

      const parseBooleanCell = (value: unknown): boolean => {
        if (typeof value === 'boolean') {
          return value;
        }
        if (typeof value === 'number') {
          return value !== 0;
        }
        if (value === null || value === undefined) {
          return false;
        }
        const normalized = String(value).trim().toLowerCase();
        if (!normalized) {
          return false;
        }
        return ['true', '1', 'yes', 'да', 'y', 't'].includes(normalized);
      };

      const parseNumberCell = (value: unknown): number | null => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return value;
        }
        if (value === null || value === undefined || value === '') {
          return null;
        }
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      };

      const parseVatSettings = (row: Record<string, unknown>, prefix: string): VatSettings => {
        const statusValue = String(
          row[`${prefix}Status`] ??
            row[`${prefix}status`] ??
            row[`${prefix}`] ??
            row[`${prefix}Mode`] ??
            row[`${prefix}mode`] ??
            'non_payer'
        )
          .trim()
          .toLowerCase();
        const status: VatSettings['status'] = statusValue === 'payer' ? 'payer' : 'non_payer';
        if (status !== 'payer') {
          return { ...DEFAULT_VAT_SETTINGS };
        }
        const exempt = parseBooleanCell(row[`${prefix}Exempt`] ?? row[`${prefix}exempt`] ?? false);
        const rateCell = parseNumberCell(row[`${prefix}Rate`] ?? row[`${prefix}rate`]);
        const rate = exempt ? 0 : rateCell ?? null;
        return {
          status: 'payer',
          rate,
          exempt,
        };
      };

      const parseDateCell = (value: unknown): string | null => {
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
          return value.toISOString().slice(0, 10);
        }
        const numeric = parseNumberCell(value);
        if (numeric !== null) {
          const parsed = XLSX.SSF.parse_date_code(numeric);
          if (parsed) {
            const date = new Date(Date.UTC(parsed.y, (parsed.m || 1) - 1, parsed.d || 1));
            if (!Number.isNaN(date.getTime())) {
              return date.toISOString().slice(0, 10);
            }
          }
        }
        if (value === null || value === undefined) {
          return null;
        }
        const stringValue = String(value).trim();
        if (!stringValue) {
          return null;
        }
        const parsedDate = new Date(stringValue);
        if (!Number.isNaN(parsedDate.getTime())) {
          return parsedDate.toISOString().slice(0, 10);
        }
        return stringValue;
      };

      const legalEntitiesData = toArray(legalSheet).map((row) => {
        const defaultVatSettings = parseVatSettings(row, 'defaultVat');
        const defaultVatModeCell = String(row.defaultVatMode || row.DefaultVatMode || row.default_vat_mode || '').trim();
        const defaultVatMode = (defaultVatModeCell || vatSettingsToLegacyMode(defaultVatSettings)) as LegalEntity['defaultVatMode'];
        const powerNumberSource =
          row.powerOfAttorneyNumber ??
          row.PowerOfAttorneyNumber ??
          row.power_of_attorney_number ??
          row.Power_of_attorney_number ??
          '';
        const powerOfAttorneyNumber = String(powerNumberSource ?? '').trim();
        const powerOfAttorneyDate = parseDateCell(
          row.powerOfAttorneyDate ?? row.PowerOfAttorneyDate ?? row.power_of_attorney_date ?? ''
        );

        return {
          id: String(row.id || row.ID || ''),
          name: String(row.name || row.Name || ''),
          inn: String(row.inn || row.INN || ''),
          kpp: String(row.kpp || row.КПП || row.KPP || ''),
          signatory: String(row.signatory || row.Signatory || ''),
          basis: String(row.basis || row.Basis || ''),
          powerOfAttorneyNumber: powerOfAttorneyNumber || null,
          powerOfAttorneyDate,
          status: String(row.status || row.Status || 'incomplete') as LegalEntity['status'],
          defaultVatMode,
          defaultVatSettings,
          requireInvoice: parseBooleanCell(row.requireInvoice ?? row.RequireInvoice ?? false),
        } as LegalEntity;
      });

      const individualsData = toArray(individualsSheet).map((row) => {
        const taxResidencyRaw = String(row.taxResidencyStatus || row.TaxResidencyStatus || row.tax_residency_status || 'unknown').trim().toLowerCase();
        let taxResidencyStatus: Individual['taxResidencyStatus'] = 'unknown';
        if (taxResidencyRaw === 'resident' || taxResidencyRaw === 'резидент') {
          taxResidencyStatus = 'resident';
        } else if (taxResidencyRaw === 'non_resident' || taxResidencyRaw === 'нерезидент') {
          taxResidencyStatus = 'non_resident';
        }
        
        return {
          id: String(row.id || row.ID || ''),
          name: String(row.name || row.Name || ''),
          inn: String(row.inn || row.INN || ''),
          passport: String(row.passport || row.Passport || ''),
          address: String(row.address || row.Address || ''),
          email: String(row.email || row.Email || ''),
          status: String(row.status || row.Status || 'incomplete') as Individual['status'],
          legalType: (String(row.legalType || row.LegalType || '') || undefined) as Individual['legalType'],
          taxDocumentStatus: (String(row.taxDocumentStatus || row.TaxDocumentStatus || 'missing') as Individual['taxDocumentStatus']),
          taxResidencyStatus,
        };
      });

      const contractsData = toArray(contractsSheet).map((row) => {
        const vatSettings = parseVatSettings(row, 'vat');
        const vatModeCell = String(row.vatMode || row.VatMode || '').trim();
        const vatModeResolved = (vatModeCell || vatSettingsToLegacyMode(vatSettings)) as Contract['vatMode'];

        const allowedTemplateIdsRaw = String(row.allowedTemplateIds || row.AllowedTemplateIds || '')
          .split(/[;,]/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0);

        return {
          id: String(row.id || row.ID || ''),
          number: String(row.number || row.Number || ''),
          clientId: String(row.clientId || row.ClientId || row.ClientID || ''),
          contractorId: String(row.contractorId || row.ContractorId || row.ContractorID || ''),
          rate: Number(row.rate ?? row.Rate ?? 0),
        rateType: (String(row.rateType || row.RateType || 'hour') as Contract['rateType']),
        currency: 'RUB',
        status: String(row.status || row.Status || 'incomplete') as Contract['status'],
        performerType: (String(row.performerType || row.PerformerType || '') || undefined) as Contract['performerType'],
        vatMode: vatModeResolved,
        vatSettings,
        includeTimesheetByDefault: parseBooleanCell(row.includeTimesheetByDefault ?? row.IncludeTimesheetByDefault ?? false),
        timesheetToggleLocked: parseBooleanCell(row.timesheetToggleLocked ?? row.TimesheetToggleLocked ?? false),
        requireNpdReceipt: parseBooleanCell(row.requireNpdReceipt ?? row.RequireNpdReceipt ?? false),
        actByProjects: parseBooleanCell(row.actByProjects ?? row.ActByProjects ?? false),
        normHours: parseNumberCell(row.normHours ?? row.NormHours) ?? null,
        validFrom: parseDateCell(row.validFrom ?? row.ValidFrom),
        validTo: parseDateCell(row.validTo ?? row.ValidTo),
        expirationReminderEnabled: parseBooleanCell(row.expirationReminderEnabled ?? row.ExpirationReminderEnabled ?? false),
        expirationReminderDays: parseNumberCell(row.expirationReminderDays ?? row.ExpirationReminderDays) ?? null,
        requireIsDocument: parseBooleanCell(row.requireIsDocument ?? row.RequireIsDocument ?? false),
        allowedTemplateIds: allowedTemplateIdsRaw,
      } as Contract;
      });

      await importDirectoryData({
        legalEntities: legalEntitiesData,
        individuals: individualsData as Individual[],
        contracts: contractsData,
      });
      window.alert('Данные справочника обновлены из Excel.');
    } catch (error) {
      console.error('Failed to import directory data', error);
      window.alert('Не удалось импортировать файл. Проверьте формат.');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const defaultLegalEntity: LegalEntity = {
    id: '',
    name: '',
    inn: '',
    kpp: '',
    signatory: '',
    basis: '',
    powerOfAttorneyNumber: '',
    powerOfAttorneyDate: null,
    status: 'incomplete',
    defaultVatMode: 'no_vat',
    defaultVatSettings: { ...DEFAULT_VAT_SETTINGS },
    requireInvoice: false,
  };

  const defaultIndividual: Individual = {
    id: '',
    name: '',
    inn: '',
    passport: '',
    address: '',
    email: '',
    status: 'incomplete',
    legalType: 'gph',
    taxDocumentStatus: 'missing',
    taxResidencyStatus: 'unknown',
    externalId: null,
    source: 'manual',
    userId: null,
    userEmail: null,
    userFullName: null,
    userRole: null,
    userActive: true,
    isApprovalManager: false,
    approvalManagerId: null,
    generatedPassword: null,
  };

  const defaultContract: Contract = {
    id: '',
    number: '',
    clientId: legalEntities[0]?.id ?? '',
    contractorId: individuals[0]?.id ?? '',
    contractDate: null,
    rate: 0,
    rateType: 'hour',
    currency: 'RUB',
    status: 'incomplete',
    performerType: 'gph',
    vatMode: 'no_vat',
    vatSettings: { ...DEFAULT_VAT_SETTINGS },
    includeTimesheetByDefault: true,
    timesheetToggleLocked: false,
    requireNpdReceipt: false,
    actByProjects: false,
    normHours: 168,
    templateAvrId: null,
    templateIprId: null,
    templateInvoiceId: null,
    validFrom: null,
    validTo: null,
    expirationReminderEnabled: false,
    expirationReminderDays: null,
    requireIsDocument: false,
    allowedTemplateIds: [],
    continuationOfId: null,
  };

  const performerTypeOptions: Array<{ value: Contract['performerType']; label: string }> = [
    { value: 'employee', label: 'Штатный сотрудник' },
    { value: 'gph', label: 'Физическое лицо (ГПХ)' },
    { value: 'selfemployed', label: 'Самозанятый (НПД)' },
    { value: 'ip', label: 'ИП' },
    { value: 'company', label: 'Юрлицо' },
  ];

  const resolveContractTemplates = useCallback(
    (
      input: Contract,
      options?: { seedDefaults?: boolean; performerTypeOverride?: Contract['performerType'] }
    ): Contract => {
      if (!templates || templates.length === 0) {
        return {
          ...input,
          allowedTemplateIds: Array.isArray(input.allowedTemplateIds) ? [...input.allowedTemplateIds] : [],
        };
      }

      const seedDefaults = options?.seedDefaults ?? false;
      const performerType = options?.performerTypeOverride ?? input.performerType ?? 'gph';

      const result: Contract = {
        ...input,
        allowedTemplateIds: Array.isArray(input.allowedTemplateIds) ? [...input.allowedTemplateIds] : [],
      };

      const allowedSet = new Set(result.allowedTemplateIds ?? []);

      const shouldSeedDefaults = seedDefaults || allowedSet.size === 0;
      if (shouldSeedDefaults) {
        const suggestedIds = suggestTemplatesForPerformer(performerType, templates);
        suggestedIds.forEach((id) => allowedSet.add(id));
      }

      const actTemplates = templates.filter((template) => template.type === 'act');
      const iprTemplates = templates.filter((template) => template.type === 'custom' || template.type === 'act');
      const invoiceTemplates = templates.filter((template) => template.type === 'invoice');

      const ensureFromList = (currentId: string | null | undefined, list: typeof templates) => {
        if (currentId && allowedSet.has(currentId) && list.some((template) => template.id === currentId)) {
          return currentId;
        }
        const allowedMatch = list.find((template) => allowedSet.has(template.id));
        if (allowedMatch) {
          return allowedMatch.id;
        }
        const fallback = list[0];
        if (fallback && shouldSeedDefaults) {
          allowedSet.add(fallback.id);
          return fallback.id;
        }
        return null;
      };

      result.templateAvrId = ensureFromList(result.templateAvrId, actTemplates);
      result.templateIprId = ensureFromList(result.templateIprId, iprTemplates);
      result.templateInvoiceId = ensureFromList(result.templateInvoiceId, invoiceTemplates);

      result.allowedTemplateIds = Array.from(allowedSet);
      return result;
    },
    [templates]
  );

  const LegalEntityFormDialog = () => {
    const entity = legalDialog.entity;
    const buildInitialLegalForm = (source: LegalEntity | null): LegalEntity => {
      if (!source) {
        return { ...defaultLegalEntity };
      }
      const normalizedVat = normalizeVatSettings(source.defaultVatSettings);
      return {
        ...defaultLegalEntity,
        ...source,
        inn: digitsOnly(source.inn, 10),
        kpp: digitsOnly(source.kpp, 9),
        powerOfAttorneyNumber: source.powerOfAttorneyNumber ?? '',
        powerOfAttorneyDate: source.powerOfAttorneyDate ?? null,
        defaultVatSettings: normalizedVat,
        defaultVatMode: vatSettingsToLegacyMode(normalizedVat),
      };
    };

    const [form, setForm] = useState<LegalEntity>(buildInitialLegalForm(entity ?? null));
    const [errors, setErrors] = useState<LegalEntityFormErrors>({});
    const basisPresets = ['Устава', 'Доверенность'];
    const [basisMode, setBasisMode] = useState<'preset' | 'custom'>(
      entity && entity.basis && !basisPresets.includes(entity.basis) ? 'custom' : 'preset'
    );
    const clearError = (field: keyof LegalEntityFormErrors) => {
      setErrors((prev) => {
        if (!prev[field]) {
          return prev;
        }
        const next = { ...prev };
        delete next[field];
        return next;
      });
    };
    const requiresPowerOfAttorneyDetails = useMemo(() => {
      const normalized = (form.basis ?? '').trim().toLowerCase();
      return normalized.includes('довер');
    }, [form.basis]);
    const vatStatus = form.defaultVatSettings?.status ?? 'non_payer';
    const previousVatStatusRef = useRef<typeof vatStatus>(vatStatus);
    useEffect(() => {
      setForm((prev) => {
        const prevVatStatus = previousVatStatusRef.current;
        let next = prev;
        if (vatStatus === 'payer' && prevVatStatus !== 'payer' && !prev.requireInvoice) {
          next = { ...prev, requireInvoice: true };
        } else if (vatStatus !== 'payer' && prevVatStatus === 'payer' && prev.requireInvoice) {
          next = { ...prev, requireInvoice: false };
        }
        previousVatStatusRef.current = vatStatus;
        return next;
      });
    }, [vatStatus]);

    useEffect(() => {
      setForm(buildInitialLegalForm(entity ?? null));
      setBasisMode(entity && entity.basis && !basisPresets.includes(entity.basis) ? 'custom' : 'preset');
      setErrors({});
    }, [entity]);

    const handleOpenChange = (open: boolean) => {
      if (open) {
        setLegalDialog((prev) => ({ ...prev, open: true }));
      } else {
        setLegalDialog({ open: false, entity: null });
        setForm({ ...defaultLegalEntity });
        setErrors({});
      }
    };

    const handleSave = async () => {
      const normalizedVat = normalizeVatSettings(form.defaultVatSettings);
      const basisValue = (form.basis ?? '').trim().toLowerCase();
      const innDigits = digitsOnly(form.inn, 10);
      const kppDigits = digitsOnly(form.kpp, 9);
      const validationErrors: LegalEntityFormErrors = {};
      if (innDigits.length !== 10) {
        validationErrors.inn = 'ИНН ЮЛ должен содержать 10 цифр';
      }
      if (kppDigits.length !== 9) {
        validationErrors.kpp = 'КПП должен содержать 9 цифр';
      }
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        return;
      }
      setErrors({});
      try {
        const trimOrNull = (value: string | null | undefined) => {
          if (!value) {
            return null;
          }
          const trimmed = value.trim();
          return trimmed ? trimmed : null;
        };
        const shouldIncludePowerOfAttorney = basisValue.includes('довер');
        await saveLegalEntity({
          ...form,
          inn: innDigits,
          kpp: kppDigits,
          basis: form.basis?.trim() ?? '',
          powerOfAttorneyNumber: shouldIncludePowerOfAttorney ? trimOrNull(form.powerOfAttorneyNumber) : null,
          powerOfAttorneyDate: shouldIncludePowerOfAttorney ? trimOrNull(form.powerOfAttorneyDate) : null,
          defaultVatSettings: normalizedVat,
          defaultVatMode: vatSettingsToLegacyMode(normalizedVat),
        });
        setLegalDialog({ open: false, entity: null });
      } catch (error) {
        console.error(error);
        window.alert('Не удалось сохранить юридическое лицо. Проверьте поля и подключение.');
      }
    };

    return (
      <Dialog open={legalDialog.open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button onClick={() => setLegalDialog({ open: true, entity: null })}>
            <Plus className="w-4 h-4 mr-2" />
            Добавить ЮЛ
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden">
          <div className="document-dialog-scroll space-y-4 overflow-y-auto pr-1 max-h-[calc(90vh-120px)]">
            <DialogHeader>
              <DialogTitle>{entity ? 'Редактирование ЮЛ' : 'Юридическое лицо'}</DialogTitle>
              <DialogDescription>
                {entity ? 'Редактируйте данные юридического лица' : 'Добавьте юридическое лицо в справочник'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm font-medium mb-2">Что обязательно:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>• ИНН и КПП</li>
                  <li>• Подписант (ФИО)</li>
                <li>• Основание подписи (Устав, Доверенность)</li>
              </ul>
            </div>

            <div className="space-y-3">
              <div>
                <Label>Наименование</Label>
                <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="ООО &quot;Название&quot;" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>ИНН</Label>
                  <Input
                    inputMode="numeric"
                    maxLength={10}
                    aria-invalid={Boolean(errors.inn)}
                    value={form.inn}
                    onChange={(event) => {
                      const digits = digitsOnly(event.target.value, 10);
                      setForm((prev) => ({ ...prev, inn: digits }));
                      clearError('inn');
                    }}
                    placeholder="1234567890"
                  />
                  {errors.inn ? <p className="mt-1 text-xs text-destructive">{errors.inn}</p> : null}
                </div>
                <div>
                  <Label>КПП</Label>
                  <Input
                    inputMode="numeric"
                    maxLength={9}
                    aria-invalid={Boolean(errors.kpp)}
                    value={form.kpp}
                    onChange={(event) => {
                      const digits = digitsOnly(event.target.value, 9);
                      setForm((prev) => ({ ...prev, kpp: digits }));
                      clearError('kpp');
                    }}
                    placeholder="123456789"
                  />
                  {errors.kpp ? <p className="mt-1 text-xs text-destructive">{errors.kpp}</p> : null}
                </div>
              </div>
              <div>
                <Label>Подписант</Label>
                <Input value={form.signatory} onChange={(event) => setForm((prev) => ({ ...prev, signatory: event.target.value }))} placeholder="Иванов И.И." />
              </div>
              <div>
                <Label>Основание</Label>
                <Select
                  value={basisMode === 'custom' ? 'custom' : form.basis}
                  onValueChange={(value) => {
                    if (value === 'custom') {
                      setBasisMode('custom');
                      setForm((prev) => ({ ...prev, basis: '' }));
                    } else {
                      setBasisMode('preset');
                      setForm((prev) => ({ ...prev, basis: value }));
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите основание" />
                  </SelectTrigger>
                  <SelectContent>
                    {basisPresets.map((preset) => (
                      <SelectItem key={preset} value={preset}>
                        {preset}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">Другое</SelectItem>
                  </SelectContent>
                </Select>
                {basisMode === 'custom' && (
                  <Input
                    className="mt-2"
                    placeholder="Укажите основание (например, Доверенность №1)"
                    value={form.basis}
                    onChange={(event) => setForm((prev) => ({ ...prev, basis: event.target.value }))}
                  />
                )}
                {requiresPowerOfAttorneyDetails && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label>Номер доверенности</Label>
                      <Input
                        placeholder="Например, 12-34/А"
                        value={form.powerOfAttorneyNumber ?? ''}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, powerOfAttorneyNumber: event.target.value }))
                        }
                      />
                    </div>
                    <div>
                      <Label>Дата доверенности</Label>
                      <Input
                        type="date"
                        value={form.powerOfAttorneyDate ?? ''}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setForm((prev) => ({
                            ...prev,
                            powerOfAttorneyDate: nextValue ? nextValue : null,
                          }));
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <Label>НДС по умолчанию</Label>
                  <VatSettingsEditor
                    idPrefix="legal-vat"
                    value={normalizeVatSettings(form.defaultVatSettings)}
                    onChange={(next) =>
                      setForm((prev) => {
                        const normalized = normalizeVatSettings(next);
                        return {
                          ...prev,
                          defaultVatSettings: normalized,
                          defaultVatMode: vatSettingsToLegacyMode(normalized),
                        };
                      })
                    }
                  />
                </div>
                <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <div>
                    <span className="block font-medium">Нужна счёт-фактура</span>
                    <span className="block text-xs text-muted-foreground">Договоры с этим заказчиком требуют счёт-фактуру.</span>
                  </div>
                  <Switch
                    checked={Boolean(form.requireInvoice)}
                    onCheckedChange={(checked) => setForm((prev) => ({ ...prev, requireInvoice: checked }))}
                  />
                </label>
              </div>
              </div>

              <div className="flex gap-2">
                <Button className="flex-1" onClick={handleSave}>
                  Сохранить
                </Button>
                <Button variant="outline" onClick={() => setLegalDialog({ open: false, entity: null })}>
                  Отмена
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  const IndividualFormDialog = () => {
    const item = individualDialog.individual;
    const [form, setForm] = useState<Individual>(() => {
      if (!item) {
        return { ...defaultIndividual };
      }
      const base = { ...defaultIndividual, ...item };
      const expectedPassportLength = base.taxResidencyStatus === 'non_resident' ? 9 : 10;
      return {
        ...base,
        inn: digitsOnly(base.inn, 12),
        passport: digitsOnly(base.passport, expectedPassportLength),
        email: base.email ?? '',
        address: base.address ?? '',
      };
    });
    const [errors, setErrors] = useState<IndividualFormErrors>({});
    const clearError = (field: keyof IndividualFormErrors) => {
      setErrors((prev) => {
        if (!prev[field]) {
          return prev;
        }
        const next = { ...prev };
        delete next[field];
        return next;
      });
    };
    const dialogIndividualId = item?.id ?? '';
    const managerCandidates = useMemo(() => {
      const currentId = form.id || dialogIndividualId;
      const filtered = individuals.filter((candidate) => {
        if (!candidate.userId) {
          return false;
        }
        const candidateIsManager = Boolean(candidate.isApprovalManager) || candidate.userRole === 'manager';
        return candidateIsManager;
      });

      if (form.approvalManagerId) {
        const current = individuals.find((candidate) => candidate.id === form.approvalManagerId);
        if (current && !filtered.some((candidate) => candidate.id === current.id)) {
          filtered.push(current);
        }
      }

      return filtered.sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '', 'ru'));
    }, [individuals, form.id, form.approvalManagerId, dialogIndividualId]);

    const passportMaxLength = form.taxResidencyStatus === 'non_resident' ? 9 : 10;
    const passportPlaceholder = passportMaxLength === 9 ? '123456789' : '1234567890';

    useEffect(() => {
      if (item) {
        const base = { ...defaultIndividual, ...item };
        const expectedPassportLength = base.taxResidencyStatus === 'non_resident' ? 9 : 10;
        setForm({
          ...base,
          inn: digitsOnly(base.inn, 12),
          passport: digitsOnly(base.passport, expectedPassportLength),
          email: base.email ?? '',
          address: base.address ?? '',
        });
      } else {
        setForm({ ...defaultIndividual });
      }
      setErrors({});
    }, [item]);

    const handleOpenChange = (open: boolean) => {
      if (open) {
        setErrors({});
        setIndividualDialog((prev) => ({ ...prev, open: true }));
      } else {
        setIndividualDialog({ open: false, individual: null });
        setForm({ ...defaultIndividual });
        setErrors({});
      }
    };

    const handleSave = async () => {
      const innDigits = digitsOnly(form.inn, 12);
      const residency = form.taxResidencyStatus === 'non_resident'
        ? 'non_resident'
        : form.taxResidencyStatus === 'resident'
          ? 'resident'
          : 'unknown';
      const expectedPassportLength = residency === 'non_resident' ? 9 : 10;
      const passportDigits = digitsOnly(form.passport, expectedPassportLength);
      const email = (form.email ?? '').trim();
      const validationErrors: IndividualFormErrors = {};

      if (innDigits.length !== 12) {
        validationErrors.inn = 'ИНН ФЛ должен содержать 12 цифр';
      }
      if (passportDigits.length !== expectedPassportLength) {
        validationErrors.passport =
          residency === 'non_resident'
            ? 'Паспорт нерезидента должен содержать 9 цифр'
            : residency === 'resident'
              ? 'Паспорт гражданина РФ должен содержать 10 цифр'
              : 'Укажите 10 цифр или выберите статус нерезидента для паспорта из 9 цифр';
      }
      if (!email) {
        validationErrors.email = 'Укажите email';
      } else if (!EMAIL_REGEX.test(email)) {
        validationErrors.email = 'Email должен быть в формате name@example.com';
      }

      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        return;
      }

      setErrors({});
      try {
        const saved = await saveIndividual({
          ...form,
          inn: innDigits,
          passport: passportDigits,
          email,
        });
        if (saved.generatedPassword) {
          window.alert(
            `Создан новый аккаунт или пароль для пользователя:\n${saved.generatedPassword}\nПередайте его исполнителю безопасным способом.`
          );
        }

        if (saved.userId) {
          const desiredRoles: UserRole[] = form.isApprovalManager ? ['manager', 'performer'] : ['performer'];
          try {
            await updateUserRoles(saved.userId, desiredRoles);
          } catch (error) {
            console.error('[Directory] Unable to synchronize user roles', error);
            window.alert('Не удалось обновить права доступа пользователя. Проверьте настройки в разделе "Настройки".');
          }
        }
        setIndividualDialog({ open: false, individual: null });
      } catch (error) {
        console.error(error);
        window.alert('Не удалось сохранить физическое лицо. Проверьте поля и подключение.');
      }
    };

    return (
      <Dialog open={individualDialog.open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button onClick={() => setIndividualDialog({ open: true, individual: null })}>
            <Plus className="w-4 h-4 mr-2" />
            Добавить ФЛ
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden">
          <div className="document-dialog-scroll space-y-4 overflow-y-auto pr-1 max-h-[calc(90vh-120px)]">
            <DialogHeader>
              <DialogTitle>{item ? 'Редактирование ФЛ' : 'Физическое лицо'}</DialogTitle>
              <DialogDescription>
                {item ? 'Редактируйте данные физического лица' : 'Добавьте физическое лицо в справочник'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm font-medium mb-2">Что обязательно:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>• ИНН</li>
                  <li>• Паспорт</li>
                <li>• Адрес регистрации</li>
              </ul>
            </div>
            <div className="space-y-3">
              <div>
                <Label>ФИО</Label>
                <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Иванов Иван Иванович" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Статус налогового резидентства</Label>
                  <Select
                    value={form.taxResidencyStatus ?? 'unknown'}
                    onValueChange={(value) => {
                      const nextStatus = value as Individual['taxResidencyStatus'];
                      clearError('passport');
                      setForm((prev) => ({
                        ...prev,
                        taxResidencyStatus: nextStatus,
                        passport: digitsOnly(prev.passport, nextStatus === 'non_resident' ? 9 : 10),
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите статус" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="resident">Резидент РФ</SelectItem>
                      <SelectItem value="non_resident">Нерезидент РФ</SelectItem>
                      <SelectItem value="unknown">Не указано</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Статус налоговых документов</Label>
                  <Select
                    value={form.taxDocumentStatus ?? 'missing'}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, taxDocumentStatus: value as Individual['taxDocumentStatus'] }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите статус" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="missing">Не загружены</SelectItem>
                      <SelectItem value="pending">На проверке</SelectItem>
                      <SelectItem value="ready">Готовы</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="rounded-md border border-muted-foreground/20 bg-muted/40 p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Согласующий менеджер</div>
                  <div className="text-xs text-muted-foreground">
                    Отметьте, если документы этого пользователя нужно отправлять на согласование.
                  </div>
                </div>
                <Switch
                  checked={Boolean(form.isApprovalManager)}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({
                      ...prev,
                      isApprovalManager: checked,
                      approvalManagerId: checked ? prev.approvalManagerId : null,
                    }))
                  }
                />
              </div>
              {form.isApprovalManager ? (
                <div>
                  <Label>Менеджер для согласования</Label>
                  <Select
                    value={form.approvalManagerId ?? 'none'}
                    onValueChange={(value) =>
                      setForm((prev) => ({ ...prev, approvalManagerId: value === 'none' ? null : value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите менеджера" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Не назначен</SelectItem>
                      {managerCandidates.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.name || candidate.email || candidate.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Менеджер должен иметь созданный аккаунт с ролью «Менеджер» или отметку согласующего.
                  </div>
                </div>
              ) : null}
              <div>
                <Label>ИНН</Label>
                <Input
                  inputMode="numeric"
                  maxLength={12}
                  aria-invalid={Boolean(errors.inn)}
                  value={form.inn}
                  onChange={(event) => {
                    const digits = digitsOnly(event.target.value, 12);
                    setForm((prev) => ({ ...prev, inn: digits }));
                    clearError('inn');
                  }}
                  placeholder="123456789012"
                />
                {errors.inn ? <p className="mt-1 text-xs text-destructive">{errors.inn}</p> : null}
              </div>
              <div>
                <Label>Паспорт</Label>
                <Input
                  inputMode="numeric"
                  maxLength={passportMaxLength}
                  aria-invalid={Boolean(errors.passport)}
                  value={form.passport}
                  onChange={(event) => {
                    const digits = digitsOnly(event.target.value, passportMaxLength);
                    setForm((prev) => ({ ...prev, passport: digits }));
                    clearError('passport');
                  }}
                  placeholder={passportPlaceholder}
                />
                {errors.passport ? <p className="mt-1 text-xs text-destructive">{errors.passport}</p> : null}
              </div>
              <div>
                <Label>Адрес регистрации</Label>
                <Input value={form.address} onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))} placeholder="г. Москва, ул. Примерная, д. 1" />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  aria-invalid={Boolean(errors.email)}
                  value={form.email}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, email: event.target.value }));
                    clearError('email');
                  }}
                  placeholder="contractor@example.com"
                />
                {errors.email ? <p className="mt-1 text-xs text-destructive">{errors.email}</p> : null}
              </div>
            </div>

              <div className="flex gap-2">
                <Button className="flex-1" onClick={handleSave}>
                  Сохранить
                </Button>
                <Button variant="outline" onClick={() => setIndividualDialog({ open: false, individual: null })}>
                  Отмена
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  const ContractFormDialog = () => {
    const { contract, mode } = contractDialog;

    const contractNumberById = useMemo(() => {
      const map = new Map<string, { number: string; period: string | null }>();
      contracts.forEach((item) => {
        const labelNumber = (item.number || '').trim() || item.id;
        const fromLabel = formatContractDate(item.validFrom);
        const toLabel = formatContractDate(item.validTo);
        const range = fromLabel || toLabel ? `${fromLabel ?? '—'} — ${toLabel ?? '—'}` : null;
        map.set(item.id, { number: labelNumber, period: range });
      });
      return map;
    }, [contracts]);

    const suggestContinuationNumber = useCallback(
      (baseNumber: string | null | undefined) => {
        const normalized = (baseNumber || '').trim();
        if (!normalized) {
          return '';
        }
        const suffix = ' (продолжение)';
        const taken = new Set<string>();
        contracts.forEach((item) => {
          const value = (item.number || '').trim().toLowerCase();
          if (value) {
            taken.add(value);
          }
        });
        const baseCandidate = `${normalized}${suffix}`;
        if (!taken.has(baseCandidate.toLowerCase())) {
          return baseCandidate;
        }
        let attempt = 2;
        let candidate = `${normalized}${suffix} ${attempt}`;
        while (taken.has(candidate.toLowerCase())) {
          attempt += 1;
          candidate = `${normalized}${suffix} ${attempt}`;
        }
        return candidate;
      },
      [contracts],
    );

    const buildInitialContractForm = useCallback(
      (source: Contract | null, dialogMode: 'create' | 'edit' | 'clone'): Contract => {
        const base = source
          ? {
              ...source,
              allowedTemplateIds: Array.isArray(source.allowedTemplateIds) ? [...source.allowedTemplateIds] : [],
            }
          : {
              ...defaultContract,
              clientId: legalEntities[0]?.id ?? '',
              contractorId: individuals[0]?.id ?? '',
              allowedTemplateIds: [],
            };

        base.requireNpdReceipt = base.performerType === 'selfemployed';
        base.contractDate = normalizeIsoDate(base.contractDate);
        const normalizedVat = normalizeVatSettings(base.vatSettings);
        const vatEligible = base.performerType === 'ip' || base.performerType === 'company';
        base.vatSettings = vatEligible ? normalizedVat : { ...DEFAULT_VAT_SETTINGS };
        base.vatMode = vatSettingsToLegacyMode(base.vatSettings);

        const seedDefaults = !source || !(source.allowedTemplateIds && source.allowedTemplateIds.length > 0);
        const prepared = resolveContractTemplates(base, {
          seedDefaults,
          performerTypeOverride: base.performerType,
        });

        if (dialogMode === 'clone' && source) {
          const originalValidTo = parseIsoDate(source.validTo);
          const nextValidFromIso = originalValidTo
            ? new Date(originalValidTo.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
            : null;
          return {
            ...prepared,
            id: '',
            status: 'incomplete',
            number: suggestContinuationNumber(source.number) || prepared.number || '',
            contractDate: normalizeIsoDate(source.contractDate),
            validFrom: nextValidFromIso ?? prepared.validFrom ?? normalizeIsoDate(source.validTo),
            validTo: null,
            continuationOfId: source.id,
          };
        }

        if (dialogMode === 'create') {
          return {
            ...prepared,
            id: '',
            status: 'incomplete',
            continuationOfId: prepared.continuationOfId ?? null,
          };
        }

        return prepared;
      },
      [defaultContract, individuals, legalEntities, resolveContractTemplates, suggestContinuationNumber],
    );

    const [form, setForm] = useState<Contract>(() => buildInitialContractForm(contract ?? null, mode));
    useEffect(() => {
      setForm(buildInitialContractForm(contract ?? null, mode));
    }, [contract, mode, buildInitialContractForm]);

    const handleOpenChange = (open: boolean) => {
      if (open) {
        setContractDialog((prev) => ({ ...prev, open: true }));
      } else {
        setContractDialog({ open: false, contract: null, mode: 'create' });
        setForm(buildInitialContractForm(null, 'create'));
      }
    };

    const vatApplicable = form.performerType === 'ip' || form.performerType === 'company';
    const currentVatSettings = normalizeVatSettings(form.vatSettings);
    const isEditing = mode === 'edit';
    const isCloning = mode === 'clone';
    const sourceContract = contract ?? null;

    const sanitizedFormRate = Number(form.rate ?? 0) || 0;
    const sanitizedFormNormHours = Number(form.normHours ?? 0) || 0;
    const originalRate = sourceContract ? Number(sourceContract.rate ?? 0) : 0;
    const originalNormHours = Number(sourceContract?.normHours ?? 0) || 0;
    const rateTypeChanged = Boolean(sourceContract && sourceContract.rateType !== form.rateType);
    const normHoursChanged =
      Boolean(sourceContract) &&
      (sourceContract.rateType === 'month' || form.rateType === 'month') &&
      Math.abs(originalNormHours - sanitizedFormNormHours) > 0.0001;
    const rateValueChanged = Boolean(sourceContract) && Math.abs(originalRate - sanitizedFormRate) > 0.0001;
    const rateChanged = isEditing && sourceContract ? rateTypeChanged || rateValueChanged || normHoursChanged : false;

    const potentialNewContract = useMemo(() => {
      if (!isEditing || !sourceContract) {
        return false;
      }
      const originalValidTo = parseIsoDate(sourceContract.validTo);
      if (!originalValidTo) {
        return false;
      }
      const nextValidFrom = parseIsoDate(form.validFrom);
      if (nextValidFrom && nextValidFrom.getTime() > originalValidTo.getTime()) {
        return true;
      }
      const nextContractDate = parseIsoDate(form.contractDate);
      if (nextContractDate && nextContractDate.getTime() > originalValidTo.getTime()) {
        return true;
      }
      return false;
    }, [form.contractDate, form.validFrom, isEditing, sourceContract]);

    const continuationOptions = useMemo(() => {
      const excludeId = isEditing && sourceContract ? sourceContract.id : null;
      return contracts
        .filter((item) => item.id !== excludeId)
        .map((item) => {
          const meta = contractNumberById.get(item.id);
          const description = meta?.period ? ` (${meta.period})` : '';
          return {
            value: item.id,
            label: `${meta?.number ?? item.number ?? item.id}${description}`,
          };
        });
    }, [contractNumberById, contracts, isEditing, sourceContract]);

    const continuationMeta = form.continuationOfId ? contractNumberById.get(form.continuationOfId) ?? null : null;

    const handleSave = async () => {
      if (isEditing) {
        const guardMessages: string[] = [];
        if (potentialNewContract) {
          const endDateText = formatContractDate(sourceContract?.validTo) ?? 'даты окончания текущего договора';
          guardMessages.push(
            `Похоже, что вы задаёте даты нового договора после ${endDateText}. Чтобы сохранить историю, добавьте новый договор через «Добавить контракт». Продолжить сохранение текущей записи?`,
          );
        }
        if (rateChanged) {
          guardMessages.push(
            'Параметры ставки изменены. Создайте новый договор или оформите доп. соглашение, чтобы не потерять историю. Продолжить сохранение текущего договора?',
          );
        }
        if (guardMessages.length > 0) {
          const confirmed = window.confirm(guardMessages.join('\n\n'));
          if (!confirmed) {
            return;
          }
        }
      }

      try {
        const normalizedVat = normalizeVatSettings(form.vatSettings);
        const normalizedContractDate = normalizeIsoDate(form.contractDate);
        const prepared = resolveContractTemplates(
          {
            ...form,
            contractDate: normalizedContractDate,
            rate: sanitizedFormRate,
            continuationOfId: form.continuationOfId?.trim() ? form.continuationOfId.trim() : null,
            vatSettings: normalizedVat,
            vatMode: vatSettingsToLegacyMode(normalizedVat),
          },
          { performerTypeOverride: form.performerType },
        );
        await saveContract(prepared);
        setContractDialog({ open: false, contract: null, mode: 'create' });
        setForm(buildInitialContractForm(null, 'create'));
      } catch (error) {
        console.error(error);
        window.alert('Не удалось сохранить контракт. Проверьте обязательные поля и подключение.');
      }
    };

    const dialogTitle =
      mode === 'edit' ? 'Редактирование контракта' : mode === 'clone' ? 'Продолжение контракта' : 'Новый контракт';
    const dialogDescription =
      mode === 'edit'
        ? 'Редактируйте данные контракта'
        : mode === 'clone'
          ? 'Создайте новый договор на основе существующего'
          : 'Добавьте контракт в справочник';

    return (
      <Dialog open={contractDialog.open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button onClick={() => setContractDialog({ open: true, contract: null, mode: 'create' })}>
            <Plus className="w-4 h-4 mr-2" />
            Добавить контракт
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden">
          <div className="document-dialog-scroll space-y-4 overflow-y-auto pr-1 max-h-[calc(90vh-120px)]">
            <DialogHeader>
              <DialogTitle>{dialogTitle}</DialogTitle>
              <DialogDescription>{dialogDescription}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {isEditing ? (
                <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                  <AlertCircle className="text-amber-500" />
                  <AlertTitle>Редактирование существующего договора</AlertTitle>
                  <AlertDescription>
                    <p>Изменения перезапишут текущую запись. Если заключён новый договор, добавьте его через «Добавить контракт», чтобы не потерять историю.</p>
                    {potentialNewContract ? (
                      <p className="font-medium text-amber-900">
                        Новые даты начинаются позже {formatContractDate(sourceContract?.validTo) ?? 'окончания текущего договора'} — лучше создать новый договор.
                      </p>
                    ) : null}
                    {rateChanged ? (
                      <p className="font-medium text-amber-900">
                        Параметры ставки изменены. Создайте новый договор или оформите доп. соглашение вместо редактирования текущего.
                      </p>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}
              {isCloning && sourceContract ? (
                <Alert className="border-slate-200 bg-slate-50">
                  <CopyPlus className="text-slate-500" />
                  <AlertTitle>Новое продолжение договора</AlertTitle>
                  <AlertDescription>
                    <p>Мы скопировали ключевые данные из договора {sourceContract.number || sourceContract.id}. Скорректируйте даты и ставку при необходимости.</p>
                    <p className="text-xs text-muted-foreground">Поле «Продолжает» уже связало новый договор с исходным.</p>
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm font-medium mb-2">Что обязательно:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>• Номер контракта</li>
                  <li>• Связка заказчик ↔ исполнитель</li>
                  <li>• Ставка и её тип</li>
                </ul>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Номер контракта</Label>
                    <Input
                      value={form.number}
                      onChange={(event) => setForm((prev) => ({ ...prev, number: event.target.value }))}
                      placeholder="№26/02/2025-АТ/ЮР"
                    />
                  </div>
                  <div>
                    <Label>Дата контракта</Label>
                    <Input
                      type="date"
                      value={toDateInputValue(form.contractDate)}
                      onChange={(event) => setForm((prev) => ({ ...prev, contractDate: event.target.value || null }))}
                    />
                  </div>
                </div>
                <div>
                  <Label>Заказчик</Label>
                  <Select value={form.clientId} onValueChange={(value) => setForm((prev) => ({ ...prev, clientId: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите заказчика" />
                    </SelectTrigger>
                    <SelectContent>
                      {legalOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Исполнитель</Label>
                  <Select value={form.contractorId} onValueChange={(value) => setForm((prev) => ({ ...prev, contractorId: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите исполнителя" />
                    </SelectTrigger>
                    <SelectContent>
                      {individualOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Продолжает договор</Label>
                  <Select
                    value={form.continuationOfId ?? 'none'}
                    onValueChange={(value) =>
                      setForm((prev) => ({
                        ...prev,
                        continuationOfId: value === 'none' ? null : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Не связан">
                        {continuationMeta ? `${continuationMeta.number}${continuationMeta.period ? ` · ${continuationMeta.period}` : ''}` : 'Не связан'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Не связан</SelectItem>
                      {continuationOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">Выберите предыдущий договор, если текущий является его продолжением.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Ставка</Label>
                    <Input
                      value={form.rate === 0 ? '' : form.rate}
                      type="number"
                      onChange={(event) => setForm((prev) => ({ ...prev, rate: Number(event.target.value) || 0 }))}
                      placeholder="150000"
                    />
                  </div>
                  <div>
                    <Label>Тип ставки</Label>
                    <Select
                      value={form.rateType}
                      onValueChange={(value) =>
                        setForm((prev) => ({ ...prev, rateType: value as Contract['rateType'] }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Тип" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hour">За час</SelectItem>
                        <SelectItem value="month">За месяц</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {form.rateType === 'month' ? (
                  <div>
                    <Label>Норма часов в месяце</Label>
                    <Input
                      value={form.normHours ?? ''}
                      type="number"
                      min={1}
                      onChange={(event) => setForm((prev) => ({ ...prev, normHours: Number(event.target.value) || 0 }))}
                      placeholder="168"
                    />
                  </div>
                ) : null}
                <div>
                  <Label>Тип исполнителя</Label>
                  <Select
                    value={form.performerType ?? 'gph'}
                    onValueChange={(value) =>
                      setForm((prev) => {
                        const performerType = value as Contract['performerType'];
                        const vatEligible = performerType === 'ip' || performerType === 'company';
                        const nextVatSettings = vatEligible ? normalizeVatSettings(prev.vatSettings) : { ...DEFAULT_VAT_SETTINGS };
                        const requireNpdReceipt = performerType === 'selfemployed';
                        const base: Contract = {
                          ...prev,
                          performerType,
                          vatSettings: nextVatSettings,
                          vatMode: vatSettingsToLegacyMode(nextVatSettings),
                          requireNpdReceipt,
                          allowedTemplateIds: [],
                        };
                        return resolveContractTemplates(base, {
                          seedDefaults: true,
                          performerTypeOverride: performerType,
                        });
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Тип исполнителя" />
                    </SelectTrigger>
                    <SelectContent>
                      {performerTypeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value ?? 'gph'}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {vatApplicable ? (
                  <div className="space-y-2">
                    <Label>НДС</Label>
                    <VatSettingsEditor
                      idPrefix={`contract-${form.id || 'new'}-vat`}
                      value={currentVatSettings}
                      onChange={(next) =>
                        setForm((prev) => {
                          const normalized = normalizeVatSettings(next);
                          return {
                            ...prev,
                            vatSettings: normalized,
                            vatMode: vatSettingsToLegacyMode(normalized),
                          };
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">НДС настраивается только для ИП и юридических лиц.</p>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Действует с</Label>
                    <Input
                      type="date"
                      value={form.validFrom ?? ''}
                      onChange={(event) => setForm((prev) => ({ ...prev, validFrom: event.target.value || null }))}
                    />
                  </div>
                  <div>
                    <Label>Действует до</Label>
                    <Input
                      type="date"
                      value={form.validTo ?? ''}
                      onChange={(event) => setForm((prev) => ({ ...prev, validTo: event.target.value || null }))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                  <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                    <div>
                      <span className="block font-medium">Напоминать об окончании</span>
                      <span className="block text-xs text-muted-foreground">Мы предупредим заранее.</span>
                    </div>
                    <Switch
                      checked={Boolean(form.expirationReminderEnabled)}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, expirationReminderEnabled: checked }))}
                    />
                  </label>
                  <div className="space-y-1">
                    <Label>За сколько дней предупредить</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.expirationReminderDays ?? ''}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          expirationReminderDays: event.target.value ? Number(event.target.value) : null,
                        }))
                      }
                      disabled={!form.expirationReminderEnabled}
                      placeholder="14"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                    <span>Таймшит по умолчанию</span>
                    <Switch
                      checked={Boolean(form.includeTimesheetByDefault)}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, includeTimesheetByDefault: checked }))}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                    <span>Таймшит нельзя отключить</span>
                    <Switch
                      checked={Boolean(form.timesheetToggleLocked)}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, timesheetToggleLocked: checked }))}
                    />
                  </label>
                  {form.performerType === 'selfemployed' ? (
                    <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                      <span>Обязателен чек НПД</span>
                      <Switch
                        checked={Boolean(form.requireNpdReceipt)}
                        onCheckedChange={(checked) => setForm((prev) => ({ ...prev, requireNpdReceipt: checked }))}
                      />
                    </label>
                  ) : null}
                  <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                    <span>Акты по проектам</span>
                    <Switch
                      checked={Boolean(form.actByProjects)}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, actByProjects: checked }))}
                    />
                  </label>
                </div>
                <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <div>
                    <span className="block font-medium">Обязательный ИС</span>
                    <span className="block text-xs text-muted-foreground">Для пакета понадобится акт передачи прав.</span>
                  </div>
                  <Switch
                    checked={Boolean(form.requireIsDocument)}
                    onCheckedChange={(checked) => setForm((prev) => ({ ...prev, requireIsDocument: checked }))}
                  />
                </label>
                <div>
                  <Label>Доступные шаблоны</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Отметьте шаблоны, которые можно использовать по этому контракту. Выбранные в выпадающих списках добавляются автоматически.
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {templates.length === 0 ? (
                      <div className="text-xs text-muted-foreground">Шаблонов пока нет.</div>
                    ) : (
                      templates.map((template) => {
                        const checked = Array.isArray(form.allowedTemplateIds)
                          ? form.allowedTemplateIds.includes(template.id)
                          : false;
                        return (
                          <label
                            key={template.id}
                            className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm"
                          >
                            <Checkbox
                              checked={checked}
                              className="mt-[2px]"
                              onCheckedChange={(next) => {
                                setForm((prev) => {
                                  const current = new Set(prev.allowedTemplateIds ?? []);
                                  if (next === true) {
                                    current.add(template.id);
                                  } else {
                                    current.delete(template.id);
                                  }
                                  return resolveContractTemplates(
                                    {
                                      ...prev,
                                      allowedTemplateIds: Array.from(current),
                                    },
                                    { performerTypeOverride: prev.performerType },
                                  );
                                });
                              }}
                            />
                            <div className="flex-1 space-y-[2px]">
                              <span className="block font-medium text-foreground">{template.name}</span>
                              {template.description ? (
                                <span className="block text-xs text-muted-foreground">{template.description}</span>
                              ) : null}
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={handleSave}>
                  Сохранить
                </Button>
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Отмена
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };


  const summaryCards = useMemo<DirectorySummaryCard[]>(() => {
    const base: Omit<DirectorySummaryCard, 'status' | 'remaining' | 'color'>[] = [
      { key: 'legal',       label: 'Юридические лица',  current: directorySummary.legal.complete,       total: directorySummary.legal.total,       icon: Building2 },
      { key: 'individuals', label: 'Физические лица',   current: directorySummary.individuals.complete, total: directorySummary.individuals.total, icon: User },
      { key: 'contracts',   label: 'Договоры',          current: directorySummary.contracts.complete,   total: directorySummary.contracts.total,   icon: Users },
    ];
    return base.map((item) => {
      const remaining = Math.max(item.total - item.current, 0);
      const status: DirectorySummaryCard['status'] = item.total > 0 && remaining === 0 ? 'complete' : 'incomplete';
      return {
        ...item,
        status,
        remaining: status === 'incomplete' ? remaining : undefined,
        color: status === 'complete' ? 'green' : 'blue',
      } satisfies DirectorySummaryCard;
    });
  }, [directorySummary]);

  const handleSummaryAdd = (key: DirectorySummaryCard['key']) => {
    if (key === 'legal') {
      setActiveTab('legal');
      setLegalDialog({ open: true, entity: null });
      return;
    }
    if (key === 'individuals') {
      setActiveTab('individual');
      setIndividualDialog({ open: true, individual: null });
      return;
    }
    if (key === 'contracts') {
      setActiveTab('contracts');
      setContractDialog({ open: true, contract: null, mode: 'create' });
    }
  };

  const handleDeleteLegalEntity = async (entity: LegalEntity) => {
    const name = entity.name?.trim() || entity.id;
    if (!window.confirm(`Удалить юридическое лицо «${name}»?`)) {
      return;
    }
    try {
      await deleteLegalEntity(entity.id);
    } catch (error) {
      console.error('Failed to delete legal entity', error);
      window.alert('Не удалось удалить юридическое лицо. Попробуйте ещё раз.');
    }
  };

  const handleDeleteIndividual = async (individual: Individual) => {
    const name = individual.name?.trim() || individual.id;
    if (!window.confirm(`Удалить физическое лицо «${name}»?`)) {
      return;
    }
    try {
      await deleteIndividual(individual.id);
    } catch (error) {
      console.error('Failed to delete individual', error);
      window.alert('Не удалось удалить физическое лицо. Попробуйте ещё раз.');
    }
  };

  const handleDeleteContract = async (contract: Contract) => {
    const identifier = contract.number?.trim() || contract.id;
    if (!window.confirm(`Удалить контракт «${identifier}»?`)) {
      return;
    }
    try {
      await deleteContract(contract.id);
    } catch (error) {
      console.error('Failed to delete contract', error);
      window.alert('Не удалось удалить контракт. Попробуйте ещё раз.');
    }
  };

  const handleCloneContract = useCallback(
    (source: Contract) => {
      setContractDialog({ open: true, contract: source, mode: 'clone' });
    },
    [setContractDialog],
  );

  const cardElevation: React.CSSProperties = {
    boxShadow: "0 2px 6px rgba(16,24,40,0.06), 0 8px 24px rgba(16,24,40,0.05)",
  };
  const cardInnerHighlight: React.CSSProperties = {
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
    borderRadius: 12,
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-gray-900 mb-1">Справочник</h1>
        <p className="text-gray-600">
          Управление реквизитами юридических лиц, физических лиц и контрактов
        </p>
      </div>

      <DirectoryOverview
        cards={summaryCards.map((item) => ({
          id: item.key,
          title: item.label,
          current: item.current,
          total: item.total,
          status: item.status,
          remaining: item.remaining,
          icon: item.icon,
          color: item.color,
        }))}
        notes={pendingNotes}
        onAdd={handleSummaryAdd}
        onSelect={(id) => {
          const tab: 'legal' | 'individual' | 'contracts' = id === 'individuals' ? 'individual' : id;
          setActiveTab(tab);
        }}
        onExportExcel={handleExportExcel}
        onTriggerUpload={() => fileInputRef.current?.click()}
        onImportChange={handleImportExcel}
        fileInputRef={fileInputRef}
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          userSelectedTabRef.current = true;
          setActiveTab(value as DirectoryTab);
        }}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="legal" className="flex items-center gap-2">
            <span className="flex items-center gap-2">
              <Building className="w-4 h-4" />
              Юридические лица
            </span>
            {tabAlerts.legal ? (
              <span
                className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-semibold shadow"
                style={{ backgroundColor: '#2563EB', color: '#FFFFFF' }}
              >
                {tabAlerts.legal > 99 ? '99+' : tabAlerts.legal}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="individual" className="flex items-center gap-2">
            <span className="flex items-center gap-2">
              <User className="w-4 h-4" />
              Физические лица
            </span>
            {tabAlerts.individual ? (
              <span
                className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-semibold shadow"
                style={{ backgroundColor: '#2563EB', color: '#FFFFFF' }}
              >
                {tabAlerts.individual > 99 ? '99+' : tabAlerts.individual}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="contracts" className="flex items-center gap-2">
            <span className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Договоры
            </span>
            {tabAlerts.contracts ? (
              <span
                className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-semibold shadow"
                style={{ backgroundColor: '#2563EB', color: '#FFFFFF' }}
              >
                {tabAlerts.contracts > 99 ? '99+' : tabAlerts.contracts}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="legal" className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="whitespace-nowrap">Юридические лица</h3>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Статус</span>
                <Select
                  value={statusFilters.legal}
                  onValueChange={(value) => handleStatusFilterChange('legal', value as DirectoryStatusFilter)}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все</SelectItem>
                    <SelectItem value="incomplete">Неполные</SelectItem>
                    <SelectItem value="complete">Готовые</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <LegalEntityFormDialog />
          </div>

          <Card
            className="relative rounded-xl border border-[#E9EDF5] bg-white ring-1 ring-black/5"
            style={cardElevation}
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-xl"
              style={cardInnerHighlight}
            />
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6 md:pl-8">Наименование</TableHead>
                    <TableHead>ИНН/КПП</TableHead>
                    <TableHead>Подписант</TableHead>
                    <TableHead>Основание</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="w-24 pr-6 md:pr-8 text-right">
                      <span className="sr-only">Действия</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLegalEntities.map((entity) => (
                    <TableRow key={entity.id}>
                      <TableCell className="pl-6 md:pl-8">{entity.name}</TableCell>
                      <TableCell>{entity.inn} / {entity.kpp}</TableCell>
                      <TableCell>{entity.signatory || '-'}</TableCell>
                      <TableCell>{entity.basis || '-'}</TableCell>
                      <TableCell>
                        {entity.status === 'complete' ? (
                          <Badge variant="default" className="bg-green-100 text-green-800">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Готов
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Неполный
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="pr-6 md:pr-8">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLegalDialog({ open: true, entity })}
                            aria-label="Редактировать юридическое лицо"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteLegalEntity(entity)}
                            aria-label="Удалить юридическое лицо"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="individual" className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="whitespace-nowrap">Физические лица</h3>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Статус</span>
                <Select
                  value={statusFilters.individual}
                  onValueChange={(value) => handleStatusFilterChange('individual', value as DirectoryStatusFilter)}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все</SelectItem>
                    <SelectItem value="incomplete">Неполные</SelectItem>
                    <SelectItem value="complete">Готовые</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <IndividualFormDialog />
          </div>

          <Card
            className="relative rounded-xl border border-[#E9EDF5] bg-white ring-1 ring-black/5"
            style={cardElevation}
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-xl"
              style={cardInnerHighlight}
            />
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6 md:pl-8">ФИО</TableHead>
                    <TableHead>ИНН</TableHead>
                    <TableHead>Паспорт</TableHead>
                    <TableHead>Адрес</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="w-24 pr-6 md:pr-8 text-right">
                      <span className="sr-only">Действия</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIndividualDisplayList.map((individual) => {
                    const { duplicateCount, ...individualData } = individual;
                    return (
                      <TableRow key={individual.id}>
                        <TableCell className="pl-6 md:pl-8">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{individual.name}</span>
                            {duplicateCount > 1 ? (
                              <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                                ×{duplicateCount}
                              </Badge>
                            ) : null}
                            {individual.taxResidencyStatus === 'resident' ? (
                              <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
                                Резидент
                              </Badge>
                            ) : individual.taxResidencyStatus === 'non_resident' ? (
                              <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
                                Нерезидент
                              </Badge>
                            ) : null}
                            {individual.userId ? (
                              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                Аккаунт
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                                Нет аккаунта
                              </Badge>
                            )}
                            {individual.isApprovalManager ? (
                              <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                                Менеджер
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>{individual.inn || '-'}</TableCell>
                        <TableCell>{individual.passport || '-'}</TableCell>
                        <TableCell className="max-w-xs truncate">{individual.address || '-'}</TableCell>
                        <TableCell className="max-w-xs truncate">{individual.email || '-'}</TableCell>
                        <TableCell>
                          {individual.status === 'complete' ? (
                            <Badge variant="default" className="bg-green-100 text-green-800">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Готов
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              <AlertCircle className="w-3 h-3 mr-1" />
                              Неполный
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="pr-6 md:pr-8">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setIndividualDialog({ open: true, individual: individualData })}
                              aria-label="Редактировать физическое лицо"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteIndividual(individual)}
                              aria-label="Удалить физическое лицо"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contracts" className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="whitespace-nowrap">Договоры</h3>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Статус</span>
                <Select
                  value={statusFilters.contracts}
                  onValueChange={(value) => handleStatusFilterChange('contracts', value as DirectoryStatusFilter)}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все</SelectItem>
                    <SelectItem value="incomplete">Неполные</SelectItem>
                    <SelectItem value="complete">Готовые</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <ContractFormDialog />
          </div>

          <Card
            className="relative rounded-xl border border-[#E9EDF5] bg-white ring-1 ring-black/5"
            style={cardElevation}
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-xl"
              style={cardInnerHighlight}
            />
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6 md:pl-8">Номер</TableHead>
                    <TableHead>Заказчик</TableHead>
                    <TableHead>Исполнитель</TableHead>
                    <TableHead>Ставка</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="w-24 pr-6 md:pr-8 text-right">
                      <span className="sr-only">Действия</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContracts.map((contract) => {
                    const client = getLegalEntityById(contract.clientId)?.name ?? '-';
                    const contractor = getIndividualById(contract.contractorId)?.name ?? '-';
                    const hasRate = contract.rate > 0;
                    const contractDate = formatContractDate(contract.contractDate);
                    const parentLabel = contract.continuationOfId
                      ? contractNumberMap.get(contract.continuationOfId) ?? contract.continuationOfId
                      : null;
                    const childContracts = contractContinuations.get(contract.id) ?? [];
                    const continuationSummary = childContracts
                      .map((child) => contractNumberMap.get(child.id) ?? child.number ?? child.id)
                      .filter((label) => Boolean(label && label.trim()))
                      .join(', ');

                    return (
                      <TableRow key={contract.id}>
                        <TableCell className="pl-6 md:pl-8">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{contract.number || '—'}</span>
                            {contractDate ? (
                              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                                от {contractDate}
                              </Badge>
                            ) : null}
                            {parentLabel ? (
                              <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200">
                                Продолжает {parentLabel}
                              </Badge>
                            ) : null}
                            {childContracts.length > 0 ? (
                              <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                                Следующие: {continuationSummary || `${childContracts.length} шт.`}
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>{client}</TableCell>
                        <TableCell>{contractor}</TableCell>
                        <TableCell>
                          {hasRate ? (
                            <span>
                              {contract.rate.toLocaleString()} ₽/
                              {contract.rateType === 'hour' ? 'час' : 'мес'}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          {contract.status === 'complete' ? (
                            <Badge variant="default" className="bg-green-100 text-green-800">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Готов
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              <AlertCircle className="w-3 h-3 mr-1" />
                              Неполный
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="pr-6 md:pr-8">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCloneContract(contract)}
                              aria-label="Создать продолжение"
                            >
                              <CopyPlus className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setContractDialog({ open: true, contract, mode: 'edit' })}
                              aria-label="Редактировать контракт"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteContract(contract)}
                              aria-label="Удалить контракт"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
