import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { motion } from 'motion/react';
import { FolderOpen, ListTodo, Users, Clock, RefreshCw } from 'lucide-react';

interface SummaryData {
  totalProjects: number;
  connectedProjects: number;
  totalTasks: number;
  billableTasks: number;
  uniquePerformers: number;
  totalHours: number;
  lastSyncLabel: string | null;
  lastSyncRelative?: string | null;
}

interface StatisticsCardsProps {
  summary: SummaryData;
  isLoading?: boolean;
}

export function StatisticsCards({ summary, isLoading = false }: StatisticsCardsProps) {
  const numberFormatter = useMemo(() => new Intl.NumberFormat('ru-RU'), []);

  const cards = useMemo(
    () => [
      {
        title: 'Проекты',
        value: numberFormatter.format(summary.connectedProjects),
        description:
          summary.totalProjects > 0
            ? `${summary.connectedProjects} из ${summary.totalProjects} подключено`
            : 'Нет подключений',
        subtitle: 'Подключённые / всего',
        badge: summary.totalProjects > 0 ? `${summary.connectedProjects}/${summary.totalProjects}` : '—',
        icon: FolderOpen,
        iconBg: 'bg-blue-500',
        badgeColor: 'bg-blue-100 text-blue-700',
      },
      {
        title: 'Задачи',
        value:
          summary.totalTasks > 0
            ? `${numberFormatter.format(summary.billableTasks)} / ${numberFormatter.format(summary.totalTasks)}`
            : '0',
        description: 'Биллингуемые / всего',
        subtitle: summary.totalTasks > 0 ? 'По импортированным задачам' : 'Импорт пока не выполнен',
        badge: summary.totalTasks > 0 ? `${Math.round((summary.billableTasks / summary.totalTasks) * 100)}%` : '0%',
        icon: ListTodo,
        iconBg: 'bg-green-500',
        badgeColor: 'bg-green-100 text-green-700',
      },
      {
        title: 'Исполнители',
        value: numberFormatter.format(summary.uniquePerformers),
        description: 'Уникальные исполнители',
        subtitle: summary.uniquePerformers > 0 ? 'По активности в задачах' : 'Нет назначенных исполнителей',
        badge: summary.uniquePerformers > 0 ? 'Активно' : '—',
        icon: Users,
        iconBg: 'bg-purple-500',
        badgeColor: 'bg-purple-100 text-purple-700',
      },
      {
        title: 'Отработанные часы',
        value: numberFormatter.format(Math.round(summary.totalHours * 10) / 10),
        description: 'Совокупно по задачам',
        subtitle: summary.totalHours > 0 ? 'Включая биллингуемые' : 'Часы ещё не импортированы',
        badge: summary.totalHours > 0 ? 'Обновлено' : '—',
        icon: Clock,
        iconBg: 'bg-orange-500',
        badgeColor: 'bg-orange-100 text-orange-700',
      },
      {
        title: 'Импорт обновлён',
        value: summary.lastSyncLabel ?? '—',
        description: 'последняя синхронизация',
        subtitle: summary.lastSyncRelative ?? 'Данные не синхронизированы',
        badge: summary.lastSyncLabel ? 'Актуально' : 'Требует запуска',
        icon: RefreshCw,
        iconBg: summary.lastSyncLabel ? 'bg-teal-500' : 'bg-yellow-500',
        badgeColor: summary.lastSyncLabel ? 'bg-teal-100 text-teal-700' : 'bg-yellow-100 text-yellow-700',
      },
    ],
    [numberFormatter, summary],
  );

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {cards.map((card) => (
          <Card key={card.title} className="relative overflow-hidden border-l-4 border-l-transparent">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="p-2 rounded-lg bg-muted/40 w-9 h-9 animate-pulse" />
                <div className="h-4 w-20 rounded bg-muted/40 animate-pulse" />
              </div>
              <div className="h-3 w-24 rounded bg-muted/30 animate-pulse mt-2" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                <div className="h-6 w-24 rounded bg-muted/40 animate-pulse" />
                <div className="h-3 w-32 rounded bg-muted/30 animate-pulse" />
                <div className="h-3 w-20 rounded bg-muted/20 animate-pulse" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Card className="relative overflow-hidden border-l-4 border-l-transparent hover:border-l-primary/20 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className={`p-2 rounded-lg text-white ${card.iconBg}`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <Badge variant="secondary" className={`${card.badgeColor} text-xs`}>
                    {card.badge}
                  </Badge>
                </div>
                <CardTitle className="text-sm text-muted-foreground font-normal">{card.title}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-1">
                  <div className="text-2xl font-semibold tracking-tight">{card.value}</div>
                  <p className="text-xs text-muted-foreground">{card.description}</p>
                  <p className="text-xs text-muted-foreground">{card.subtitle}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
