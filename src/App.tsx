import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { ManagementDashboard } from './components/ManagementDashboard';
import { ProjectEstimation } from './components/ProjectEstimation';
import { DirectoryPage } from './components/DirectoryPage';
import { TrackerProjects } from './components/TrackerProjects';
import { TasksPage } from './components/TasksPage';
import { TemplatesPage } from './components/TemplatesPage';
import { DocumentsPage } from './components/DocumentsPage';
import { SettingsPage } from './components/SettingsPage';
import { WelcomePage } from './components/WelcomePage';
import { JiraConnectionDialog } from './components/jira-connection-dialog';
import { DatabaseProvider, useDatabase } from './data/DataContext';
import { AuthProvider, useAuth } from './data/AuthContext';
import { WorkspaceProvider } from './data/WorkspaceContext';
import { FolderOpen, Plus } from 'lucide-react';
import type { NavigationPage, DirectoryFocus } from './types/navigation';
import type { UserRole } from './data/models';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { Button } from './components/ui/button';
import './utils/setupOpenAI'; // Инициализация OpenAI helper
import { LoginPage } from './components/login-page';

// Main App Component
export default function App() {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <AppContent />
      </WorkspaceProvider>
    </AuthProvider>
  );
}

function AppContent() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 text-muted-foreground">
        Проверяем сессию...
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <DatabaseProvider>
      <AuthenticatedApp />
    </DatabaseProvider>
  );
}

