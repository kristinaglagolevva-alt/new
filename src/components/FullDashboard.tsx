import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
  Legend
} from 'recharts';
import {
  BarChart3,
  BookOpen,
  Settings,
  FileText,
  FolderOpen,
  ListTodo,
  Briefcase,
  LayoutTemplate,
  Users,
  Clock,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  ExternalLink,
  Database
} from 'lucide-react';

// Mock data
const statsData = [
  {
    title: 'Проекты',
    value: '3',
    description: 'проекта',
    subtitle: 'Подключено и синхронизировано',
    icon: FolderOpen,
    color: 'bg-blue-500',
    bgColor: 'bg-blue-50',
    iconColor: 'text-blue-600',
    badgeColor: 'bg-blue-100 text-blue-700'
  },
  {
    title: 'Задачи',
    value: '286 / 172',
    description: 'Всего / биллингуемых',
    subtitle: 'За выбранный период',
    icon: ListTodo,
    color: 'bg-green-500',
    bgColor: 'bg-green-50',
    iconColor: 'text-green-600',
    badgeColor: 'bg-green-100 text-green-700'
  },
  {
    title: 'Исполнители',
    value: '14',
    description: 'уникальных',
    subtitle: 'По задачам в работе',
    icon: Users,
    color: 'bg-purple-500',
    bgColor: 'bg-purple-50',
    iconColor: 'text-purple-600',
    badgeColor: 'bg-purple-100 text-purple-700'
  },
  {
    title: 'Отработанные часы',
    value: '1 246',
    description: 'часов',
    subtitle: 'За выбранный период',
    icon: Clock,
    color: 'bg-orange-500',
    bgColor: 'bg-orange-50',
    iconColor: 'text-orange-600',
    badgeColor: 'bg-orange-100 text-orange-700'
  },
  {
    title: 'Импорт обновлён',
    value: '3 окт 10:32',
    description: 'последняя синхронизация',
    subtitle: 'Автоматическое обновление',
    icon: RefreshCw,
    color: 'bg-teal-500',
    bgColor: 'bg-teal-50',
    iconColor: 'text-teal-600',
    badgeColor: 'bg-teal-100 text-teal-700'
  }
];

const projectTimeData = [
  { name: 'Frontend React', value: 45, hours: 561, color: '#3b82f6' },
  { name: 'Backend API', value: 30, hours: 374, color: '#10b981' },
  { name: 'DevOps', value: 15, hours: 187, color: '#f59e0b' },
  { name: 'QA Testing', value: 10, hours: 124, color: '#ef4444' }
];

const weeklyActivityData = [
  { week: 'Нед 1', hours: 180 },
  { week: 'Нед 2', hours: 220 },
  { week: 'Нед 3', hours: 195 },
  { week: 'Нед 4', hours: 250 },
  { week: 'Нед 5', hours: 285 },
  { week: 'Нед 6', hours: 310 },
  { week: 'Нед 7', hours: 246 }
];

const topPerformersData = [
  { name: 'Николаев П.', hours: 115 },
  { name: 'Козлова О.', hours: 128 },
  { name: 'Сидоров К.', hours: 142 },
  { name: 'Петрова М.', hours: 156 },
  { name: 'Иванов А.', hours: 168 }
];

