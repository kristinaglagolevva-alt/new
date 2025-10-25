import { createContext, useContext, useState, type ReactNode } from 'react';

interface WorkspaceContextType {
  currentWorkspace: { id: string; name: string; parentId?: string | null } | null;
  workspaceId: string | null;
  setCurrentWorkspace: (workspace: { id: string; name: string; parentId?: string | null } | null) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [currentWorkspace, setCurrentWorkspace] = useState<{ id: string; name: string; parentId?: string | null }>({
    id: 'workspace-default',
    name: 'Актех (основной)',
    parentId: null,
  });

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