function AuthenticatedApp() {
  const { user } = useAuth();
  const { trackerProjects, loadJiraProjects } = useDatabase();
  const [currentPage, setCurrentPage] = useState<NavigationPage>('management');
  const [currentProject, setCurrentProject] = useState('main');
  const [directoryFocus, setDirectoryFocus] = useState<DirectoryFocus | null>(null);
  const [isJiraDialogOpen, setIsJiraDialogOpen] = useState(false);
  const [isCheckingJiraConnection, setIsCheckingJiraConnection] = useState(true);

  const effectiveRoles = useMemo(() => {
    const roles = new Set<UserRole>();
    if (user?.role) {
      roles.add(user.role);
    }
    (user?.roles ?? []).forEach((role) => {
      if (role) {
        roles.add(role);
      }
    });
    return roles;
  }, [user?.role, user?.roles]);

  const hasAdminPrivileges = effectiveRoles.has('admin') || effectiveRoles.has('accountant');
  const limitedToDocuments = Boolean(user) && !hasAdminPrivileges;

  useEffect(() => {
    let cancelled = false;
    const ensureProjectsLoaded = async () => {
      try {
        await loadJiraProjects();
      } catch (error) {
        console.error('[App] Unable to load Jira projects:', error);
      } finally {
        if (!cancelled) {
          setIsCheckingJiraConnection(false);
        }
      }
    };
    ensureProjectsLoaded();
    return () => {
      cancelled = true;
    };
  }, [loadJiraProjects]);

  useEffect(() => {
    if (limitedToDocuments && currentPage !== 'documents') {
      setCurrentPage('documents');
    }
  }, [limitedToDocuments, currentPage]);

  const hasConnectedJira = useMemo(
    () => trackerProjects.some((project) => project.status !== 'discovered'),
    [trackerProjects]
  );

  const shouldShowWelcome = !limitedToDocuments && !isCheckingJiraConnection && !hasConnectedJira;

  useEffect(() => {
    if (limitedToDocuments) {
      return;
    }
    if (isCheckingJiraConnection) {
      return;
    }
    if (!hasConnectedJira && currentPage !== 'management' && currentPage !== 'settings') {
      setCurrentPage('management');
    }
  }, [currentPage, hasConnectedJira, isCheckingJiraConnection, limitedToDocuments]);

  // Проекты/контуры (в реальном приложении это будет из API)
  const projects = [
    { id: 'main', name: 'Актех (основной)', type: 'b2c', description: 'B2C профиль - работа с исполнителями' },
    { id: 'landing', name: 'Проект: Создать лендинг', type: 'b2b', description: 'B2B контур с подрядчиками' },
    { id: 'mobile-app', name: 'Проект: Мобильное приложение', type: 'b2b', description: 'B2B контур с подрядчиками' },
    { id: 'crm-integration', name: 'Проект: Интеграция CRM', type: 'b2b', description: 'B2B контур с подрядчиками' },
  ];

  const handlePageChange = useCallback(
    (page: NavigationPage) => {
      if (limitedToDocuments && page !== 'documents') {
        return;
      }
      setCurrentPage(page);
    },
    [limitedToDocuments],
  );

  const activePage: NavigationPage = limitedToDocuments ? 'documents' : currentPage;
  const selectedProject = projects.find((p) => p.id === currentProject);

  const renderPage = () => {
    switch (activePage) {
      case 'management':
        if (isCheckingJiraConnection) {
          return <JiraStatusLoader />;
        }
        if (shouldShowWelcome) {
          return (
            <WelcomePage
              onJiraConnect={() => setIsJiraDialogOpen(true)}
              onOpenSettings={() => handlePageChange('settings')}
            />
          );
        }
        return (
          <ManagementDashboard
            isJiraConnected={hasConnectedJira}
            onJiraConnect={() => setIsJiraDialogOpen(true)}
            onNavigate={handlePageChange}
            currentProjectId={currentProject}
            currentProjectType={selectedProject?.type}
          />
        );
      case 'estimation':
        return <ProjectEstimation />;
      case 'directory':
        return (
          <DirectoryPage
            focus={directoryFocus}
            onConsumeFocus={() => setDirectoryFocus(null)}
          />
        );
      case 'projects':
        return <TrackerProjects />;
      case 'templates':
        return <TemplatesPage />;
      case 'tasks':
        return (
          <TasksPage
            onNavigate={handlePageChange}
            onDirectoryFocusRequested={(focus) => {
              setDirectoryFocus(focus);
              handlePageChange('directory');
            }}
          />
        );
      case 'documents':
        return (
          <DocumentsPage
            onNavigate={handlePageChange}
            onDirectoryFocusRequested={(focus) => {
              setDirectoryFocus(focus);
              handlePageChange('directory');
            }}
          />
        );
      case 'settings':
        return <SettingsPage />;
      default:
        return null;
    }
  };

  const handleJiraConnectionComplete = useCallback(async () => {
    setIsJiraDialogOpen(false);
    handlePageChange('management');
    setIsCheckingJiraConnection(true);
    try {
      await loadJiraProjects();
    } catch (error) {
      console.error('[App] Unable to refresh Jira projects after connection:', error);
    } finally {
      setIsCheckingJiraConnection(false);
    }
  }, [handlePageChange, loadJiraProjects]);

  return (
    <>
      <div className="flex h-screen bg-gray-50">
        <Sidebar
          currentPage={activePage}
          onPageChange={handlePageChange}
          isJiraConnected={hasConnectedJira}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header with Project Switcher - only on Management page */}
          {activePage === 'management' && hasConnectedJira && !isCheckingJiraConnection && (
          <div className="bg-white border-b border-gray-200 px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <Select value={currentProject} onValueChange={setCurrentProject}>
                    <SelectTrigger className="w-[320px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          <div className="flex items-center gap-2">
                            <FolderOpen className="w-4 h-4 text-gray-400" />
                            <div>
                              <div>{project.name}</div>
                              <div className="text-xs text-gray-500">{project.description}</div>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  <Button variant="outline" size="sm" className="gap-1">
                    <Plus className="w-4 h-4" />
                    Новый проект
                  </Button>
                </div>

                <div className="text-sm text-gray-500">
                  {selectedProject?.type === 'b2c' && '• Прямая работа с исполнителями'}
                  {selectedProject?.type === 'b2b' && '• Контур с подрядчиками'}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="text-sm text-gray-600">
                  {user?.email ?? ''}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          {renderPage()}
        </main>
          </div>
      </div>

      <JiraConnectionDialog
        open={isJiraDialogOpen}
        onOpenChange={setIsJiraDialogOpen}
        onConnectionComplete={handleJiraConnectionComplete}
      />
    </>
  );
}

function JiraStatusLoader() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      Проверяем подключение Jira...
    </div>
  );
}
