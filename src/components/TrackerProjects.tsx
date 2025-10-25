import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Repeat, Settings, Copy, Link, Trash2, RefreshCw, FolderOpen, CheckCircle2, ListTodo, BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import { useDatabase } from '../data/DataContext';
import type { TrackerProject } from '../data/models';

interface TrackerProjectsProps {
  onProjectSettings?: (projectId: string) => void;
}

const readinessLabels: Record<string, string> = {
  ready: 'Готов к документам',
  needs_requisites: 'Заполните реквизиты',
  needs_tasks: 'Импортируйте задачи',
  needs_both: 'Заполните реквизиты и задачи',
  needs_setup: 'Требуется настройка',
};

const projectIcon = (tracker: string | null | undefined) => {
  const normalized = (tracker ?? '').toLowerCase();
  if (normalized.includes('jira')) {
    return '📋';
  }
  if (normalized.includes('todo') || normalized.includes('todu')) {
    return '✅';
  }
  return '🚀';
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('ru-RU');
};

const copyToClipboard = (text: string) => {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {
      window.prompt('Скопируйте значение вручную', text);
    });
  } else {
    window.prompt('Скопируйте значение вручную', text);
  }
};

export function TrackerProjects({ onProjectSettings }: TrackerProjectsProps) {
  const {
    trackerProjects,
    loadJiraProjects,
    deleteTrackerProject,
    importJiraProject,
  } = useDatabase();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [draftsExpanded, setDraftsExpanded] = useState(false);
  const [projectLoading, setProjectLoading] = useState<Record<string, boolean>>({});

  const selectedProject = useMemo(
    () => trackerProjects.find((project) => project.id === selectedProjectId) ?? null,
    [selectedProjectId, trackerProjects],
  );

  const discoveredProjects = useMemo(
    () => trackerProjects.filter((project) => project.status === 'discovered'),
    [trackerProjects],
  );

  const connectedProjects = useMemo(
    () => trackerProjects.filter((project) => project.status !== 'discovered'),
    [trackerProjects],
  );

  const isProjectLoading = useCallback(
    (project: TrackerProject) => Boolean(projectLoading[project.id]),
    [projectLoading],
  );

  const toggleDrafts = () => setDraftsExpanded((current) => !current);

  const markProjectLoading = (projectId: string, loading: boolean) => {
    setProjectLoading((current) => {
      if (current[projectId] === loading) {
        return current;
      }
      const next = { ...current };
      if (loading) {
        next[projectId] = true;
      } else {
        delete next[projectId];
      }
      return next;
    });
  };

  const refreshProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await loadJiraProjects();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить проекты';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [loadJiraProjects]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const totalProjects = trackerProjects.length;
  const connectedCount = trackerProjects.filter((project) => project.status === 'connected').length;
  const totalTasks = trackerProjects.reduce(
    (sum, project) => sum + (typeof project.tasksCount === 'number' ? project.tasksCount : 0),
    0,
  );
  const readinessPercent = totalProjects === 0 ? 0 : Math.round((connectedCount / totalProjects) * 100);

  const statsData = [
    {
      title: 'Всего проектов',
      value: totalProjects.toString(),
      description: 'проектов в системе',
      icon: FolderOpen,
      iconBg: 'bg-blue-500',
      iconColor: 'text-white',
      badgeColor: 'bg-blue-100 text-blue-700',
      badgeText: 'Активно',
    },
    {
      title: 'Подключено',
      value: connectedCount.toString(),
      description: 'синхронизировано',
      icon: CheckCircle2,
      iconBg: 'bg-green-500',
      iconColor: 'text-white',
      badgeColor: 'bg-green-100 text-green-700',
      badgeText: 'Готово',
    },
    {
      title: 'Всего задач',
      value: totalTasks.toString(),
      description: 'импортированных задач',
      icon: ListTodo,
      iconBg: 'bg-purple-500',
      iconColor: 'text-white',
      badgeColor: 'bg-purple-100 text-purple-700',
      badgeText: 'Отслеживается',
    },
    {
      title: 'Готовность',
      value: `${readinessPercent}%`,
      description: 'готовность проектов',
      icon: BarChart3,
      iconBg: 'bg-orange-500',
      iconColor: 'text-white',
      badgeColor: 'bg-orange-100 text-orange-700',
      badgeText: 'Прогресс',
    },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'connected':
        return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Подключен</Badge>;
      case 'syncing':
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Синхронизация</Badge>;
      case 'error':
        return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Ошибка</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">Черновик</Badge>;
    }
  };

  const openSettings = (projectId: string) => {
    setSelectedProjectId(projectId);
    setSettingsOpen(true);
    onProjectSettings?.(projectId);
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    setSelectedProjectId(null);
  };

  const handleDeleteProject = async (projectId: string, name: string) => {
    if (!window.confirm(`Удалить проект «${name}» и связанные данные?`)) {
      return;
    }
    try {
      await deleteTrackerProject(projectId);
      await refreshProjects();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось удалить проект';
      window.alert(message);
    }
  };

  const handleProjectSync = async (project: TrackerProject) => {
    if (!project.connectionId || !project.key) {
      setError('Для проекта отсутствует идентификатор подключения.');
      return;
    }
    setError(null);
    markProjectLoading(project.id, true);
    try {
      await importJiraProject({
        connectionId: project.connectionId,
        projectKey: project.key,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить проект';
      setError(message);
    } finally {
      markProjectLoading(project.id, false);
    }
  };

  const renderProjectRow = (project: TrackerProject, variant: 'connected' | 'draft') => {
    const loading = isProjectLoading(project);
    const isDraft = variant === 'draft';
    return (
      <tr
        key={project.id}
        className={`border-b border-gray-100 ${isDraft ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
      >
        <td className="px-6 py-4">
          <div className="flex items-center gap-2">
            <span>{projectIcon(project.tracker)}</span>
            <span className="text-gray-900">{project.name || project.key}</span>
          </div>
        </td>
        <td className="px-6 py-4 text-gray-700">{project.key}</td>
        <td className="px-6 py-4">
          <div className="flex items-center gap-2">
            <Link className="w-4 h-4 text-blue-500" />
            <span className="text-blue-600">{project.tracker || 'Jira'}</span>
          </div>
        </td>
        <td className="px-6 py-4">
          <Badge variant="outline" className="text-xs">
            {readinessLabels[project.readyForDocs ?? 'needs_setup'] ?? 'Требуется настройка'}
          </Badge>
        </td>
        <td className="px-6 py-4">{getStatusBadge(project.status)}</td>
        <td className="px-6 py-4 text-gray-700">{formatDateTime(project.lastSync)}</td>
        <td className="px-6 py-4 text-gray-700">
          {typeof project.tasksCount === 'number' ? project.tasksCount : 0}
        </td>
        <td className="px-6 py-4">
          {isDraft ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleProjectSync(project)}
              disabled={loading}
              aria-label="Подключить проект"
            >
              <RefreshCw
                className={`w-4 h-4 mr-2 ${loading ? 'animate-spin text-blue-600' : ''}`}
              />
              Подключить
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleProjectSync(project)}
                disabled={loading}
                aria-label="Обновить проект"
              >
                <RefreshCw
                  className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`}
                />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openSettings(project.id)}
                aria-label="Настройки проекта"
              >
                <Settings className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDeleteProject(project.id, project.name || project.key)}
                aria-label="Удалить проект"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(project.connection ?? '')}
                aria-label="Скопировать URL подключения"
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-gray-900 mb-1">Проекты трекеров</h1>
          <p className="text-gray-600">Управление подключенными системами трекинга задач</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshProjects} disabled={isLoading}>
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" style={{ animationPlayState: isLoading ? 'running' : 'paused' }} />
            Обновить
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statsData.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Card className="relative overflow-hidden border-l-4 border-l-transparent hover:border-l-primary/20 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className={`p-2 rounded-lg text-white ${stat.iconBg}`}>
                      <Icon className={`w-4 h-4 ${stat.iconColor}`} />
                    </div>
                    <Badge variant="secondary" className={`${stat.badgeColor} text-xs`}>
                      {stat.badgeText}
                    </Badge>
                  </div>
                  <CardTitle className="text-sm text-muted-foreground font-normal">
                    {stat.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-1">
                    <div className="text-2xl font-semibold tracking-tight">
                      {stat.value}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {stat.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <Card className="border border-gray-200 mb-6 shadow-sm">
        <div className="p-6 border-b border-gray-200 bg-gray-50/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100">
                <Repeat className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="text-gray-900">Проекты трекеров</h3>
                <p className="text-sm text-gray-600">
                  Все подключенные проекты и их готовность к формированию документов
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-gray-600">Название</th>
                <th className="px-6 py-3 text-left text-gray-600">Ключ</th>
                <th className="px-6 py-3 text-left text-gray-600">Трекер</th>
                <th className="px-6 py-3 text-left text-gray-600">Готовность</th>
                <th className="px-6 py-3 text-left text-gray-600">Статус</th>
                <th className="px-6 py-3 text-left text-gray-600">Последняя синхронизация</th>
                <th className="px-6 py-3 text-left text-gray-600">Задач</th>
                <th className="px-6 py-3 text-left text-gray-600">Действия</th>
              </tr>
            </thead>
            <tbody>
              {connectedProjects.length === 0 && discoveredProjects.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-6 text-center text-sm text-muted-foreground">
                    {isLoading ? 'Загружаем проекты...' : 'Подключенных проектов пока нет.'}
                  </td>
                </tr>
              ) : (
                <>
                  {connectedProjects.length === 0 && discoveredProjects.length > 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-6 text-center text-sm text-muted-foreground">
                        Подключенных проектов пока нет. Разверните список черновиков, чтобы выбрать проекты для импорта.
                      </td>
                    </tr>
                  ) : null}
                  {connectedProjects.map((project) => renderProjectRow(project, 'connected'))}
                  {discoveredProjects.length > 0 ? (
                    <>
                      {draftsExpanded ? discoveredProjects.map((project) => renderProjectRow(project, 'draft')) : null}
                      <tr className="border-b border-gray-100 bg-white">
                        <td colSpan={8} className="px-6 py-3">
                          <Button variant="ghost" size="sm" onClick={toggleDrafts} className="flex items-center gap-2 text-gray-600">
                            {draftsExpanded ? (
                              <>
                                <ChevronUp className="w-4 h-4" />
                                Скрыть проекты в черновике
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-4 h-4" />
                                Развернуть проекты в черновике ({discoveredProjects.length})
                              </>
                            )}
                          </Button>
                        </td>
                      </tr>
                    </>
                  ) : null}
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={settingsOpen && Boolean(selectedProject)} onOpenChange={(open) => (!open ? closeSettings() : undefined)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-600" />
              {selectedProject?.name || selectedProject?.key || 'Настройки проекта'}
            </DialogTitle>
            <DialogDescription>
              Детали подключения проекта и его готовность к документообороту
            </DialogDescription>
          </DialogHeader>

          {selectedProject ? (
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <div className="text-xs text-muted-foreground">Ключ проекта</div>
                <div className="font-medium">{selectedProject.key}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Система</div>
                <div className="font-medium">{selectedProject.tracker || 'Jira'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Готовность</div>
                <div className="font-medium">
                  {readinessLabels[selectedProject.readyForDocs ?? 'needs_setup'] ?? 'Требуется настройка'}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Последняя синхронизация</div>
                <div className="font-medium">{formatDateTime(selectedProject.lastSync)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Импортировано задач</div>
                <div className="font-medium">
                  {typeof selectedProject.tasksCount === 'number' ? selectedProject.tasksCount : 0}
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button variant="outline" onClick={closeSettings}>
              Закрыть
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
