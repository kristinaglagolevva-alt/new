import { useEffect, useMemo, useState } from 'react';
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Progress } from "./ui/progress";
import { Checkbox } from "./ui/checkbox";
import { Link, CheckCircle, Loader2, AlertTriangle, AlertCircle } from "lucide-react";
import { useDatabase } from '../data/DataContext';
import type { TrackerProject, ImportSummary, ImportLog } from '../data/models';

interface JiraConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnectionComplete: () => void;
}

type DialogStep = 'auth' | 'projects' | 'importing' | 'complete';

export function JiraConnectionDialog({ open, onOpenChange, onConnectionComplete }: JiraConnectionDialogProps) {
  const { connectJira, importJiraProject, loadImportLogs } = useDatabase();
  const [step, setStep] = useState<DialogStep>('auth');
  const [jiraUrl, setJiraUrl] = useState('');
  const [email, setEmail] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [availableProjects, setAvailableProjects] = useState<TrackerProject[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string>('');
  const [selectedProjectKeys, setSelectedProjectKeys] = useState<string[]>([]);
  const [importQueueCount, setImportQueueCount] = useState(0);
  const [importedProjects, setImportedProjects] = useState<Array<{ project: TrackerProject; summary: ImportSummary }>>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importHistory, setImportHistory] = useState<ImportLog[]>([]);

  useEffect(() => {
    if (!open) {
      setStep('auth');
      setJiraUrl('');
      setEmail('');
      setApiToken('');
      setConnectionId(null);
      setAvailableProjects([]);
      setSelectedProjectKey('');
      setSelectedProjectKeys([]);
      setImportProgress(0);
      setError(null);
      setIsSubmitting(false);
      setImportSummary(null);
      setImportHistory([]);
      setImportQueueCount(0);
      setImportedProjects([]);
    }
  }, [open]);

  const handleAuth = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const { connectionId, projects } = await connectJira({ baseUrl: jiraUrl.trim(), email: email.trim(), apiToken: apiToken.trim() });
      setConnectionId(connectionId);
      setAvailableProjects(projects);
      setStep('projects');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось подключиться к Jira';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleProjectSelection = (projectKey: string) => {
    if (isSubmitting) {
      return;
    }
    setSelectedProjectKeys((current) => {
      const hasProject = current.includes(projectKey);
      if (hasProject) {
        return current.filter((key) => key !== projectKey);
      }
      return [...current, projectKey];
    });
  };

  const selectAllProjects = () => {
    if (isSubmitting) {
      return;
    }
    setSelectedProjectKeys((current) => {
      if (current.length === availableProjects.length) {
        return [];
      }
      return availableProjects.map((project) => project.key);
    });
  };

  const handleImportSelected = async () => {
    if (!connectionId || selectedProjectKeys.length === 0) {
      return;
    }
    const keysToImport = [...selectedProjectKeys];
    setIsSubmitting(true);
    setError(null);
    setImportSummary(null);
    setImportHistory([]);
    setImportedProjects([]);
    setImportQueueCount(keysToImport.length);
    setStep('importing');
    const initialProgress = keysToImport.length > 1 ? Math.max(5, Math.round(100 / (keysToImport.length * 2))) : 30;
    setImportProgress(initialProgress);

    const aggregatedResults: Array<{ project: TrackerProject; summary: ImportSummary }> = [];
    const pendingKeys = new Set(keysToImport);
    let failedProjectKey: string | null = null;

    try {
      for (let index = 0; index < keysToImport.length; index += 1) {
        const projectKey = keysToImport[index];
        failedProjectKey = projectKey;
        setSelectedProjectKey(projectKey);
        if (keysToImport.length > 1) {
          const beforeProgress = Math.max(initialProgress, Math.round((index / keysToImport.length) * 100));
          setImportProgress(beforeProgress);
        }
        const { project, summary } = await importJiraProject({ connectionId, projectKey });
        aggregatedResults.push({ project, summary });
        setImportedProjects((current) => [...current, { project, summary }]);
        pendingKeys.delete(projectKey);
        const progressValue = Math.round(((index + 1) / keysToImport.length) * 100);
        setImportProgress(progressValue);
      }

      const aggregateSummary = aggregatedResults.reduce<ImportSummary>(
        (acc, { summary }) => ({
          created: acc.created + summary.created,
          updated: acc.updated + summary.updated,
          skipped: acc.skipped + summary.skipped,
          reason: acc.reason ?? summary.reason ?? null,
        }),
        { created: 0, updated: 0, skipped: 0, reason: null },
      );

      setImportSummary(aggregateSummary);
      const history = await loadImportLogs();
      const filteredHistory = history
        .filter((log) => keysToImport.includes(log.projectKey))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setImportHistory(filteredHistory);
      setSelectedProjectKeys([]);
      setTimeout(() => {
        setStep('complete');
        setImportQueueCount(0);
        setSelectedProjectKey('');
      }, 300);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось импортировать данные из Jira';
      setError(message);
      setImportProgress(0);
      setStep('projects');
      setImportSummary(null);
      setImportHistory([]);
      setImportedProjects([]);
      setImportQueueCount(0);
      if (failedProjectKey) {
        setSelectedProjectKey(failedProjectKey);
      }
      setSelectedProjectKeys(Array.from(pendingKeys));
    }
    setIsSubmitting(false);
  };

  const projectNamesByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of availableProjects) {
      map.set(project.key, project.name);
    }
    for (const item of importedProjects) {
      map.set(item.project.key, item.project.name);
    }
    return map;
  }, [availableProjects, importedProjects]);

  const handleComplete = () => {
    onConnectionComplete();
    onOpenChange(false);
  };

  const renderError = () =>
    error ? (
      <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5" />
        <span>{error}</span>
      </div>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link className="w-5 h-5 text-blue-600" />
            Подключение Jira
          </DialogTitle>
        </DialogHeader>

        {step === 'auth' && (
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-5 h-5 text-blue-600" />
                <span className="font-medium">Безопасное подключение</span>
              </div>
              <p className="text-sm text-blue-700">
                Данные используются только для чтения проектов и задач. Токен хранится локально на сервере.
              </p>
            </div>

            {renderError()}

            <div className="space-y-3">
              <div>
                <Label>URL вашей Jira</Label>
                <Input
                  placeholder="https://yourcompany.atlassian.net"
                  value={jiraUrl}
                  onChange={(event) => setJiraUrl(event.target.value)}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="integration@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div>
                <Label>API Token</Label>
                <Input
                  type="password"
                  placeholder="Вставьте ваш API токен"
                  value={apiToken}
                  onChange={(event) => setApiToken(event.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Создайте API токен в настройках аккаунта Atlassian → Security.
                </p>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={handleAuth}
              disabled={!jiraUrl || !email || !apiToken || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Подключаемся…
                </>
              ) : (
                'Авторизоваться'
              )}
            </Button>
          </div>
        )}

        {step === 'projects' && (
          <div className="space-y-4">
            <div className="p-3 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="font-medium text-green-800">Подключение успешно</span>
              </div>
              <p className="text-sm text-green-700 mt-1">
                Найдено {availableProjects.length} проектов. Отметьте нужные для импорта задач.
              </p>
            </div>

            {renderError()}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Проекты</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3"
                  onClick={selectAllProjects}
                  disabled={availableProjects.length === 0}
                >
                  {selectedProjectKeys.length === availableProjects.length && availableProjects.length > 0
                    ? 'Снять выделение'
                    : 'Выбрать все'}
                </Button>
              </div>
              <div className="space-y-2">
                {availableProjects.map((project) => {
                  const selected = selectedProjectKeys.includes(project.key);
                  return (
                    <div
                      key={project.key}
                      className="p-3 border rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => toggleProjectSelection(project.key)}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => toggleProjectSelection(project.key)}
                          onClick={(event) => event.stopPropagation()}
                          disabled={isSubmitting}
                        />
                        <div className="flex flex-1 items-center justify-between gap-3">
                          <div>
                            <div className="font-medium">{project.name}</div>
                            <div className="text-sm text-muted-foreground">Ключ: {project.key}</div>
                          </div>
                          {selected ? (
                            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                              Выбрано
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <Button
                className="w-full"
                onClick={handleImportSelected}
                disabled={selectedProjectKeys.length === 0 || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Импортируем…
                  </>
                ) : (
                  `Импортировать выбранные (${selectedProjectKeys.length})`
                )}
              </Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="space-y-4">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-4" />
              <h3 className="font-medium mb-2">Импортируем данные</h3>
              <p className="text-sm text-muted-foreground">
                {selectedProjectKey
                  ? `Загружаем данные проекта ${selectedProjectKey}`
                  : 'Загружаем данные из выбранных проектов'}
              </p>
              {importQueueCount > 1 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Проект {Math.min(importedProjects.length + 1, importQueueCount)} из {importQueueCount}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Прогресс импорта</span>
                <span>{importProgress}%</span>
              </div>
              <Progress value={importProgress} className="h-2" />
            </div>

            <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <span className="text-sm font-medium">Не закрывайте окно</span>
              </div>
              <p className="text-xs text-orange-700 mt-1">
                Импорт может занять несколько минут в зависимости от объёма задач.
              </p>
            </div>
          </div>
        )}

        {step === 'complete' && (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-lg font-medium">
              {importedProjects.length > 1 ? 'Импорт завершён' : 'Проект подключен'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {importedProjects.length > 1
                ? `Импортированы ${importedProjects.length} проекта(ов). Можно перейти к задачам и проверке перед биллингом.`
                : 'Данные успешно импортированы. Можно перейти к задачам и проверке перед биллингом.'}
            </p>
            {importSummary && (
              <div className="text-sm text-left bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="font-medium mb-1">
                  {importedProjects.length > 1 ? 'Сводные результаты' : 'Итог импорта'}
                </p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>Создано: {importSummary.created}</li>
                  <li>Обновлено: {importSummary.updated}</li>
                  <li>
                    Пропущено: {importSummary.skipped}
                    {importSummary.reason ? ` (${importSummary.reason})` : ''}
                  </li>
                </ul>
              </div>
            )}
            {importedProjects.length > 1 && (
              <div className="text-sm text-left bg-white border border-slate-200 rounded-lg p-3">
                <p className="font-medium mb-2">По каждому проекту</p>
                <div className="space-y-2">
                  {importedProjects.map(({ project, summary }) => (
                    <div key={project.key} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                      <div>
                        <div className="font-medium">{project.name}</div>
                        <div className="text-xs text-muted-foreground">Ключ: {project.key}</div>
                      </div>
                      <div className="text-xs text-muted-foreground text-right">
                        <div>Создано: {summary.created}</div>
                        <div>Обновлено: {summary.updated}</div>
                        <div>
                          Пропущено: {summary.skipped}
                          {summary.reason ? ` (${summary.reason})` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {importHistory.length > 0 && (
              <div className="text-sm text-left bg-white border border-slate-200 rounded-lg p-0">
                <div className="px-3 py-2 border-b bg-slate-50 rounded-t-lg">
                  <p className="font-medium">История импортов</p>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-medium">Проект</th>
                        <th className="px-3 py-2 font-medium">Дата</th>
                        <th className="px-3 py-2 font-medium">Создано</th>
                        <th className="px-3 py-2 font-medium">Обновлено</th>
                        <th className="px-3 py-2 font-medium">Пропущено</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importHistory.slice(0, 8).map((log) => (
                        <tr key={log.id} className="border-t">
                          <td className="px-3 py-2">{projectNamesByKey.get(log.projectKey) ?? log.projectKey}</td>
                          <td className="px-3 py-2">{new Date(log.createdAt).toLocaleString('ru-RU')}</td>
                          <td className="px-3 py-2">{log.created}</td>
                          <td className="px-3 py-2">{log.updated}</td>
                          <td className="px-3 py-2">{log.skipped}{log.reason ? ` (${log.reason})` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <Button className="w-full" onClick={handleComplete}>
              Перейти к задачам
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
