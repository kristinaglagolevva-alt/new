import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';

interface WorkspaceContextType {
  currentWorkspace: { id: string; name: string; parentId?: string | null } | null;
  workspaceId: string | null;
  setCurrentWorkspace: (workspace: { id: string; name: string; parentId?: string | null } | null) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

const STORAGE_KEY = 'jira-dashboard.workspace-id';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [currentWorkspace, setCurrentWorkspaceState] = useState<{ id: string; name: string; parentId?: string | null } | null>(null);
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      setCurrentWorkspaceState(null);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
      }
      lastUserIdRef.current = null;
      return;
    }
    const available = Array.isArray(user.workspaces) ? user.workspaces : [];
    if (available.length === 0) {
      setCurrentWorkspaceState(null);
      lastUserIdRef.current = user.id;
      return;
    }

    const userChanged = lastUserIdRef.current !== user.id;
    lastUserIdRef.current = user.id;

    const hasCurrent = !userChanged && currentWorkspace && available.some((workspace) => workspace.id === currentWorkspace.id);
    const getStoredWorkspaceId = (): string | null => {
      if (typeof window === 'undefined') {
        return null;
      }
      try {
        return window.localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    };

    const storedPreference = userChanged ? null : getStoredWorkspaceId();

    if (hasCurrent) {
      if (storedPreference !== currentWorkspace?.id) {
        try {
          if (typeof window !== 'undefined' && currentWorkspace?.id) {
            window.localStorage.setItem(STORAGE_KEY, currentWorkspace.id);
          }
        } catch {
          /* ignore */
        }
      }
      return;
    }

    const resolved = available.find((workspace) => workspace.id === (storedPreference ?? '')) ?? available[0];
    setCurrentWorkspaceState({
      id: resolved.id,
      name: resolved.name,
      parentId: resolved.parentId ?? null,
    });
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, resolved.id);
      } catch {
        /* ignore */
      }
    }
  }, [user, currentWorkspace?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      if (currentWorkspace?.id) {
        window.localStorage.setItem(STORAGE_KEY, currentWorkspace.id);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore storage issues
    }
  }, [currentWorkspace?.id]);

  const setCurrentWorkspace = useCallback(
    (workspace: { id: string; name: string; parentId?: string | null } | null) => {
      setCurrentWorkspaceState((prev) => {
        if (!workspace) {
          return null;
        }
        if (prev && prev.id === workspace.id && prev.name === workspace.name && prev.parentId === workspace.parentId) {
          return prev;
        }
        return {
          id: workspace.id,
          name: workspace.name,
          parentId: workspace.parentId ?? null,
        };
      });
    },
    [],
  );

  return (
    <WorkspaceContext.Provider
      value={{
        currentWorkspace,
        workspaceId: currentWorkspace?.id ?? null,
        setCurrentWorkspace,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
