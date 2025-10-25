import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { 
  Link2, 
  Settings, 
  CheckCircle2, 
  FileText,
  Building2,
  ClipboardList,
  FileCheck,
  ArrowRight,
  Shield,
  Info
} from 'lucide-react';
import { motion } from 'motion/react';

const steps = [
  {
    id: 1,
    icon: Link2,
    title: 'Подключение Jira',
    subtitle: 'Импорт проектов, задач и временных меток',
    description: 'Авторизация → выбор проекта → импорт данных',
    color: 'blue',
    bgGradient: 'from-blue-50 to-blue-100',
    iconBg: 'bg-blue-500',
    borderColor: 'border-blue-200',
  },
  {
    id: 2,
    icon: Building2,
    title: 'Справочники',
    subtitle: 'Настройка реквизитов ЮЛ, ФЛ и контрактов',
    description: 'ИНН/КПП, подписанты, основания, ставки',
    color: 'purple',
    bgGradient: 'from-purple-50 to-purple-100',
    iconBg: 'bg-purple-500',
    borderColor: 'border-purple-200',
  },
  {
    id: 3,
    icon: ClipboardList,
    title: 'Проверка задач',
    subtitle: 'Фильтрация биллинговых задач и временных меток',
    description: 'Статусы, периоды, исключения',
    color: 'green',
    bgGradient: 'from-green-50 to-green-100',
    iconBg: 'bg-green-500',
    borderColor: 'border-green-200',
  },
  {
    id: 4,
    icon: FileCheck,
    title: 'Генерация документов',
    subtitle: 'Создание актов, счетов и отчётов',
    description: 'PDF/DOCX/Excel форматы, расчёт ставок',
    color: 'orange',
    bgGradient: 'from-orange-50 to-orange-100',
    iconBg: 'bg-orange-500',
    borderColor: 'border-orange-200',
  },
];

interface WelcomePageProps {
  onJiraConnect?: () => void;
  onOpenSettings?: () => void;
}