const taskStatusData = [
  { name: 'Done', value: 60, count: 172, color: '#3b82f6' },
  { name: 'In Progress', value: 25, count: 71, color: '#10b981' },
  { name: 'To Do', value: 15, count: 43, color: '#f59e0b' }
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border rounded-lg shadow-lg border-gray-200">
        <p className="font-medium text-gray-900">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} style={{ color: entry.color }} className="text-sm">
            {entry.name}: {entry.value}
            {entry.payload.hours && ` (${entry.payload.hours} ч)`}
            {entry.payload.count && ` (${entry.payload.count} задач)`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// Sidebar Component
function Sidebar({ currentPage, onPageChange }: { currentPage: string; onPageChange: (page: string) => void }) {
  const menuItems = [
    { id: 'management', label: 'Управление', icon: BarChart3, active: true },
    { id: 'directory', label: 'Справочник', icon: BookOpen },
    { id: 'projects', label: 'Проекты трекеров', icon: FolderOpen },
    { id: 'project-settings', label: 'Настройка проектов', icon: Briefcase },
    { id: 'templates', label: 'Шаблоны', icon: LayoutTemplate },
    { id: 'tasks', label: 'Задачи', icon: ListTodo },
    { id: 'documents', label: 'Документы', icon: FileText },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
            <span className="text-white font-semibold text-sm">A</span>
          </div>
          <span className="font-semibold text-gray-900">Aktex</span>
        </div>

        <nav className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            
            return (
              <button
                key={item.id}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200 ${
                  isActive 
                    ? 'bg-gray-100 text-gray-900 font-medium' 
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
                onClick={() => onPageChange(item.id)}
              >
                <Icon className="w-5 h-5" />
                <span className="flex-1">{item.label}</span>
                {item.active && (
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-6">
        <div className="text-sm text-gray-600 space-y-1">
          <div className="font-medium text-gray-900">admin@example.com</div>
          <div>Администратор</div>
        </div>
        
        <button className="w-full text-left text-sm text-gray-600 hover:text-gray-900 mt-4 transition-colors">
          Выйти
        </button>
        
        <div className="mt-4 text-xs text-gray-500 space-y-1">
          <div className="font-medium">ЛОГИКА ВРЕМЕНИ</div>
          <div>https://jira-</div>
          <div>f.front-worker.app/tracker-users</div>
        </div>
      </div>
    </div>
  );
}

// Statistics Card Component
function StatCard({ stat, index }: { stat: any; index: number }) {
  const [isHovered, setIsHovered] = useState(false);
  const Icon = stat.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
      whileHover={{ scale: 1.02, y: -2 }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      className="relative"
    >
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-all duration-300">
        <div className="flex items-center justify-between mb-4">
          <div className={`p-3 rounded-lg ${stat.bgColor}`}>
            <Icon className={`w-6 h-6 ${stat.iconColor}`} />
          </div>
          <div className={`px-2 py-1 rounded-full text-xs font-medium ${stat.badgeColor}`}>
            Активно
          </div>
        </div>
        
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-600">{stat.title}</h3>
          <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
          <p className="text-xs text-gray-500">{stat.description}</p>
          <p className="text-xs text-gray-500">{stat.subtitle}</p>
        </div>

        <motion.div
          className="absolute inset-0 rounded-xl border-2 border-transparent"
          animate={isHovered ? { borderColor: stat.iconColor.replace('text-', '#').replace('600', '') } : {}}
          transition={{ duration: 0.2 }}
        />
      </div>
    </motion.div>
  );
}

// Chart Component
function ChartCard({ title, children, delay = 0 }: { title: string; children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.5 }}
      className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow duration-300"
    >
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      {children}
    </motion.div>
  );
}

// Next Steps Component
function NextSteps() {
  const [progress, setProgress] = useState(0);
  
  const steps = [
    {
      title: 'Все проекты имеют контракты',
      status: 'completed',
      description: 'Настроены реквизиты и связи',
      action: 'Перейти к задачам'
    },
    {
      title: '3 проекта без реквизитов',
      status: 'warning',
      description: 'Требуется заполнение ИНН/КПП',
      action: 'Открыть справочник'
    },
    {
      title: 'Документы ещё не сформированы',
      status: 'pending',
      description: 'Готовы к генерации актов',
      action: 'Сформировать пакет'
    }
  ];

  useEffect(() => {
    const completed = steps.filter(step => step.status === 'completed').length;
    const targetProgress = (completed / steps.length) * 100;
    
    const timer = setTimeout(() => {
      setProgress(targetProgress);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.2, duration: 0.6 }}
      className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600" />
          Что дальше
        </h3>
        <div className="px-3 py-1 bg-gray-100 rounded-full text-sm font-medium text-gray-700">
          1 из 3 выполнено
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
          <span>Прогресс настройки</span>
          <span className="font-medium">{Math.round(progress)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <motion.div
            className="bg-blue-600 h-2 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 1, delay: 1.5 }}
          />
        </div>
      </div>

      <div className="space-y-4">
        {steps.map((step, index) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.4 + index * 0.1, duration: 0.4 }}
            className="flex items-center justify-between p-4 rounded-lg border border-gray-200"
          >
            <div className="flex items-center gap-3">
              {step.status === 'completed' && <CheckCircle className="w-5 h-5 text-green-600" />}
              {step.status === 'warning' && <AlertCircle className="w-5 h-5 text-yellow-600" />}
              {step.status === 'pending' && <FileText className="w-5 h-5 text-blue-600" />}
              <div>
                <h4 className="font-medium text-gray-900">{step.title}</h4>
                <p className="text-sm text-gray-500">{step.description}</p>
              </div>
            </div>
            <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
              {step.action}
              <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// Main Dashboard Component
export function FullDashboard() {
  const [currentPage, setCurrentPage] = useState('management');
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 2000);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />
      
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          <div className="max-w-7xl mx-auto">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="flex items-center justify-between mb-8"
            >
              <div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Управление проектами</h1>
                <p className="text-gray-600">Общая статистика и аналитика по подключенным проектам</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-3 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  Синхронизировано
                </div>
                <button
                  onClick={handleRefresh}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                  Обновить
                </button>
              </div>
            </motion.div>

            {/* Statistics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
              {statsData.map((stat, index) => (
                <StatCard key={stat.title} stat={stat} index={index} />
              ))}
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <ChartCard title="Распределение времени по проектам" delay={0.6}>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={projectTimeData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {projectTimeData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Тренд активности по неделям" delay={0.7}>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={weeklyActivityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="week" stroke="#666" />
                    <YAxis stroke="#666" />
                    <Tooltip content={<CustomTooltip />} />
                    <Line 
                      type="monotone" 
                      dataKey="hours" 
                      stroke="#3b82f6" 
                      strokeWidth={3}
                      dot={{ fill: '#3b82f6', strokeWidth: 2, r: 6 }}
                      activeDot={{ r: 8, stroke: '#3b82f6', strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="ТОП-исполнители" delay={0.8}>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={topPerformersData} layout="horizontal">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" stroke="#666" />
                    <YAxis dataKey="name" type="category" width={80} stroke="#666" />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="hours" fill="#10b981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Статусы задач" delay={0.9}>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={taskStatusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {taskStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Next Steps */}
            <NextSteps />

            {/* Bottom Messages */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.8, duration: 0.6 }}
              className="mt-8 space-y-4"
            >
              <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <CheckCircle className="h-5 w-5 text-blue-600 flex-shrink-0" />
                <p className="text-blue-800">
                  Данные синхронизированы из Jira. Вы можете перейти к фильтрации задач и формированию актов.
                </p>
              </div>
              
              <div className="flex items-center gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0" />
                <p className="text-yellow-800">
                  Если видите лишние задачи — настройте статусы биллинга.
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
}
