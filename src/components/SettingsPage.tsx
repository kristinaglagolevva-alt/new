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
import type { User, UserRole } from "../data/models";

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
  const { users, loadUsers, registerUser, resetUserPassword, deleteUser, updateUserRoles } = useDatabase();

  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [passwordMode, setPasswordMode] = useState<'generated' | 'manual'>('generated');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [lastCredentials, setLastCredentials] = useState<{ email: string; password: string } | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const usersLoadedRef = useRef(false);

  const [form, setForm] = useState<{ email: string; fullName: string; role: UserRole; password: string }>(
    () => ({
      email: '',
      fullName: '',
      role: 'manager',
      password: '',
    })
  );

  const isAdmin = user?.role === 'admin';
  const canViewUsers = user?.role === 'admin' || user?.role === 'accountant';

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
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
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

  const handleResetPassword = useCallback(
    async (account: User) => {
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
    [resetUserPassword]
  );

  const handleDeleteUser = useCallback(
    async (account: User) => {
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
    [deleteUser, lastCredentials]
  );

  const handleToggleUserRole = useCallback(
    async (account: User, role: UserRole, checked: boolean) => {
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
    [updateUserRoles]
  );

  const handleCreateUser = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!isAdmin) {
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

      setCreating(true);
      try {
        const created = await registerUser({
          email,
          password,
          fullName: fullName || null,
          role: form.role,
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
    [form, isAdmin, passwordMode, registerUser]
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
          {canViewUsers ? (
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
                    Создавайте аккаунты для администраторов, бухгалтеров, менеджеров и исполнителей.
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
                                {isAdmin ? (
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

                {isAdmin ? (
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
                ) : (
                  <div className="rounded-md border border-muted-foreground/30 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                    Создание новых пользователей доступно только администратору.
                  </div>
                )}
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
