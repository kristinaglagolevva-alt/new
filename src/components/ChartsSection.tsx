import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface ChartsSectionProps {
  projectTime: Array<{ name: string; value: number; hours?: number; tasks?: number }>;
  weeklyActivity: Array<{ week: string; hours: number; tasks?: number }>;
  topPerformers: Array<{ name: string; value: number; hours?: number; tasks?: number }>;
  taskStatuses: Array<{ name: string; value: number; count?: number }>;
  isLoading?: boolean;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border rounded-lg shadow-lg text-sm">
        <p className="font-medium mb-1">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="flex items-center gap-2" style={{ color: entry.color }}>
            <span>{entry.name}:</span>
            <span>
              {entry.value}
              {entry.payload?.hours ? ` ч` : ''}
              {entry.payload?.count ? ` (${entry.payload.count} задач)` : ''}
            </span>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const ChartSkeleton = () => (
  <div className="flex h-[300px] items-center justify-center">
    <div className="h-24 w-24 rounded-full bg-muted/40 animate-pulse" />
  </div>
);

const EmptyChart = ({ message }: { message: string }) => (
  <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">{message}</div>
);

export function ChartsSection({
  projectTime,
  weeklyActivity,
  topPerformers,
  taskStatuses,
  isLoading = false,
}: ChartsSectionProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Распределение времени по проектам</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ChartSkeleton />
          ) : projectTime.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={projectTime}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  dataKey="value"
                >
                  {projectTime.map((entry, index) => (
                    <Cell key={`project-${entry.name}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="Недостаточно данных для расчёта распределения" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Активность по неделям</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ChartSkeleton />
          ) : weeklyActivity.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={weeklyActivity}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" />
                <YAxis />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="hours"
                  stroke="#3b82f6"
                  strokeWidth={3}
                  dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="Пока нет данных о динамике задач" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ТОП-исполнители</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ChartSkeleton />
          ) : topPerformers.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topPerformers} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={120} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="hours" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="Нет задач с назначенными исполнителями" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Статусы задач</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ChartSkeleton />
          ) : taskStatuses.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={taskStatuses}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {taskStatuses.map((entry, index) => (
                    <Cell key={`status-${entry.name}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="Задачи ещё не импортированы" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
