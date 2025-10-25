import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { ContourHierarchy } from './ContourHierarchy';
import {
  Building2,
  Users,
  FileText,
  Plus,
  Mail,
  Phone,
  Edit2,
  Trash2,
  UserPlus,
  CheckCircle2,
  Clock,
  Settings,
  ChevronRight,
  Download,
  Info
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Alert, AlertDescription } from './ui/alert';

// Типы данных
interface LegalEntity {
  id: string;
  name: string;
  inn: string;
  kpp?: string;
  type: 'contractor' | 'subcontractor' | 'client';
  status: 'active' | 'invited' | 'inactive';
  email: string;
  phone: string;
  parentId?: string;
  createdAt: string;
  projectsCount: number;
  tasksCount: number;
  hourlyRate?: number;
}

interface Employee {
  id: string;
  fullName: string;
  email: string;
  role: 'admin' | 'manager' | 'executor';
  legalEntityId: string;
  status: 'active' | 'invited';
  createdAt: string;
}

interface Contract {
  id: string;
  number: string;
  clientId: string;
  contractorId: string;
  startDate: string;
  endDate?: string;
  status: 'active' | 'draft' | 'completed';
  hourlyRate: number;
  vatIncluded: boolean;
}

interface ContractorManagementProps {
  currentProject: string;
  projects: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
  }>;
}

