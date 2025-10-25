import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { StatisticsCards } from './StatisticsCards';
import { ChartsSection } from './ChartsSection';
import { NextStepsBlock } from './NextStepsBlock';
import { useDatabase } from '../data/DataContext';
import type { NavigationPage } from '../types/navigation';
import {
  Database,
  Users,
  Settings,
  FileText,
  CheckCircle,
  AlertCircle,
  Clock,
  Loader2,
} from 'lucide-react';

interface ManagementDashboardProps {
  isJiraConnected: boolean;
  onJiraConnect: () => void;
  onNavigate?: (page: NavigationPage) => void;
}

export function ManagementDashboard({
  isJiraConnected,
  onJiraConnect,
  onNavigate,
}: ManagementDashboardProps) {
  const {
    trackerProjects,
    tasks,
    documents,
    loadTasks,
    loadJiraProjects,
  } = useDatabase();
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!isJiraConnected) {
      return;
    }
    let cancelled = false;
    const fetchTasks = async () => {
      setIsLoadingMetrics(true);
      try {
        await loadTasks();
      } catch (error) {
        console.error('[ManagementDashboard] Unable to load tasks for metrics:', error);
      } finally {
        if (!cancelled) {
          setIsLoadingMetrics(false);
        }
      }
    };
    void fetchTasks();
    return () => {
      cancelled = true;
    };
  }, [isJiraConnected, loadTasks]);

  const summary = useMemo(() => {
    const totalProjects = trackerProjects.length;
    const connectedProjects = trackerProjects.filter((project) => project.status === 'connected').length;

    const totalTasks = tasks.length;
    const billableTasks = tasks.filter((task) => task.billable || task.forceIncluded).length;

    const performerSet = new Set(
      tasks
        .map((task) => task.assigneeAccountId || task.assigneeEmail || task.assigneeDisplayName)
        .filter((value): value is string => Boolean(value)),
    );
    const uniquePerformers = performerSet.size;

    const totalHours = tasks.reduce(
      (sum, task) => sum + (typeof task.hours === 'number' && Number.isFinite(task.hours) ? task.hours : 0),
      0,
    );

    const latestSyncTimestamp = trackerProjects.reduce<number | null>((latest, project) => {
      if (!project.lastSync) {
        return latest;
      }
      const parsed = new Date(project.lastSync).getTime();
      if (Number.isNaN(parsed)) {
        return latest;
      }
      return latest === null || parsed > latest ? parsed : latest;
    }, null);
    const lastSyncDate = latestSyncTimestamp ? new Date(latestSyncTimestamp) : null;
    const lastSyncLabel = lastSyncDate
      ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(lastSyncDate)
      : null;

    const lastSyncRelative = lastSyncDate ? formatRelativeTime(lastSyncDate) : null;

    return {
      totalProjects,
      connectedProjects,
      totalTasks,
      billableTasks,
      uniquePerformers,
      totalHours,
      lastSyncDate,
      lastSyncLabel,
      lastSyncRelative,
    };
  }, [tasks, trackerProjects]);

  const chartsData = useMemo(() => {
    const projectMap = new Map<string, { hours: number; tasks: number }>();
    const performerMap = new Map<string, { hours: number; tasks: number }>();
    const statusMap = new Map<string, number>();
    const weeklyMap = new Map<string, { hours: number; tasks: number; start: Date }>();

    for (const task of tasks) {
      const safeHours = typeof task.hours === 'number' && Number.isFinite(task.hours) ? task.hours : 0;
      const projectName = task.projectName || task.projectKey || 'Без проекта';
      const projectEntry = projectMap.get(projectName) ?? { hours: 0, tasks: 0 };
      projectEntry.hours += safeHours;
      projectEntry.tasks += 1;
      projectMap.set(projectName, projectEntry);

      const performerKey = task.assigneeDisplayName || task.assigneeAccountId || task.assigneeEmail || 'Без исполнителя';
      const performerEntry = performerMap.get(performerKey) ?? { hours: 0, tasks: 0 };
      performerEntry.hours += safeHours;
      performerEntry.tasks += 1;
      performerMap.set(performerKey, performerEntry);

      statusMap.set(task.status, (statusMap.get(task.status) ?? 0) + 1);

      const dateSource = task.completedAt ?? task.updatedAt ?? task.startedAt ?? task.createdAt;
      if (dateSource) {
        const date = new Date(dateSource);
        if (!Number.isNaN(date.getTime())) {
          const weekStart = getWeekStart(date);
          const weekKey = weekStart.toISOString();
          const weekEntry = weeklyMap.get(weekKey) ?? { hours: 0, tasks: 0, start: weekStart };
          weekEntry.hours += safeHours;
          weekEntry.tasks += 1;
          weeklyMap.set(weekKey, weekEntry);
        }
      }
    }

    let projectTime = Array.from(projectMap.entries())
      .map(([name, data]) => ({
        name,
        value: Number(data.hours.toFixed(2)),
        hours: Number(data.hours.toFixed(2)),
        tasks: data.tasks,
      }))
      .sort((a, b) => b.hours - a.hours);

    if (projectTime.length === 0 && trackerProjects.length > 0) {
      projectTime = trackerProjects.map((project) => ({
        name: project.name || project.key,
        value: project.tasksCount,
        hours: project.tasksCount,
        tasks: project.tasksCount,
      }));
    }

    const topPerformers = Array.from(performerMap.entries())
      .map(([name, data]) => ({
        name,
        value: Number(data.hours.toFixed(2)),
        hours: Number(data.hours.toFixed(2)),
        tasks: data.tasks,
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 10);

    const taskStatuses = Array.from(statusMap.entries()).map(([name, count]) => ({
      name,
      value: count,
      count,
    }));

    const weeklyActivity = Array.from(weeklyMap.values())
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map(({ start, hours, tasks }) => ({
        week: formatWeekRange(start),
        hours: Number(hours.toFixed(2)),
        tasks,
      }))
      .slice(-10);

    return {
      projectTime,
      topPerformers,
      taskStatuses,
      weeklyActivity,
    };
  }, [tasks, trackerProjects]);

  const checklistItems = useMemo(() => {
    const discoveredCount = trackerProjects.filter((project) => project.status === 'discovered').length;
    const needsRequisites = trackerProjects.filter(
      (project) => project.readyForDocs === 'needs_requisites' || project.readyForDocs === 'needs_both',
    ).length;
    const needsTasks = trackerProjects.filter(
      (project) => project.readyForDocs === 'needs_tasks' || project.readyForDocs === 'needs_both',
    ).length;
    const readyForDocs = trackerProjects.filter((project) => project.readyForDocs === 'ready').length;
    const documentsCount = documents.length;

    return [
      {
        id: 'connections',
        title: discoveredCount === 0 ? 'Все проекты подключены' : `${discoveredCount} проект(ов) ждут подключения`,
        status: discoveredCount === 0 ? 'completed' : 'warning',
        description:
          discoveredCount === 0
            ? 'Подключения активны и синхронизируются.'
            : 'Откройте вкладку «Проекты трекеров», выберите и подключите проекты.',
        action: discoveredCount === 0 ? 'Перейти к задачам' : 'Настроить проекты',
        actionType: discoveredCount === 0 ? 'success' : 'warning',
        onAction: onNavigate ? () => onNavigate(discoveredCount === 0 ? 'tasks' : 'projects') : undefined,
      },
      {
        id: 'requisites',
        title: needsRequisites === 0 ? 'Реквизиты заполнены' : `${needsRequisites} проект(ов) без реквизитов`,
        status: needsRequisites === 0 ? 'completed' : 'warning',
        description:
          needsRequisites === 0
            ? 'В справочнике заполнены контрагенты.'
            : 'Заполните карточки ЮЛ/ФЛ на вкладке «Справочник».',
        action: 'Открыть справочник',
        actionType: needsRequisites === 0 ? 'success' : 'warning',
        onAction: onNavigate ? () => onNavigate('directory') : undefined,
      },
      {
        id: 'documents',
        title:
          readyForDocs > 0
            ? `${readyForDocs} проект(ов) готовы к документам`
            : needsTasks > 0
              ? `${needsTasks} проект(ов) ждут импорта задач`
              : 'Документы ещё не сформированы',
        status:
          readyForDocs > 0 && documentsCount > 0
            ? 'completed'
            : readyForDocs > 0
              ? 'warning'
              : 'pending',
        description:
          readyForDocs > 0
            ? documentsCount > 0
              ? 'Можно формировать акты и счета по готовым проектам.'
              : 'Импорт завершён — сформируйте пакет документов.'
            : 'После импорта задач подготовьте биллингуемые задачи.',
        action: documentsCount > 0 ? 'Открыть документы' : 'Сформировать пакет',
        actionType: documentsCount > 0 ? 'success' : 'primary',
        onAction: onNavigate ? () => onNavigate('documents') : undefined,
      },
    ];
  }, [documents, onNavigate, trackerProjects]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([loadJiraProjects(), loadTasks()]);
    } catch (error) {
      console.error('[ManagementDashboard] Unable to refresh dashboard data:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadJiraProjects, loadTasks]);

  const formatNumber = useMemo(() => new Intl.NumberFormat('ru-RU'), []);

  if (!isJiraConnected) {
    return (
      <div className="p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="mb-4">Начнём с подключения Jira</h1>
            <p className="text-muted-foreground mb-6">Подключите ваш Jira-проект для импорта задач и учёта времени</p>

            <Button onClick={onJiraConnect} className="mb-2">
              <Database className="w-4 h-4 mr-2" />
              Подключить Jira
            </Button>
            <p className="text-sm text-muted-foreground">Ничего не меняем в Jira, только чтение</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Database className="w-5 h-5 text-blue-600" />
                  </div>
                  <span className="text-blue-600">1</span>
                </div>
                <CardTitle className="text-lg">Подключение Jira</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Импорт проектов, задач и временных меток. Авторизация → выбор проекта → импорт данных
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Users className="w-5 h-5 text-purple-600" />
                  </div>
                  <span className="text-purple-600">2</span>
                </div>
                <CardTitle className="text-lg">Справочники</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Настройка реквизитов ЮЛ, ФЛ и контрактов. ИНН/КПП, подписанты, основания, ставки
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  </div>
                  <span className="text-green-600">3</span>
                </div>
                <CardTitle className="text-lg">Проверка задач</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Фильтрация биллингуемых задач и временных меток. Статусы, периоды, исключения
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Генерация документов
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Создание актов, счетов и отчетов. PDF/DOCX/Excel форматы, расчёт ставок
              </p>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>• Заполните реквизиты организаций и контрактов</p>
                <p>• Дополните данные физлиц, паспорт и адрес регистрации</p>
              </div>
            </CardContent>
          </Card>

          <div className="mt-8 p-4 bg-muted/50 rounded-lg">
            <h3 className="text-sm font-medium mb-2">Пустое состояние</h3>
            <p className="text-sm text-muted-foreground">
              Для начала работы подключите Jira-проект или настройте справочники.
            </p>
            <div className="flex gap-2 mt-3">
              <Button onClick={onJiraConnect} size="sm">
                Подключить Jira
              </Button>
              <Button variant="outline" size="sm">
                Открыть справочник
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isBusy = isLoadingMetrics || isRefreshing;
  const syncBadgeClass =
    summary.lastSyncDate !== null ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700';

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="mb-2">Управление проектами</h1>
            <p className="text-muted-foreground">Общая статистика и аналитика по подключенным проектам</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className={syncBadgeClass}>
              <Clock className="w-3 h-3 mr-1" />
              {summary.lastSyncLabel ?? 'Синхронизация ещё не выполнялась'}
            </Badge>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
              {isRefreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Settings className="w-4 h-4 mr-2" />}
              Обновить
            </Button>
          </div>
        </div>

        <StatisticsCards summary={summary} isLoading={isBusy && tasks.length === 0} />

        <ChartsSection
          projectTime={chartsData.projectTime}
          weeklyActivity={chartsData.weeklyActivity}
          topPerformers={chartsData.topPerformers}
          taskStatuses={chartsData.taskStatuses}
          isLoading={isBusy && tasks.length === 0}
        />

        <NextStepsBlock items={checklistItems} isLoading={isBusy && tasks.length === 0} />

        <div className="mt-8 space-y-3">
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              {summary.lastSyncLabel
                ? `Последняя синхронизация: ${summary.lastSyncLabel} (${summary.lastSyncRelative}).`
                : 'Синхронизация Jira ещё не запускалась. После импорта обновите данные.'}
            </AlertDescription>
          </Alert>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Биллингуемые задачи: {formatNumber.format(summary.billableTasks)} из{' '}
              {formatNumber.format(summary.totalTasks)}. Настройте статусы, если в отчёте появляются лишние задачи.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  );
}

function getWeekStart(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  result.setDate(result.getDate() + diff);
  return result;
}

const weekRangeFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' });

function formatWeekRange(start: Date) {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${weekRangeFormatter.format(start)} — ${weekRangeFormatter.format(end)}`;
}

function formatRelativeTime(date: Date) {
  const diff = date.getTime() - Date.now();
  const absolute = Math.abs(diff);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const formatter = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' });

  if (absolute < hour) {
    const minutes = Math.round(diff / minute);
    return formatter.format(minutes, 'minute');
  }
  if (absolute < day) {
    const hours = Math.round(diff / hour);
    return formatter.format(hours, 'hour');
  }
  const days = Math.round(diff / day);
  return formatter.format(days, 'day');
}