export function WelcomePage({ onJiraConnect, onOpenSettings }: WelcomePageProps) {
  return (
    <div className="min-h-full bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30">
      <div className="max-w-7xl mx-auto px-8 py-12">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-full mb-6">
            <Info className="w-4 h-4" />
            <span className="text-sm font-medium">Добро пожаловать в систему</span>
          </div>
          
          <h1 className="text-gray-900 mb-3">
            Начнём с подключения Jira
          </h1>
          <p className="text-gray-600 max-w-2xl mx-auto mb-8">
            Подключите ваш Jira-проект для импорта задач и учёта времени
          </p>

          <div className="flex items-center justify-center gap-4 mb-6">
            <Button 
              size="lg" 
              className="gap-2 shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/30 transition-all"
              onClick={onJiraConnect}
            >
              <Link2 className="w-5 h-5" />
              Подключить Jira
            </Button>
            <Button 
              variant="outline" 
              size="lg" 
              className="gap-2"
              onClick={onOpenSettings}
            >
              <Settings className="w-5 h-5" />
              Открыть настройки
            </Button>
          </div>

          <div className="flex items-center justify-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2 inline-flex">
            <Shield className="w-4 h-4" />
            <span>Чтение из Jira — без изменений данных</span>
          </div>
        </motion.div>

        {/* Step-by-Step Instructions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mb-12"
        >
          <Card className="border-2 border-blue-200 bg-gradient-to-r from-blue-50/50 to-purple-50/50">
            <CardContent className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                  <Info className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-gray-900 mb-1">Как начать работу</h2>
                  <p className="text-gray-600">Следуйте этим шагам для успешного запуска системы</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="relative pl-8">
                  <div className="absolute left-0 top-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">
                    1
                  </div>
                  <h4 className="text-gray-900 mb-1">Подключите Jira</h4>
                  <p className="text-sm text-gray-600 mb-2">
                    Авторизация через OAuth → выбор проекта → импорт данных
                  </p>
                  <Badge variant="outline" className="text-xs">
                    Импорт задач и времени
                  </Badge>
                </div>

                <div className="relative pl-8">
                  <div className="absolute left-0 top-0 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-sm font-medium">
                    2
                  </div>
                  <h4 className="text-gray-900 mb-1">Заполните справочники</h4>
                  <p className="text-sm text-gray-600 mb-2">
                    Создайте карточки ЮЛ, ФЛ и контракты с реквизитами
                  </p>
                  <Badge variant="outline" className="text-xs">
                    ИНН, ставки, подписанты
                  </Badge>
                </div>

                <div className="relative pl-8">
                  <div className="absolute left-0 top-0 w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-medium">
                    3
                  </div>
                  <h4 className="text-gray-900 mb-1">Проверьте задачи</h4>
                  <p className="text-sm text-gray-600 mb-2">
                    Настройте фильтры по статусам, периодам и исключениям
                  </p>
                  <Badge variant="outline" className="text-xs">
                    Биллингуемые задачи
                  </Badge>
                </div>

                <div className="relative pl-8">
                  <div className="absolute left-0 top-0 w-6 h-6 bg-orange-600 text-white rounded-full flex items-center justify-center text-sm font-medium">
                    4
                  </div>
                  <h4 className="text-gray-900 mb-1">Сформируйте документы</h4>
                  <p className="text-sm text-gray-600 mb-2">
                    Выберите тип, формат, ставку и создайте акт или отчёт
                  </p>
                  <Badge variant="outline" className="text-xs">
                    PDF/DOCX/Excel
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Steps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {steps.map((step, index) => {
            const Icon = step.icon;
            
            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 + index * 0.1 }}
                className="h-full"
              >
                <Card 
                  className={`relative overflow-hidden border-2 ${step.borderColor} hover:shadow-xl transition-all duration-300 group cursor-pointer h-full`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${step.bgGradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                  
                  <CardContent className="p-6 relative">
                    <div className="flex items-start gap-4">
                      <div className={`flex-shrink-0 w-12 h-12 ${step.iconBg} rounded-xl flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="text-gray-900 mb-1 group-hover:text-blue-700 transition-colors">
                              {step.title}
                            </h3>
                            <p className="text-sm text-gray-600 mb-2">
                              {step.subtitle}
                            </p>
                          </div>
                          <div className="flex-shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <ArrowRight className="w-5 h-5 text-gray-400" />
                          </div>
                        </div>
                        
                        <p className="text-sm text-gray-500 leading-relaxed">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Empty State */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          <Card className="border-2 border-dashed border-gray-300 bg-white/50 backdrop-blur-sm">
            <CardContent className="p-8 text-center">
              <div className="max-w-md mx-auto">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8 text-blue-600" />
                </div>
                
                <h3 className="text-gray-900 mb-2">
                  Пустое состояние
                </h3>
                <p className="text-gray-600 mb-6">
                  Для начала работы подключите Jira-проект или настройте справочники.
                </p>

                <div className="flex items-center justify-center gap-3">
                  <Button 
                    className="gap-2"
                    onClick={onJiraConnect}
                  >
                    <Link2 className="w-4 h-4" />
                    Подключить Jira
                  </Button>
                  <Button 
                    variant="outline" 
                    className="gap-2"
                    onClick={onOpenSettings}
                  >
                    <Settings className="w-4 h-4" />
                    Открыть настройки
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Features List */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="mt-12"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-5 h-5 text-blue-600" />
              </div>
              <h4 className="text-gray-900 mb-1">Автоматизация</h4>
              <p className="text-sm text-gray-600">
                Импорт данных из Jira в один клик
              </p>
            </div>

            <div className="text-center">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                <Shield className="w-5 h-5 text-purple-600" />
              </div>
              <h4 className="text-gray-900 mb-1">Безопасность</h4>
              <p className="text-sm text-gray-600">
                Только чтение, без изменения ваших данных
              </p>
            </div>

            <div className="text-center">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                <FileCheck className="w-5 h-5 text-green-600" />
              </div>
              <h4 className="text-gray-900 mb-1">Документы</h4>
              <p className="text-sm text-gray-600">
                Генерация актов и отчётов автоматически
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
