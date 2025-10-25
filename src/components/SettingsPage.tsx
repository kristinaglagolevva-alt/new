import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Separator } from "./ui/separator";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useAuth } from "../data/AuthContext";
import { useDatabase } from "../data/DataContext";
import { useWorkspace } from "../data/WorkspaceContext";
import {
  Users as UsersIcon,
  UserPlus,
  RefreshCw,
  ClipboardCopy,
  Link,
  Bell,
  Shield,
  Download,
  Trash2,
  Plus,
} from "lucide-react";
import type { User, UserRole, WorkspaceRole } from "../data/models";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Администратор',
  accountant: 'Бухгалтер',
  manager: 'Менеджер',
  performer: 'Исполнитель',
  viewer: 'Наблюдатель',
};

const ROLE_DISPLAY_ORDER: UserRole[] = ['admin', 'accountant', 'manager', 'performer', 'viewer'];
const MUTABLE_ROLES: UserRole[] = ['manager', 'performer'];
const ROLE_BADGE_VARIANT: Record<UserRole, 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  accountant: 'secondary',
  manager: 'secondary',
  performer: 'outline',
  viewer: 'outline',
};

const CREATION_ROLES: UserRole[] = ['admin', 'accountant', 'manager', 'performer'];
const WORKSPACE_CREATABLE_ROLES: UserRole[] = ['accountant', 'manager', 'performer', 'viewer'];

const SUPER_ADMIN_EMAIL = (import.meta.env.VITE_SUPER_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();

const generateSecurePassword = (length = 12): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@$!%*?&';
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const bytes = new Uint32Array(length);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
  }
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
};

