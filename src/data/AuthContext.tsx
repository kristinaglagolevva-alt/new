import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User, UserRole, WorkspaceSummary } from './models';

export type AuthUser = User;

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_STORAGE_KEY = 'jira-dashboard.auth';
const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  'http://localhost:8000';

type StoredSession = {
  user: AuthUser;
  token: string;
};

const ROLE_VALUES: UserRole[] = ['admin', 'accountant', 'manager', 'performer', 'viewer'];

const normalizeRole = (value: unknown): UserRole | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return ROLE_VALUES.includes(normalized as UserRole) ? (normalized as UserRole) : null;
};

const normalizeWorkspaces = (value: unknown): WorkspaceSummary[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is WorkspaceSummary => {
    return (
      item
      && typeof item === 'object'
      && typeof (item as WorkspaceSummary).id === 'string'
      && typeof (item as WorkspaceSummary).name === 'string'
      && typeof (item as WorkspaceSummary).key === 'string'
    );
  });
};

const normalizeRoles = (roles: unknown, primary: UserRole | null): UserRole[] => {
  const result: UserRole[] = [];
  if (primary && !result.includes(primary)) {
    result.push(primary);
  }
  if (Array.isArray(roles)) {
    for (const entry of roles) {
      const normalized = normalizeRole(entry);
      if (normalized && !result.includes(normalized)) {
        result.push(normalized);
      }
    }
  }
  return result;
};

const normalizeUser = (raw: Partial<AuthUser>): AuthUser => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Недействительные данные пользователя');
  }

  const role = normalizeRole(raw.role) ?? null;
  const roles = normalizeRoles(raw.roles, role);
  if (!raw.id || !raw.email) {
    throw new Error('Недостаточно данных пользователя');
  }

  return {
    id: raw.id,
    email: raw.email.toLowerCase(),
    fullName: raw.fullName?.trim() || raw.email,
    role: role ?? (roles[0] ?? 'viewer'),
    roles: roles.length > 0 ? roles : [role ?? 'viewer'],
    isActive: raw.isActive ?? true,
    workspaces: normalizeWorkspaces(raw.workspaces),
  };
};

const persistSession = (user: AuthUser, token: string) => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    const payload = JSON.stringify({ user, token } satisfies StoredSession);
    window.localStorage.setItem(SESSION_STORAGE_KEY, payload);
  } catch (error) {
    console.warn('[AuthContext] Failed to persist auth session:', error);
  }
};

const readPersistedSession = (): StoredSession | null => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed?.user || !parsed?.token) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return { user: normalizeUser(parsed.user), token: parsed.token };
  } catch (error) {
    console.warn('[AuthContext] Failed to restore auth session, clearing storage:', error);
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
};

const clearPersistedSession = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
};

const parseErrorMessage = async (response: Response): Promise<string> => {
  try {
    const data = (await response.clone().json()) as { detail?: unknown; message?: unknown };
    if (typeof data?.detail === 'string') {
      return data.detail;
    }
    if (typeof data?.message === 'string') {
      return data.message;
    }
  } catch {
    // Ignore JSON parse errors.
  }
  try {
    const text = await response.text();
    if (text.trim()) {
      return text.trim();
    }
  } catch {
    // Ignore body read errors.
  }
  return response.status === 401 ? 'Неверный email или пароль' : 'Не удалось выполнить запрос';
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const fetchCurrentUser = useCallback(async (accessToken: string) => {
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }

    const payload = (await response.json()) as Partial<AuthUser>;
    return normalizeUser(payload);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restoreSession = async () => {
      const restored = readPersistedSession();
      if (!restored) {
        setInitializing(false);
        return;
      }

      setToken(restored.token);
      try {
        const refreshedUser = await fetchCurrentUser(restored.token);
        if (cancelled) {
          return;
        }
        setUser(refreshedUser);
        persistSession(refreshedUser, restored.token);
      } catch (error) {
        console.warn('[AuthContext] Failed to refresh session:', error);
        if (!cancelled) {
          setUser(null);
          setToken(null);
          clearPersistedSession();
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    };

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, [fetchCurrentUser]);

  const login = useCallback(async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response));
      }

      const data = (await response.json()) as {
        accessToken?: string;
        tokenType?: string;
        user?: Partial<AuthUser>;
      };

      if (!data?.accessToken || !data?.user) {
        throw new Error('Сервер вернул некорректный ответ');
      }

      const normalizedUser = normalizeUser(data.user);
      setUser(normalizedUser);
      setToken(data.accessToken);
      persistSession(normalizedUser, data.accessToken);
    } catch (error) {
      clearPersistedSession();
      setUser(null);
      setToken(null);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Не удалось выполнить вход');
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    clearPersistedSession();
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      initializing,
      login,
      logout,
    }),
    [user, token, loading, initializing, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