export function ContractorManagement({ currentProject, projects }: ContractorManagementProps) {
  const [activeTab, setActiveTab] = useState('legal');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<'legal' | 'employee' | 'contract'>('legal');
  
  const selectedProject = projects.find(p => p.id === currentProject);
  const isB2C = selectedProject?.type === 'b2c';

  // Демо-данные - подрядчики для разных проектов
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([
    // B2B проект "Создать лендинг"
    {
      id: '2',
      name: 'ООО ВебСтудия',
      inn: '7701234589',
      kpp: '770101002',
      type: 'contractor',
      status: 'active',
      email: 'info@webstudio.ru',
      phone: '+7 (495) 234-56-78',
      parentId: 'landing',
      createdAt: '2024-02-10',
      projectsCount: 3,
      tasksCount: 156,
      hourlyRate: 3500
    },
    {
      id: '4',
      name: 'ИП Иванов Дизайнер',
      inn: '123456789012',
      type: 'contractor',
      status: 'invited',
      email: 'ivanov@mail.ru',
      phone: '+7 (999) 123-45-67',
      parentId: 'landing',
      createdAt: '2024-10-12',
      projectsCount: 0,
      tasksCount: 0,
      hourlyRate: 2500
    },
    // B2B проект "Мобильное приложение"
    {
      id: '5',
      name: 'ООО МобДев',
      inn: '7701234590',
      kpp: '770101003',
      type: 'contractor',
      status: 'active',
      email: 'info@mobdev.ru',
      phone: '+7 (495) 345-67-89',
      parentId: 'mobile-app',
      createdAt: '2024-03-05',
      projectsCount: 2,
      tasksCount: 89,
      hourlyRate: 4000
    },
    // B2B проект "Интеграция CRM"
    {
      id: '6',
      name: 'ООО Интеграция Плюс',
      inn: '7701234591',
      kpp: '770101004',
      type: 'contractor',
      status: 'active',
      email: 'info@integration.ru',
      phone: '+7 (495) 456-78-90',
      parentId: 'crm-integration',
      createdAt: '2024-04-01',
      projectsCount: 1,
      tasksCount: 67,
      hourlyRate: 3800
    }
  ]);
  
  // Фильтруем подрядчиков для текущего проекта
  const projectContractors = legalEntities.filter(e => e.parentId === currentProject);

  const [employees, setEmployees] = useState<Employee[]>([
    // Сотрудники основного контура (B2C)
    {
      id: '1',
      fullName: 'Николай Путин',
      email: 'np@mail.ru',
      role: 'admin',
      legalEntityId: 'main',
      status: 'active',
      createdAt: '2024-01-15'
    },
    {
      id: '2',
      fullName: 'Зинаида Гаврюшева',
      email: 'zg@mail.ru',
      role: 'manager',
      legalEntityId: 'main',
      status: 'active',
      createdAt: '2024-01-20'
    },
    {
      id: '3',
      fullName: 'Петров Пётр Петрович',
      email: 'ppp@mail.ru',
      role: 'executor',
      legalEntityId: 'main',
      status: 'active',
      createdAt: '2024-02-15'
    },
    {
      id: '4',
      fullName: 'Кристина Глаголева Сергеевна',
      email: 'kgs@mail.ru',
      role: 'executor',
      legalEntityId: 'main',
      status: 'active',
      createdAt: '2024-02-20'
    },
    {
      id: '5',
      fullName: 'Андронов Николай Дмитриевич',
      email: 'and1770888@mail.ru',
      role: 'manager',
      legalEntityId: 'main',
      status: 'invited',
      createdAt: '2024-10-10'
    }
  ]);
  
  // Фильтруем сотрудников для текущего проекта (только для B2C)
  const projectEmployees = employees.filter(e => e.legalEntityId === currentProject);

  const [contracts, setContracts] = useState<Contract[]>([
    {
      id: '1',
      number: 'ДГП-001/2024',
      clientId: 'landing',
      contractorId: '2',
      startDate: '2024-02',
      status: 'active',
      hourlyRate: 3500,
      vatIncluded: true
    },
    {
      id: '2',
      number: 'ДГП-002/2024',
      clientId: 'landing',
      contractorId: '4',
      startDate: '2024-10',
      status: 'draft',
      hourlyRate: 2500,
      vatIncluded: false
    },
    {
      id: '3',
      number: 'ДГП-003/2024',
      clientId: 'mobile-app',
      contractorId: '5',
      startDate: '2024-03',
      status: 'active',
      hourlyRate: 4000,
      vatIncluded: true
    }
  ]);
  
  // Фильтруем контракты для текущего проекта
  const projectContracts = contracts.filter(c => c.clientId === currentProject);

  // Форма добавления
  const [formData, setFormData] = useState({
    name: '',
    inn: '',
    kpp: '',
    type: 'contractor',
    email: '',
    phone: '',
    hourlyRate: '',
    fullName: '',
    role: 'executor',
    contractNumber: '',
    clientId: '',
    contractorId: '',
    startDate: '',
    vatIncluded: true
  });

  const openAddDialog = (type: 'legal' | 'employee' | 'contract') => {
    setDialogType(type);
    setIsAddDialogOpen(true);
    setFormData({
      name: '',
      inn: '',
      kpp: '',
      type: 'contractor',
      email: '',
      phone: '',
      hourlyRate: '',
      fullName: '',
      role: 'executor',
      contractNumber: '',
      clientId: '',
      contractorId: '',
      startDate: '',
      vatIncluded: true
    });
  };

  const handleAddEntity = () => {
    if (dialogType === 'legal' && formData.name && formData.inn && formData.email) {
      const newEntity: LegalEntity = {
        id: Date.now().toString(),
        name: formData.name,
        inn: formData.inn,
        kpp: formData.kpp,
        type: formData.type as 'contractor' | 'subcontractor',
        status: 'invited',
        email: formData.email,
        phone: formData.phone,
        parentId: '1', // Current contour
        createdAt: new Date().toISOString().split('T')[0],
        projectsCount: 0,
        tasksCount: 0,
        hourlyRate: formData.hourlyRate ? Number(formData.hourlyRate) : undefined,
        parentId: currentProject // Привязываем к текущему проекту
      };
      setLegalEntities([...legalEntities, newEntity]);
      setIsAddDialogOpen(false);
    } else if (dialogType === 'employee' && formData.fullName && formData.email) {
      const newEmployee: Employee = {
        id: Date.now().toString(),
        fullName: formData.fullName,
        email: formData.email,
        role: formData.role as 'admin' | 'manager' | 'executor',
        legalEntityId: currentProject, // Привязываем к текущему проекту
        status: 'invited',
        createdAt: new Date().toISOString().split('T')[0]
      };
      setEmployees([...employees, newEmployee]);
      setIsAddDialogOpen(false);
    } else if (dialogType === 'contract' && formData.contractNumber && formData.clientId && formData.contractorId) {
      const newContract: Contract = {
        id: Date.now().toString(),
        number: formData.contractNumber,
        clientId: formData.clientId,
        contractorId: formData.contractorId,
        startDate: formData.startDate,
        status: 'draft',
        hourlyRate: Number(formData.hourlyRate) || 0,
        vatIncluded: formData.vatIncluded
      };
      setContracts([...contracts, newContract]);
      setIsAddDialogOpen(false);
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      admin: 'Администратор',
      manager: 'Менеджер',
      executor: 'Исполнитель'
    };
    return labels[role] || role;
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      client: 'Заказчик',
      contractor: 'Подрядчик',
      subcontractor: 'Субподрядчик'
    };
    return labels[type] || type;
  };

  const getStatusBadge = (status: string) => {
    if (status === 'active') {
      return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Активен</Badge>;
    } else if (status === 'invited') {
      return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Приглашён</Badge>;
    } else {
      return <Badge variant="secondary">Неактивен</Badge>;
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl text-gray-900 mb-2">Справочник</h1>
          <p className="text-gray-600">
            {isB2C 
              ? 'Управление исполнителями и прямыми сотрудниками (B2C профиль)'
              : 'Управление подрядчиками в рамках проекта (B2B контур)'}
          </p>
        </div>

        {/* Info Alert */}
        <Alert className="mb-6 bg-blue-50 border-blue-200">
          <AlertDescription className="text-blue-900">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="block mb-1">
                  Текущий проект: <strong>{selectedProject?.name}</strong>
                </span>
                <span className="text-sm text-blue-700">
                  {isB2C 
                    ? 'В B2C профиле вы работаете напрямую с исполнителями и формируете с ними документы.'
                    : 'В B2B контуре вы добавляете подрядчиков, которые будут видеть только свои данные. Подрядчики могут добавлять субподрядчиков, но вы будете видеть только агрегированную статистику.'}
                </span>
              </div>
            </div>
          </AlertDescription>
        </Alert>

        {/* Hierarchy Visualization */}
        <div className="mb-6">
          <ContourHierarchy />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 max-w-2xl">
            <TabsTrigger value="legal" className="gap-2">
              <Building2 className="w-4 h-4" />
              {isB2C ? 'Исполнители' : 'Подрядчики'}
              <Badge variant="secondary" className="ml-1">{isB2C ? 0 : projectContractors.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="employees" className="gap-2">
              <Users className="w-4 h-4" />
              {isB2C ? 'Сотрудники' : 'Доступы'}
              <Badge variant="secondary" className="ml-1">{isB2C ? projectEmployees.length : 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="contracts" className="gap-2">
              <FileText className="w-4 h-4" />
              Договоры
              <Badge variant="secondary" className="ml-1">{isB2C ? 0 : projectContracts.length}</Badge>
            </TabsTrigger>
          </TabsList>

          {/* Подрядчики / Исполнители */}
          <TabsContent value="legal" className="space-y-4">
            {isB2C ? (
              <div className="text-center py-12 text-gray-500">
                <Building2 className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg mb-2">B2C профиль</p>
                <p className="text-sm">В этом контуре вы работаете напрямую с исполнителями</p>
                <p className="text-sm">через вкладку "Сотрудники"</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-gray-600">
                    Подрядчики видят только свой контур. Вы видите только агрегированную статистику.
                  </p>
                  <Button onClick={() => openAddDialog('legal')} className="gap-2">
                    <Plus className="w-4 h-4" />
                    Добавить подрядчика
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {projectContractors.map((entity) => (
                <Card key={entity.id} className={entity.status === 'invited' ? 'border-yellow-200' : ''}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4 flex-1">
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Building2 className="w-6 h-6 text-blue-600" />
                        </div>
                        
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-lg text-gray-900">{entity.name}</h3>
                            {getStatusBadge(entity.status)}
                            <Badge variant="outline">{getTypeLabel(entity.type)}</Badge>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                            <div className="flex items-center gap-2 text-gray-600">
                              <span className="text-gray-500">ИНН:</span>
                              <span>{entity.inn}</span>
                            </div>
                            {entity.kpp && (
                              <div className="flex items-center gap-2 text-gray-600">
                                <span className="text-gray-500">КПП:</span>
                                <span>{entity.kpp}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-2 text-gray-600">
                              <Mail className="w-4 h-4 text-gray-400" />
                              <span>{entity.email}</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-600">
                              <Phone className="w-4 h-4 text-gray-400" />
                              <span>{entity.phone}</span>
                            </div>
                            {entity.hourlyRate && (
                              <div className="flex items-center gap-2 text-gray-600">
                                <span className="text-gray-500">Ставка:</span>
                                <span>{entity.hourlyRate} ₽/час</span>
                              </div>
                            )}
                            <div className="flex items-center gap-2 text-gray-600">
                              <span className="text-gray-500">Проектов:</span>
                              <span>{entity.projectsCount}</span>
                            </div>
                          </div>

                          {entity.status === 'invited' && (
                            <div className="mt-3 flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 px-3 py-2 rounded-lg">
                              <Clock className="w-4 h-4" />
                              Ожидает активации. Приглашение отправлено на {entity.email}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm">
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
                </div>
              </>
            )}
          </TabsContent>

          {/* Сотрудники / Доступы */}
          <TabsContent value="employees" className="space-y-4">
            {isB2C ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-gray-600">
                    Создайте профили для администраторов, менеджеров и исполнителей
                  </p>
                  <Button onClick={() => openAddDialog('employee')} className="gap-2">
                    <UserPlus className="w-4 h-4" />
                    Добавить сотрудника
                  </Button>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Users className="w-5 h-5 text-gray-400" />
                      {selectedProject?.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {projectEmployees.map((employee) => (
                        <div
                          key={employee.id}
                          className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                              <Users className="w-5 h-5 text-gray-600" />
                            </div>
                            <div>
                              <div className="flex items-center gap-3 mb-1">
                                <span className="text-gray-900">{employee.fullName}</span>
                                {getStatusBadge(employee.status)}
                              </div>
                              <div className="flex items-center gap-4 text-sm text-gray-600">
                                <span className="flex items-center gap-1">
                                  <Mail className="w-3 h-3" />
                                  {employee.email}
                                </span>
                                <Badge variant="secondary" className="text-xs">
                                  {getRoleLabel(employee.role)}
                                </Badge>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm">
                              <Settings className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm">
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <Users className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg mb-2">B2B контур</p>
                <p className="text-sm">В этом контуре доступами управляют подрядчики</p>
                <p className="text-sm">в своих изолированных контурах</p>
              </div>
            )}
          </TabsContent>

          {/* Договоры */}
          <TabsContent value="contracts" className="space-y-4">
            {isB2C ? (
              <div className="text-center py-12 text-gray-500">
                <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg mb-2">B2C профиль</p>
                <p className="text-sm">В этом контуре документы формируются напрямую</p>
                <p className="text-sm">с исполнителями через модуль "Документы"</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-gray-600">
                    Управление контрактами с подрядчиками в рамках проекта
                  </p>
                  <Button onClick={() => openAddDialog('contract')} className="gap-2">
                    <Plus className="w-4 h-4" />
                    Добавить контракт
                  </Button>
                </div>

                <div className="space-y-3">
                  {projectContracts.map((contract) => {
                    const contractor = legalEntities.find(e => e.id === contract.contractorId);

                    return (
                      <Card key={contract.id}>
                        <CardContent className="p-6">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-3">
                                <h3 className="text-lg text-gray-900">Договор {contract.number}</h3>
                                {getStatusBadge(contract.status)}
                              </div>

                              <div className="flex items-center gap-4 mb-4">
                                <div className="flex items-center gap-2">
                                  <div className="px-3 py-1 bg-blue-50 rounded text-sm text-blue-900">
                                    {selectedProject?.name}
                                  </div>
                                  <ChevronRight className="w-4 h-4 text-gray-400" />
                                  <div className="px-3 py-1 bg-green-50 rounded text-sm text-green-900">
                                    {contractor?.name}
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-4 gap-4 text-sm">
                                <div>
                                  <span className="text-gray-500 block mb-1">Проект</span>
                                  <span className="text-gray-900">{selectedProject?.name}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500 block mb-1">Подрядчик</span>
                                  <span className="text-gray-900">{contractor?.name}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500 block mb-1">Ставка</span>
                                  <span className="text-gray-900">{contract.hourlyRate} ₽/час</span>
                                </div>
                                <div>
                                  <span className="text-gray-500 block mb-1">Период</span>
                                  <span className="text-gray-900">{contract.startDate}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm" className="gap-1">
                                <Download className="w-4 h-4" />
                                Скачать
                              </Button>
                              <Button variant="ghost" size="sm">
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Dialog для добавления */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {dialogType === 'legal' && (isB2C ? 'Добавить исполнителя' : 'Добавить подрядчика')}
                {dialogType === 'employee' && (isB2C ? 'Добавить сотрудника' : 'Выдать доступ')}
                {dialogType === 'contract' && 'Добавить контракт'}
              </DialogTitle>
              <DialogDescription>
                {dialogType === 'legal' && (isB2C ? 'Введите данные исполнителя для прямой работы' : 'Введите данные подрядчика для B2B контура')}
                {dialogType === 'employee' && (isB2C ? 'Добавьте сотрудника в ваш контур' : 'Выдайте доступ пользователю в рамках проекта')}
                {dialogType === 'contract' && 'Создайте контракт с подрядчиком в рамках проекта'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              {dialogType === 'legal' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="type">Тип доступа</Label>
                      <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="contractor">Подрядчик</SelectItem>
                          <SelectItem value="subcontractor">Субподрядчик</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="hourlyRate">Часовая ставка (₽)</Label>
                      <Input
                        id="hourlyRate"
                        type="number"
                        placeholder="3000"
                        value={formData.hourlyRate}
                        onChange={(e) => setFormData({ ...formData, hourlyRate: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="name">Название организации</Label>
                    <Input
                      id="name"
                      placeholder="ООО Пример"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="inn">ИНН</Label>
                      <Input
                        id="inn"
                        placeholder="7701234567"
                        value={formData.inn}
                        onChange={(e) => setFormData({ ...formData, inn: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="kpp">КПП (опционально)</Label>
                      <Input
                        id="kpp"
                        placeholder="770101001"
                        value={formData.kpp}
                        onChange={(e) => setFormData({ ...formData, kpp: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="info@example.ru"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                    <p className="text-xs text-gray-500 mt-1">На этот адрес будет отправлено приглашение</p>
                  </div>

                  <div>
                    <Label htmlFor="phone">Телефон</Label>
                    <Input
                      id="phone"
                      placeholder="+7 (999) 123-45-67"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>

                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertDescription className="text-sm text-blue-900">
                      {isB2C 
                        ? 'После создания исполнитель получит доступ к вашему контуру и сможет выполнять задачи.'
                        : 'После создания подрядчик получит письмо с приглашением. Он получит доступ к своему изолированному контуру в рамках этого проекта и сможет добавлять субподрядчиков.'}
                    </AlertDescription>
                  </Alert>
                </>
              )}

              {dialogType === 'employee' && (
                <>
                  <div>
                    <Label htmlFor="fullName">ФИО</Label>
                    <Input
                      id="fullName"
                      placeholder="Иванов Иван Иванович"
                      value={formData.fullName}
                      onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    />
                  </div>

                  <div>
                    <Label htmlFor="employee-email">Email</Label>
                    <Input
                      id="employee-email"
                      type="email"
                      placeholder="user@company.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>

                  <div>
                    <Label htmlFor="role">Роль</Label>
                    <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Администратор</SelectItem>
                        <SelectItem value="manager">Менеджер</SelectItem>
                        <SelectItem value="executor">Исполнитель</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertDescription className="text-sm text-blue-900">
                      Пользователь получит приглашение на указанный email с инструкциями по активации.
                    </AlertDescription>
                  </Alert>
                </>
              )}

              {dialogType === 'contract' && (
                <>
                  <div>
                    <Label htmlFor="contractNumber">Номер договора</Label>
                    <Input
                      id="contractNumber"
                      placeholder="ООО-123"
                      value={formData.contractNumber}
                      onChange={(e) => setFormData({ ...formData, contractNumber: e.target.value })}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="clientId">Заказчик</Label>
                      <Select value={formData.clientId} onValueChange={(value) => setFormData({ ...formData, clientId: value })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите заказчика" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={currentProject}>{selectedProject?.name}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="contractorId">Подрядчик</Label>
                      <Select value={formData.contractorId} onValueChange={(value) => setFormData({ ...formData, contractorId: value })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите подрядчика" />
                        </SelectTrigger>
                        <SelectContent>
                          {projectContractors.map(entity => (
                            <SelectItem key={entity.id} value={entity.id}>{entity.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="contract-hourlyRate">Часовая ставка (₽)</Label>
                      <Input
                        id="contract-hourlyRate"
                        type="number"
                        placeholder="3000"
                        value={formData.hourlyRate}
                        onChange={(e) => setFormData({ ...formData, hourlyRate: e.target.value })}
                      />
                    </div>

                    <div>
                      <Label htmlFor="startDate">Дата начала</Label>
                      <Input
                        id="startDate"
                        type="month"
                        value={formData.startDate}
                        onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                      />
                    </div>
                  </div>
                </>
              )}

              <Button onClick={handleAddEntity} className="w-full">
                {dialogType === 'legal' && (isB2C ? 'Добавить исполнителя' : 'Добавить подрядчика')}
                {dialogType === 'employee' && (isB2C ? 'Добавить сотрудника' : 'Выдать доступ')}
                {dialogType === 'contract' && 'Создать контракт'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
