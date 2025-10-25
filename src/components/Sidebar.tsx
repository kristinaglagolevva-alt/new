import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  BarChart3,
  BookOpen,
  Settings,
  FileText,
  FolderOpen,
  ListTodo,
  LayoutTemplate,
  Calculator,
} from 'lucide-react';
import { cn } from './ui/utils';
import { useAuth } from '../data/AuthContext';
import type { UserRole } from '../data/models';

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
  isJiraConnected: boolean;
}

export function Sidebar({ currentPage, onPageChange, isJiraConnected }: SidebarProps) {
  const { user, logout } = useAuth();
  const displayName = user?.fullName?.trim() || 'Профиль не заполнен';
  const displayEmail = user?.email ?? '—';

  const effectiveRoles = (() => {
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
  })();

  const hasAdminLikeAccess = effectiveRoles.has('admin') || effectiveRoles.has('accountant');
  const limitedToDocuments = Boolean(user) && !hasAdminLikeAccess;

  const baseMenuItems = [
    {
      id: 'management',
      label: 'Управление',
      icon: BarChart3,
      badge: isJiraConnected ? 'connected' : null
    },
    {
      id: 'directory',
      label: 'Справочник',
      icon: BookOpen
    },
    {
      id: 'projects',
      label: 'Проекты трекеров',
      icon: FolderOpen
    },
    {
      id: 'templates',
      label: 'Шаблоны',
      icon: LayoutTemplate
    },
    {
      id: 'estimation',
      label: 'Оценка проекта',
      icon: Calculator
    },
    {
      id: 'tasks',
      label: 'Задачи',
      icon: ListTodo
    },
    {
      id: 'documents',
      label: 'Документы',
      icon: FileText
    },
    {
      id: 'settings',
      label: 'Настройки',
      icon: Settings
    }
  ];

  const menuItems = (() => {
    if (limitedToDocuments) {
      return baseMenuItems.filter((item) => item.id === 'documents');
    }
    if (isJiraConnected) {
      return baseMenuItems;
    }
    return baseMenuItems.filter((item) => item.id === 'management' || item.id === 'settings');
  })();

  return (
    <div className="flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex-1 p-6">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <span className="text-primary-foreground font-semibold">A</span>
          </div>
          <span className="font-semibold">Aktex</span>
        </div>

        <nav className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            
            return (
              <Button
                key={item.id}
                variant={isActive ? 'secondary' : 'ghost'}
                className={cn(
                  'w-full justify-start gap-3 px-3 py-2',
                  isActive && 'bg-sidebar-accent text-sidebar-accent-foreground'
                )}
                onClick={() => onPageChange(item.id)}
              >
                <Icon className="w-4 h-4" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge === 'connected' && (
                  <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100">
                    •
                  </Badge>
                )}
              </Button>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-6 pt-0">
        <div className="border-t border-sidebar-border/60 pt-6">
          <div className="text-sm">
            <div className="text-gray-900 mb-1">{displayName}</div>
            <div className="text-xs text-muted-foreground">{displayEmail}</div>
          </div>
          
          <Button
            variant="ghost"
            className="mt-4 justify-start px-3 text-sm"
            onClick={logout}
          >
            Выйти
          </Button>
        </div>
      </div>
    </div>
  );
}