export function SettingsPage() {
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const {
    users,
    loadUsers,
    registerUser,
    resetUserPassword,
    deleteUser,
    updateUserRoles,
    workspaceMembers,
    loadWorkspaceMembers,
    createWorkspaceUser,
    allWorkspaces,
    loadAllWorkspaces,
  } = useDatabase();

  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [passwordMode, setPasswordMode] = useState<'generated' | 'manual'>('generated');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [localCopyFeedback, setLocalCopyFeedback] = useState<string | null>(null);
  const [lastCredentials, setLastCredentials] = useState<{ email: string; password: string } | null>(null);
  const [localCredentials, setLocalCredentials] = useState<{ email: string; password: string } | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const localCopyTimeoutRef = useRef<number | null>(null);
  const workspaceCatalogLoadedRef = useRef(false);
  const usersLoadedRef = useRef(false);

  const [form, setForm] = useState<{ email: string; fullName: string; role: UserRole; password: string }>(
    () => ({
      email: '',
      fullName: '',
      role: 'manager',
      password: '',
    })
  );
  const [workspaceMode, setWorkspaceMode] = useState<'new' | 'existing'>('new');
  const [workspaceName, setWorkspaceName] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceCatalogLoading, setWorkspaceCatalogLoading] = useState(false);
  const [workspaceCatalogError, setWorkspaceCatalogError] = useState<string | null>(null);
  const [workspaceMembersLoading, setWorkspaceMembersLoading] = useState(false);
  const [workspaceMembersError, setWorkspaceMembersError] = useState<string | null>(null);
  const [localCreateError, setLocalCreateError] = useState<string | null>(null);
  const [localCreating, setLocalCreating] = useState(false);
  const [localPasswordMode, setLocalPasswordMode] = useState<'generated' | 'manual'>('generated');
  const [localForm, setLocalForm] = useState<{ email: string; fullName: string; role: UserRole; password: string }>(
    () => ({
      email: '',
      fullName: '',
      role: 'accountant',
      password: '',
    })
  );

  const normalizedUserEmail = user?.email?.toLowerCase() ?? null;
  const isSuperAdmin = normalizedUserEmail === SUPER_ADMIN_EMAIL;
  const canManageUsers = isSuperAdmin;
  const canViewUsers = isSuperAdmin;
  const currentWorkspaceRole = useMemo<WorkspaceRole>(() => {
    if (!currentWorkspace?.id || !user) {
      return (user?.workspaces?.[0]?.role ?? user?.role ?? 'viewer') as WorkspaceRole;
    }
    const matched = (user.workspaces ?? []).find((workspace) => workspace.id === currentWorkspace.id);
    return (matched?.role ?? user.role ?? 'viewer') as WorkspaceRole;
  }, [currentWorkspace?.id, user]);
  const canManageWorkspace = !isSuperAdmin && (currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin');

  const visibleUsers = useMemo(() => {
    if (!canViewUsers) {
      return [] as typeof users;
    }
    return [...users].sort((a, b) => a.email.localeCompare(b.email, 'ru'));
  }, [canViewUsers, users]);

  const handleReloadUsers = useCallback(async () => {
    if (!canViewUsers) {
      return;
    }
    setUsersLoading(true);
    setUsersError(null);
    try {
      await loadUsers();
      usersLoadedRef.current = true;
    } catch (error) {
      usersLoadedRef.current = false;
      const message = error instanceof Error ? error.message : 'Не удалось загрузить пользователей';
      setUsersError(message);
      throw error;
    } finally {
      setUsersLoading(false);
    }
  }, [canViewUsers, loadUsers]);

  useEffect(() => {
    if (!canViewUsers) {
      return;
    }
    if (usersLoadedRef.current) {
      return;
    }
    handleReloadUsers().catch(() => {
      /* сообщение уже зафиксировано */
    });
  }, [canViewUsers, handleReloadUsers]);

  useEffect(() => {
    if (!isSuperAdmin) {
      workspaceCatalogLoadedRef.current = false;
      return;
    }
    if (workspaceCatalogLoadedRef.current) {
      return;
    }
    setWorkspaceCatalogLoading(true);
    setWorkspaceCatalogError(null);
    loadAllWorkspaces()
      .then(() => {
        workspaceCatalogLoadedRef.current = true;
      })
      .catch((error) => {
        workspaceCatalogLoadedRef.current = false;
        const message = error instanceof Error ? error.message : 'Не удалось загрузить список рабочих пространств';
        setWorkspaceCatalogError(message);
      })
      .finally(() => {
        setWorkspaceCatalogLoading(false);
      });
  }, [isSuperAdmin, loadAllWorkspaces]);

  const handleReloadWorkspaceMembers = useCallback(async () => {
    if (!currentWorkspace?.id) {
      return;
    }
    setWorkspaceMembersLoading(true);
    setWorkspaceMembersError(null);
    try {
      await loadWorkspaceMembers(currentWorkspace.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить участников';
      setWorkspaceMembersError(message);
    } finally {
      setWorkspaceMembersLoading(false);
    }
  }, [currentWorkspace?.id, loadWorkspaceMembers]);

  useEffect(() => {
    if (!canManageWorkspace) {
      loadWorkspaceMembers(null).catch(() => {
        /* ignore */
      });
      return;
    }
    if (!currentWorkspace?.id) {
      return;
    }
    handleReloadWorkspaceMembers().catch(() => {
      /* handled separately */
    });
  }, [canManageWorkspace, currentWorkspace?.id, handleReloadWorkspaceMembers, loadWorkspaceMembers]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      if (localCopyTimeoutRef.current !== null) {
        window.clearTimeout(localCopyTimeoutRef.current);
      }
    };
  }, []);

  const handlePasswordModeChange = useCallback((checked: boolean) => {
    setPasswordMode(checked ? 'generated' : 'manual');
    if (checked) {
      setForm((prev) => ({ ...prev, password: '' }));
    }
  }, []);

  const handleCopyCredentials = useCallback(async () => {
    if (!lastCredentials) {
      return;
    }
    const payload = `Email: ${lastCredentials.email}\nПароль: ${lastCredentials.password}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = payload;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopyFeedback('Данные скопированы в буфер обмена');
    } catch (error) {
      console.error('[SettingsPage] Unable to copy credentials', error);
      setCopyFeedback('Не удалось скопировать данные');
    } finally {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => setCopyFeedback(null), 2500);
    }
  }, [lastCredentials]);

  const handleCopyLocalCredentials = useCallback(async () => {
    if (!localCredentials) {
      return;
    }
    const payload = `Email: ${localCredentials.email}\nПароль: ${localCredentials.password}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = payload;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setLocalCopyFeedback('Данные скопированы в буфер обмена');
    } catch (error) {
      console.error('[SettingsPage] Unable to copy local credentials', error);
      setLocalCopyFeedback('Не удалось скопировать данные');
    } finally {
      if (localCopyTimeoutRef.current !== null) {
        window.clearTimeout(localCopyTimeoutRef.current);
      }
      localCopyTimeoutRef.current = window.setTimeout(() => setLocalCopyFeedback(null), 2500);
    }
  }, [localCredentials]);

  const handleLocalPasswordModeChange = useCallback((checked: boolean) => {
    setLocalPasswordMode(checked ? 'generated' : 'manual');
    if (checked) {
      setLocalForm((prev) => ({ ...prev, password: '' }));
    }
  }, []);

  const handleResetPassword = useCallback(
    async (account: User) => {
      if (!canManageUsers) {
        return;
      }
      const confirmed = window.confirm(`Сбросить пароль для пользователя ${account.email}?`);
      if (!confirmed) {
        return;
      }

      setResettingUserId(account.id);
      try {
        const result = await resetUserPassword(account.id);
        setLastCredentials({ email: account.email, password: result.password });
        window.alert('Готово! Новый пароль показан выше. Передайте его пользователю безопасным способом.');
      } catch (error) {
        console.error('[SettingsPage] Unable to reset password', error);
        const message = error instanceof Error ? error.message : 'Не удалось сбросить пароль';
        window.alert(message);
      } finally {
        setResettingUserId(null);
      }
    },
    [canManageUsers, resetUserPassword]
  );

  const handleDeleteUser = useCallback(
    async (account: User) => {
      if (!canManageUsers) {
        return;
      }
      const confirmed = window.confirm(`Удалить доступ для пользователя ${account.email}?`);
      if (!confirmed) {
        return;
      }

      setDeletingUserId(account.id);
      try {
        await deleteUser(account.id);
        if (lastCredentials?.email === account.email) {
          setLastCredentials(null);
        }
      } catch (error) {
        console.error('[SettingsPage] Unable to delete user', error);
        const message = error instanceof Error ? error.message : 'Не удалось удалить пользователя';
        window.alert(message);
      } finally {
        setDeletingUserId(null);
      }
    },
    [canManageUsers, deleteUser, lastCredentials]
  );

  const handleToggleUserRole = useCallback(
    async (account: User, role: UserRole, checked: boolean) => {
      if (!canManageUsers) {
        return;
      }
      if (!MUTABLE_ROLES.includes(role)) {
        return;
      }

      const currentRoles = account.roles.filter((item) => MUTABLE_ROLES.includes(item));
      const hasRole = currentRoles.includes(role);

      if (checked && hasRole) {
        return;
      }

      if (!checked && !hasRole) {
        return;
      }

      const nextRoles = (() => {
        if (checked) {
          return [...currentRoles, role];
        }
        const filtered = currentRoles.filter((item) => item !== role);
        if (filtered.length === 0) {
          window.alert('Пользователь должен иметь хотя бы одну роль');
          return null;
        }
        return filtered;
      })();

      if (!nextRoles) {
        return;
      }

      setUpdatingRoleId(account.id);
      try {
        await updateUserRoles(account.id, nextRoles);
      } catch (error) {
        console.error('[SettingsPage] Unable to update user roles', error);
        const message = error instanceof Error ? error.message : 'Не удалось изменить права пользователя';
        window.alert(message);
      } finally {
        setUpdatingRoleId(null);
      }
    },
    [canManageUsers, updateUserRoles]
  );

  const handleCreateUser = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canManageUsers) {
        return;
      }
      setCreateError(null);

      const email = form.email.trim().toLowerCase();
      const fullName = form.fullName.trim();
      if (!email) {
        setCreateError('Укажите email пользователя');
        return;
      }

      let password = form.password.trim();
      if (passwordMode === 'generated') {
        password = generateSecurePassword();
      }

      if (!password) {
        setCreateError('Введите пароль или включите автоматическую генерацию');
        return;
      }

      if (password.length < 8) {
        setCreateError('Пароль должен содержать не менее 8 символов');
        return;
      }

      if (workspaceMode === 'existing' && !selectedWorkspaceId) {
        setCreateError('Выберите рабочее пространство');
        return;
      }

      setCreating(true);
      try {
        const created = await registerUser({
          email,
          password,
          fullName: fullName || null,
          role: form.role,
          workspace: workspaceMode === 'new'
            ? {
                mode: 'new',
                workspaceId: null,
                name: workspaceName || fullName || email,
                kind: 'tenant',
                parentId: null,
              }
            : {
                mode: 'existing',
                workspaceId: selectedWorkspaceId,
                name: undefined,
                kind: 'tenant',
                parentId: null,
              },
        });
        usersLoadedRef.current = true;
        setLastCredentials({ email: created.email, password });
        setCopyFeedback(null);
        setForm((prev) => ({
          email: '',
          fullName: '',
          role: prev.role,
          password: '',
        }));
        if (workspaceMode === 'new') {
          setWorkspaceName('');
        } else {
          setSelectedWorkspaceId(null);
        }
        if (passwordMode === 'manual') {
          setPasswordMode('manual');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не удалось создать пользователя';
        setCreateError(message);
      } finally {
        setCreating(false);
      }
    },
    [form, canManageUsers, passwordMode, registerUser, workspaceMode, workspaceName, selectedWorkspaceId]
  );

  const handleCreateWorkspaceUser = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canManageWorkspace || !currentWorkspace?.id) {
        return;
      }
      setLocalCreateError(null);

      const email = localForm.email.trim().toLowerCase();
      const fullName = localForm.fullName.trim();
      if (!email) {
        setLocalCreateError('Укажите email пользователя');
        return;
      }

      let password = localForm.password.trim();
      if (localPasswordMode === 'generated') {
        password = generateSecurePassword();
      }

      if (!password) {
        setLocalCreateError('Введите пароль или включите автоматическую генерацию');
        return;
      }

      if (password.length < 8) {
        setLocalCreateError('Пароль должен содержать не менее 8 символов');
        return;
      }

      setLocalCreating(true);
      try {
        const result = await createWorkspaceUser({
          email,
          fullName: fullName || null,
          role: localForm.role,
          password: localPasswordMode === 'manual' ? password : undefined,
          generatePassword: localPasswordMode === 'generated',
          workspaceId: currentWorkspace.id,
        });
        setLocalCredentials({ email, password: result.password });
        setLocalCopyFeedback(null);
        setLocalForm((prev) => ({ ...prev, email: '', fullName: '', password: '' }));
        if (localPasswordMode === 'manual') {
          setLocalPasswordMode('manual');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не удалось создать пользователя';
        setLocalCreateError(message);
      } finally {
        setLocalCreating(false);
      }
    },
    [canManageWorkspace, createWorkspaceUser, currentWorkspace?.id, localForm, localPasswordMode]
  );

  return (
    <TooltipProvider>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-gray-900 mb-1">Настройки</h1>
          <p className="text-gray-600">
            Управление интеграциями, уведомлениями и общими настройками системы
          </p>
        </div>

        <div className="space-y-6 max-w-4xl">
          {isSuperAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UsersIcon className="w-5 h-5" />
                  Пользователи и доступ
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <p className="text-sm text-muted-foreground md:max-w-md">
                    Каждый доступ открывает отдельный личный кабинет и рабочее пространство. Выдавайте их только тем командам, которым нужен самостоятельный контур и Jira-подключение.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => handleReloadUsers().catch(() => {/* noop */})}
                      disabled={usersLoading}
                    >
                      <RefreshCw className={`h-4 w-4 ${usersLoading ? 'animate-spin' : ''}`} />
                      Обновить
                    </Button>
                  </div>
                </div>

                {usersError ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {usersError}
                  </div>
                ) : null}

                {lastCredentials ? (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-blue-900">Новый пользователь создан</div>
                        <div className="mt-2 space-y-1 text-sm text-blue-800">
                          <div>
                            Email:{' '}
                            <code className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium">
                              {lastCredentials.email}
                            </code>
                          </div>
                          <div>
                            Пароль:{' '}
                            <code className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium">
                              {lastCredentials.password}
                            </code>
                          </div>
                        </div>
                        {copyFeedback ? (
                          <div className="mt-2 text-xs text-blue-700">{copyFeedback}</div>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" className="gap-1" onClick={handleCopyCredentials}>
                          <ClipboardCopy className="h-4 w-4" />
                          Скопировать
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setLastCredentials(null)}>
                          Скрыть
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor="workspace-mode">Тип доступа</Label>
                        <Select value={workspaceMode} onValueChange={(value) => setWorkspaceMode(value as 'new' | 'existing')}>
                          <SelectTrigger id="workspace-mode" className="mt-2 border-muted-foreground/40 bg-input-background">
                            <SelectValue placeholder="Создать новое пространство" />
                          </SelectTrigger>
                          <SelectContent className="bg-card">
                            <SelectItem value="new">Создать новое рабочее пространство</SelectItem>
                            <SelectItem value="existing">Подключить к существующему</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Новый кабинет будет полностью изолирован от других клиентов.
                        </p>
                      </div>
                      {workspaceMode === 'new' ? (
                        <div>
                          <Label htmlFor="workspace-name">Название личного кабинета</Label>
                          <Input
                            id="workspace-name"
                            type="text"
                            placeholder="ООО Ромашка"
                            className="mt-2"
                            value={workspaceName}
                            onChange={(event) => setWorkspaceName(event.target.value)}
                          />
                          <p className="mt-2 text-xs text-muted-foreground">Покажем владельцу кабинета на главной странице.</p>
                        </div>
                      ) : (
                        <div>
                          <Label htmlFor="workspace-existing">Рабочее пространство</Label>
                          <Select
                            value={selectedWorkspaceId ?? ''}
                            onValueChange={(value) => setSelectedWorkspaceId(value || null)}
                            disabled={workspaceCatalogLoading || allWorkspaces.length === 0}
                          >
                            <SelectTrigger id="workspace-existing" className="mt-2 border-muted-foreground/40 bg-input-background">
                              <SelectValue placeholder={workspaceCatalogLoading ? 'Загрузка...' : 'Выберите пространство'} />
                            </SelectTrigger>
                            <SelectContent className="bg-card max-h-64">
                              {allWorkspaces.map((workspace) => (
                                <SelectItem key={workspace.id} value={workspace.id}>
                                  {workspace.name} · {workspace.key}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {workspaceCatalogError ? (
                            <p className="mt-2 text-xs text-destructive">{workspaceCatalogError}</p>
                          ) : null}
                          {!workspaceCatalogError && !workspaceCatalogLoading && allWorkspaces.length === 0 ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Нет доступных пространств. Создайте новое.
                            </p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {usersLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Загрузка списка пользователей…
                  </div>
                ) : null}

                <div className="space-y-3">
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="min-w-full text-sm">
                      <thead className="bg-muted/40 text-left text-sm text-muted-foreground border-b border-border">
                        <tr>
                          <th className="px-3 py-3 font-medium">Пользователь</th>
                          <th className="px-3 py-3 font-medium">Роль</th>
                          <th className="px-3 py-3 font-medium">Статус</th>
                          <th className="px-3 py-3 text-right font-medium">Доступ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleUsers.map((account) => {
                          const orderedRoles = ROLE_DISPLAY_ORDER.filter((role) => account.roles.includes(role));
                          const displayRoles = orderedRoles.length > 0 ? orderedRoles : [account.role];
                          const canEditRoles = account.roles.some((role) => MUTABLE_ROLES.includes(role));
                          const isUpdatingRoles = updatingRoleId === account.id;
                          return (
                            <tr key={account.id} className="bg-card">
                              <td className="px-3 py-2">
                                <div className="font-medium text-foreground">{account.fullName || account.email}</div>
                                <div className="text-xs text-muted-foreground">{account.email}</div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-start gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    {displayRoles.map((role) => (
                                      <Badge key={`${account.id}-${role}`} variant={ROLE_BADGE_VARIANT[role]}>
                                        {ROLE_LABELS[role]}
                                      </Badge>
                                    ))}
                                  </div>
                                  {canEditRoles ? (
                                    <div className="flex-shrink-0 self-start">
                                      <DropdownMenu>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <DropdownMenuTrigger asChild>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 w-7 p-0"
                                                disabled={isUpdatingRoles}
                                                aria-label="Добавить права"
                                              >
                                                <Plus className="h-4 w-4" />
                                              </Button>
                                            </DropdownMenuTrigger>
                                          </TooltipTrigger>
                                          <TooltipContent sideOffset={6}>Добавить права</TooltipContent>
                                        </Tooltip>
                                        <DropdownMenuContent align="start" className="w-56">
                                          {MUTABLE_ROLES.map((roleOption) => (
                                            <DropdownMenuCheckboxItem
                                              key={roleOption}
                                              checked={account.roles.includes(roleOption)}
                                              onCheckedChange={(checked) =>
                                                handleToggleUserRole(account, roleOption, checked === true)
                                              }
                                              disabled={isUpdatingRoles}
                                            >
                                              {ROLE_LABELS[roleOption]}
                                            </DropdownMenuCheckboxItem>
                                          ))}
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                            <td className="px-3 py-2">
                              <Badge variant={account.isActive ? 'default' : 'secondary'}>
                                {account.isActive ? 'Активен' : 'Выключен'}
                              </Badge>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1"
                                  disabled={resettingUserId === account.id}
                                  onClick={() => handleResetPassword(account)}
                                >
                                  {resettingUserId === account.id ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <RefreshCw className="h-4 w-4" />
                                  )}
                                  Сбросить
                                </Button>
                                {canManageUsers ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-destructive"
                                      disabled={deletingUserId === account.id}
                                      onClick={() => handleDeleteUser(account)}
                                      title="Удалить доступ"
                                    >
                                      {deletingUserId === account.id ? (
                                        <Trash2 className="h-4 w-4 animate-pulse" />
                                      ) : (
                                        <Trash2 className="h-4 w-4" />
                                      )}
                                  </Button>
                                ) : null}
                              </div>
                            </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {visibleUsers.length === 0 && !usersLoading ? (
                    <div className="rounded-md border border-dashed border-muted-foreground/30 px-4 py-6 text-center text-sm text-muted-foreground">
                      Пока нет зарегистрированных пользователей
                    </div>
                  ) : null}
                </div>

                <Separator />

                {canManageUsers ? (
                  <form className="space-y-4" onSubmit={handleCreateUser}>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor="user-email">Email</Label>
                        <Input
                          id="user-email"
                          type="email"
                          autoComplete="off"
                          required
                          placeholder="user@company.com"
                          className="mt-2"
                          value={form.email}
                          onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                        />
                      </div>
                      <div>
                        <Label htmlFor="user-full-name">Имя и фамилия</Label>
                        <Input
                          id="user-full-name"
                          type="text"
                          placeholder="Иван Иванов"
                          className="mt-2"
                          value={form.fullName}
                          onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
                        />
                      </div>
                      <div>
                        <Label htmlFor="user-role">Роль</Label>
                        <Select
                          value={form.role}
                          onValueChange={(nextRole) => {
                            const roleValue = nextRole as UserRole;
                            setForm((prev) => ({
                              ...prev,
                              role: CREATION_ROLES.includes(roleValue) ? roleValue : prev.role,
                            }));
                          }}
                        >
                          <SelectTrigger id="user-role" className="mt-2 border-muted-foreground/40 bg-input-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-card">
                            {CREATION_ROLES.map((roleOption) => (
                              <SelectItem key={roleOption} value={roleOption}>
                                {ROLE_LABELS[roleOption]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="rounded-md border border-muted-foreground/20 bg-muted/30 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">Сгенерировать пароль автоматически</div>
                            <div className="text-xs text-muted-foreground">Пароль покажем один раз после создания.</div>
                          </div>
                          <Switch checked={passwordMode === 'generated'} onCheckedChange={handlePasswordModeChange} />
                        </div>
                        {passwordMode === 'manual' ? (
                          <div className="mt-3">
                            <Label htmlFor="user-password" className="text-xs text-muted-foreground">
                              Пароль (минимум 8 символов)
                            </Label>
                            <Input
                              id="user-password"
                              type="text"
                              autoComplete="new-password"
                              className="mt-2"
                              value={form.password}
                              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {createError ? <div className="text-sm text-destructive">{createError}</div> : null}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Button type="submit" className="gap-2" disabled={creating}>
                        <UserPlus className="h-4 w-4" />
                        Создать пользователя
                      </Button>
                      <div className="text-xs text-muted-foreground">
                        Убедитесь, что передали пароль пользователю безопасным способом.
                      </div>
                    </div>
                  </form>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {!isSuperAdmin && canManageWorkspace ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UsersIcon className="w-5 h-5" />
                  Участники вашего пространства
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <p className="text-sm text-muted-foreground md:max-w-md">
                    Добавляйте бухгалтеров, менеджеров и исполнителей только в текущий контур. Эти пользователи не увидят другие рабочие пространства.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => handleReloadWorkspaceMembers().catch(() => {/* noop */})}
                      disabled={workspaceMembersLoading}
                    >
                      <RefreshCw className={`h-4 w-4 ${workspaceMembersLoading ? 'animate-spin' : ''}`} />
                      Обновить
                    </Button>
                  </div>
                </div>

                {workspaceMembersError ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {workspaceMembersError}
                  </div>
                ) : null}

                {localCredentials ? (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-blue-900">Новый пользователь создан</div>
                        <div className="mt-2 space-y-1 text-sm text-blue-800">
                          <div>
                            Email:{' '}
                            <code className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium">
                              {localCredentials.email}
                            </code>
                          </div>
                          <div>
                            Пароль:{' '}
                            <code className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium">
                              {localCredentials.password}
                            </code>
                          </div>
                        </div>
                        {localCopyFeedback ? (
                          <div className="mt-2 text-xs text-blue-700">{localCopyFeedback}</div>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" className="gap-1" onClick={handleCopyLocalCredentials}>
                          <ClipboardCopy className="h-4 w-4" />
                          Скопировать
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setLocalCredentials(null)}>
                          Скрыть
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-3">
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="min-w-full text-sm">
                      <thead className="bg-muted/40 text-left text-sm text-muted-foreground border-b border-border">
                        <tr>
                          <th className="px-3 py-3 font-medium">Пользователь</th>
                          <th className="px-3 py-3 font-medium">Роль</th>
                          <th className="px-3 py-3 font-medium">Статус</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workspaceMembers.map((member) => (
                          <tr key={member.userId} className="bg-card">
                            <td className="px-3 py-2">
                              <div className="font-medium text-foreground">{member.fullName || member.email}</div>
                              <div className="text-xs text-muted-foreground">{member.email}</div>
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant={ROLE_BADGE_VARIANT[member.role] ?? 'outline'}>
                                {ROLE_LABELS[member.role] ?? member.role}
                              </Badge>
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant={member.isActive ? 'default' : 'secondary'}>
                                {member.isActive ? 'Активен' : 'Выключен'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {workspaceMembers.length === 0 && !workspaceMembersLoading ? (
                    <div className="rounded-md border border-dashed border-muted-foreground/30 px-4 py-6 text-center text-sm text-muted-foreground">
                      Пока нет участников пространства
                    </div>
                  ) : null}
                </div>

                <Separator />

                <form className="space-y-4" onSubmit={handleCreateWorkspaceUser}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="local-user-email">Email</Label>
                      <Input
                        id="local-user-email"
                        type="email"
                        autoComplete="off"
                        required
                        placeholder="team@company.com"
                        className="mt-2"
                        value={localForm.email}
                        onChange={(event) => setLocalForm((prev) => ({ ...prev, email: event.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="local-user-full-name">Имя и фамилия</Label>
                      <Input
                        id="local-user-full-name"
                        type="text"
                        placeholder="Иван Иванов"
                        className="mt-2"
                        value={localForm.fullName}
                        onChange={(event) => setLocalForm((prev) => ({ ...prev, fullName: event.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="local-user-role">Роль</Label>
                      <Select
                        value={localForm.role}
                        onValueChange={(nextRole) => {
                          const roleValue = nextRole as UserRole;
                          setLocalForm((prev) => ({
                            ...prev,
                            role: WORKSPACE_CREATABLE_ROLES.includes(roleValue) ? roleValue : prev.role,
                          }));
                        }}
                      >
                        <SelectTrigger id="local-user-role" className="mt-2 border-muted-foreground/40 bg-input-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-card">
                          {WORKSPACE_CREATABLE_ROLES.map((roleOption) => (
                            <SelectItem key={roleOption} value={roleOption}>
                              {ROLE_LABELS[roleOption]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="rounded-md border border-muted-foreground/20 bg-muted/30 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">Сгенерировать пароль автоматически</div>
                          <div className="text-xs text-muted-foreground">Пароль покажем один раз после создания.</div>
                        </div>
                        <Switch checked={localPasswordMode === 'generated'} onCheckedChange={handleLocalPasswordModeChange} />
                      </div>
                      {localPasswordMode === 'manual' ? (
                        <div className="mt-3">
                          <Label htmlFor="local-user-password" className="text-xs text-muted-foreground">
                            Пароль (минимум 8 символов)
                          </Label>
                          <Input
                            id="local-user-password"
                            type="text"
                            autoComplete="new-password"
                            className="mt-2"
                            value={localForm.password}
                            onChange={(event) => setLocalForm((prev) => ({ ...prev, password: event.target.value }))}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {localCreateError ? <div className="text-sm text-destructive">{localCreateError}</div> : null}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button type="submit" className="gap-2" disabled={localCreating}>
                      <UserPlus className="h-4 w-4" />
                      Добавить пользователя
                    </Button>
                    <div className="text-xs text-muted-foreground">
                      Аккаунт автоматически будет привязан к текущему рабочему пространству.
                    </div>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {!isSuperAdmin && !canManageWorkspace ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UsersIcon className="w-5 h-5" />
                  Пользователи и доступ
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Управление доступами выполняет оператор платформы. Каждый новый пользователь получает отдельный личный кабинет и своё рабочее пространство.
                </p>
                <p>
                  Если вашей команде нужен новый доступ, напишите на&nbsp;
                  <a className="font-medium text-primary underline-offset-2 hover:underline" href={`mailto:${SUPER_ADMIN_EMAIL}`}>
                    {SUPER_ADMIN_EMAIL}
                  </a>{' '}
                  или свяжитесь с администратором платформы.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* Интеграции */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link className="w-5 h-5" />
                Интеграции
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Jira</div>
                  <div className="text-sm text-muted-foreground">
                    Подключена: yourcompany.atlassian.net
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="bg-green-100 text-green-800">
                    Активна
                  </Badge>
                  <Button variant="outline" size="sm">
                    Настроить
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">OpenAI API</div>
                    <div className="text-sm text-muted-foreground">
                      Для генерации документов с помощью AI
                    </div>
                  </div>
                  <Badge variant={localStorage.getItem('OPENAI_API_KEY') ? 'default' : 'secondary'} className={localStorage.getItem('OPENAI_API_KEY') ? 'bg-green-100 text-green-800' : ''}>
                    {localStorage.getItem('OPENAI_API_KEY') ? 'Настроен' : 'Не настроен'}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="openai-key">API ключ OpenAI</Label>
                  <Input
                    id="openai-key"
                    type="password"
                    placeholder="sk-proj-..."
                    defaultValue={localStorage.getItem('OPENAI_API_KEY') || ''}
                    onChange={(e) => {
                      if (e.target.value.trim()) {
                        localStorage.setItem('OPENAI_API_KEY', e.target.value.trim());
                      } else {
                        localStorage.removeItem('OPENAI_API_KEY');
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    ⚠️ ВАЖНО: В продакшене API ключ должен храниться на сервере, не в браузере!
                  </p>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">1С</div>
                  <div className="text-sm text-muted-foreground">
                    Для экспорта данных
                  </div>
                </div>
                <Button variant="outline" size="sm">
                  Подключить
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Уведомления */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Уведомления
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Email уведомления</div>
                  <div className="text-sm text-muted-foreground">
                    Получать уведомления о завершении импорта и генерации документов
                  </div>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Уведомления о новых задачах</div>
                  <div className="text-sm text-muted-foreground">
                    Уведомлять при появлении новых задач в Jira
                  </div>
                </div>
                <Switch />
              </div>

              <Separator />

              <div>
                <Label>Email для уведомлений</Label>
                <Input
                  type="email"
                  placeholder="your-email@company.com"
                  className="mt-2"
                  defaultValue="user@company.com"
                />
              </div>
            </CardContent>
          </Card>

          {/* Безопасность */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Безопасность и конфиденциальность
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <h4 className="font-medium mb-2">Защита данных</h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• Все данные хранятся в зашифрованном виде</li>
                  <li>• API токены не передаются третьим лицам</li>
                  <li>• Только чтение данных из Jira</li>
                  <li>• Регулярное резервное копирование</li>
                </ul>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Двухфакторная аутентификация</div>
                  <div className="text-sm text-muted-foreground">
                    Дополнительная защита вашего аккаунта
                  </div>
                </div>
                <Button variant="outline" size="sm">
                  Настроить
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Автоматический выход</div>
                  <div className="text-sm text-muted-foreground">
                    Выходить из системы после 8 часов неактивности
                  </div>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>

          {/* Экспорт и удаление */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="w-5 h-5" />
                Данные
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Экспорт всех данных</div>
                  <div className="text-sm text-muted-foreground">
                    Скачать архив с задачами, контрактами и документами
                  </div>
                </div>
                <Button variant="outline" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Экспорт
                </Button>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-red-600">Удалить аккаунт</div>
                  <div className="text-sm text-muted-foreground">
                    Безвозвратно удалить все данные и настройки
                  </div>
                </div>
                <Button variant="destructive" size="sm">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Удалить
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Справка */}
          <Card>
            <CardHeader>
              <CardTitle>Справка и поддержка</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Button variant="outline" className="justify-start">
                  Документация
                </Button>
                <Button variant="outline" className="justify-start">
                  Связаться с поддержкой
                </Button>
                <Button variant="outline" className="justify-start">
                  Сообщить об ошибке
                </Button>
                <Button variant="outline" className="justify-start">
                  Запросить функцию
                </Button>
              </div>

              <div className="text-center text-sm text-muted-foreground mt-6">
                Версия: 1.2.3 • Последнее обновление: 20 сентября 2025
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  );
}
