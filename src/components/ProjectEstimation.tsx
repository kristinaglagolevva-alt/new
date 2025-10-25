import { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { 
  Plus, 
  Trash2, 
  Calculator, 
  FileText, 
  Download, 
  Edit2,
  ChevronDown,
  ChevronUp,
  Copy,
  Info
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Label } from './ui/label';
import { Alert, AlertDescription } from './ui/alert';

// Типы данных
interface FunctionPoint {
  id: string;
  name: string;
  description: string;
  complexity: 'low' | 'medium' | 'high';
}

interface Category {
  id: string;
  name: string;
  code: string;
  description: string;
  items: FunctionPoint[];
  weights: { low: number; medium: number; high: number };
}

interface ProjectEstimate {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  categories: Category[];
}

// Веса функциональных точек по стандарту IFPUG
const categoryTemplates: Omit<Category, 'items'>[] = [
  {
    id: 'ei',
    name: 'Входы (EI)',
    code: 'EI',
    description: 'External Inputs - Пользователь что-то загружает или меняет',
    weights: { low: 3, medium: 4, high: 6 }
  },
  {
    id: 'eo',
    name: 'Выходы (EO)',
    code: 'EO',
    description: 'External Outputs - Система что-то считает и выдаёт',
    weights: { low: 4, medium: 5, high: 7 }
  },
  {
    id: 'eq',
    name: 'Запросы (EQ)',
    code: 'EQ',
    description: 'External Queries - Пользователь просто смотрит/фильтрует',
    weights: { low: 3, medium: 4, high: 6 }
  },
  {
    id: 'ilf',
    name: 'Внутренние данные (ILF)',
    code: 'ILF',
    description: 'Internal Logical Files - Хранит свои таблицы и справочники',
    weights: { low: 7, medium: 10, high: 15 }
  },
  {
    id: 'eif',
    name: 'Внешние источники (EIF)',
    code: 'EIF',
    description: 'External Interface Files - Берёт данные из других систем',
    weights: { low: 5, medium: 7, high: 10 }
  }
];

const PROJECTS_STORAGE_KEY = 'project-estimation-projects';
const SELECTED_PROJECT_STORAGE_KEY = 'project-estimation-selected-project';

const createDemoCategories = (): Category[] => {
  return categoryTemplates.map((cat) => {
    const items: FunctionPoint[] = [];

    if (cat.id === 'ei') {
      items.push(
        {
          id: 'demo-1',
          name: 'Форма подключения Jira',
          description: 'Авторизация через OAuth, выбор проекта',
          complexity: 'medium',
        },
        {
          id: 'demo-1-2',
          name: 'Добавление подрядчика',
          description: 'Форма с вводом данных подрядчика (ИНН, название, контакты)',
          complexity: 'low',
        },
      );
    } else if (cat.id === 'eo') {
      items.push(
        {
          id: 'demo-2',
          name: 'Отчет по задачам',
          description: 'Генерация Excel с временными метками',
          complexity: 'high',
        },
        {
          id: 'demo-2-2',
          name: 'Генерация акта выполненных работ',
          description: 'PDF документ с расчетом стоимости',
          complexity: 'high',
        },
      );
    } else if (cat.id === 'eq') {
      items.push({
        id: 'demo-3-1',
        name: 'Просмотр задач',
        description: 'Список задач с фильтрацией',
        complexity: 'medium',
      });
    } else if (cat.id === 'ilf') {
      items.push(
        {
          id: 'demo-3',
          name: 'База задач',
          description: 'Хранение импортированных задач',
          complexity: 'medium',
        },
        {
          id: 'demo-3-2',
          name: 'База контрактов',
          description: 'Реквизиты, ставки, подписанты',
          complexity: 'low',
        },
      );
    } else if (cat.id === 'eif') {
      items.push({
        id: 'demo-4',
        name: 'API Jira',
        description: 'Интеграция для получения задач',
        complexity: 'high',
      });
    }

    return {
      ...cat,
      items,
    };
  });
};

const createEmptyCategories = (): Category[] => categoryTemplates.map((cat) => ({ ...cat, items: [] }));

const createDefaultProjects = (): ProjectEstimate[] => [
  {
    id: '1',
    name: 'Интеграция с Jira',
    description: 'Модуль подключения и синхронизации задач из Jira',
    createdAt: '2024-10-10',
    categories: createDemoCategories(),
  },
  {
    id: '2',
    name: 'ЭДО интеграция',
    description: 'Модуль электронного документооборота',
    createdAt: '2024-10-12',
    categories: createEmptyCategories(),
  },
];

const normalizeProjects = (rawProjects: unknown): ProjectEstimate[] => {
  if (!Array.isArray(rawProjects) || rawProjects.length === 0) {
    return createDefaultProjects();
  }

  const now = Date.now();
  const normalized = rawProjects
    .filter((project): project is Partial<ProjectEstimate> => project !== null && typeof project === 'object')
    .map((project, projectIndex) => {
      const categories = categoryTemplates.map((template) => {
        const storedCategory =
          (Array.isArray(project.categories) ? project.categories : []).find(
            (category): category is Partial<Category> & { items?: unknown[] } =>
              category !== null && typeof category === 'object' && category?.id === template.id,
          );

        const normalizedItems: FunctionPoint[] = Array.isArray(storedCategory?.items)
          ? storedCategory.items.map((item, itemIndex) => {
              const fallbackId = `${template.id}-${projectIndex}-${itemIndex}-${now}`;
              const complexity =
                item && typeof item === 'object' && (item as FunctionPoint).complexity;
              return {
                id:
                  item && typeof item === 'object' && typeof (item as FunctionPoint).id === 'string'
                    ? (item as FunctionPoint).id
                    : fallbackId,
                name:
                  item && typeof item === 'object' && typeof (item as FunctionPoint).name === 'string'
                    ? (item as FunctionPoint).name
                    : '',
                description:
                  item && typeof item === 'object' && typeof (item as FunctionPoint).description === 'string'
                    ? (item as FunctionPoint).description
                    : '',
                complexity:
                  complexity === 'low' || complexity === 'medium' || complexity === 'high'
                    ? complexity
                    : 'medium',
              };
            })
          : [];

        const storedWeights = storedCategory?.weights;
        const weights = storedWeights
          ? {
              low: Number.isFinite(Number(storedWeights.low)) ? Number(storedWeights.low) : template.weights.low,
              medium: Number.isFinite(Number(storedWeights.medium))
                ? Number(storedWeights.medium)
                : template.weights.medium,
              high: Number.isFinite(Number(storedWeights.high)) ? Number(storedWeights.high) : template.weights.high,
            }
          : { ...template.weights };

        return {
          ...template,
          name: typeof storedCategory?.name === 'string' ? storedCategory.name : template.name,
          description:
            typeof storedCategory?.description === 'string' ? storedCategory.description : template.description,
          weights,
          items: normalizedItems,
        };
      });

      return {
        id: typeof project.id === 'string' ? project.id : `${projectIndex + 1}`,
        name: typeof project.name === 'string' ? project.name : 'Новый проект',
        description: typeof project.description === 'string' ? project.description : '',
        createdAt:
          typeof project.createdAt === 'string' ? project.createdAt : new Date(now).toISOString().split('T')[0],
        categories,
      };
    });

  return normalized.length > 0 ? normalized : createDefaultProjects();
};

export function ProjectEstimation() {
  const initialProjects = useMemo(() => {
    if (typeof window === 'undefined') {
      return createDefaultProjects();
    }

    try {
      const stored = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
      if (!stored) {
        return createDefaultProjects();
      }
      const normalized = normalizeProjects(JSON.parse(stored));
      return normalized.length > 0 ? normalized : createDefaultProjects();
    } catch (error) {
      console.warn('[ProjectEstimation] Failed to restore projects from storage', error);
      return createDefaultProjects();
    }
  }, []);

  const [projects, setProjects] = useState<ProjectEstimate[]>(initialProjects);
  const [selectedProject, setSelectedProject] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return initialProjects[0]?.id ?? null;
    }
    const storedSelected = window.localStorage.getItem(SELECTED_PROJECT_STORAGE_KEY);
    if (storedSelected && initialProjects.some((project) => project.id === storedSelected)) {
      return storedSelected;
    }
    return initialProjects[0]?.id ?? null;
  });
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['ei', 'eo', 'ilf']));
  const [hourlyRate, setHourlyRate] = useState(3000);
  const [hoursPerFP, setHoursPerFP] = useState(8);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedProject) {
      window.localStorage.setItem(SELECTED_PROJECT_STORAGE_KEY, selectedProject);
    } else {
      window.localStorage.removeItem(SELECTED_PROJECT_STORAGE_KEY);
    }
  }, [selectedProject]);

  // Создание нового проекта оценки
  const createProject = () => {
    if (!newProjectName.trim()) return;

    const newProject: ProjectEstimate = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: newProjectName,
      description: newProjectDesc,
      createdAt: new Date().toISOString().split('T')[0],
      categories: createEmptyCategories(),
    };

    setProjects((prev) => [...prev, newProject]);
    setSelectedProject(newProject.id);
    setNewProjectName('');
    setNewProjectDesc('');
    setIsCreateDialogOpen(false);
  };

  // Добавление функции в категорию
  const addFunctionPoint = (projectId: string, categoryId: string) => {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;

        return {
          ...project,
          categories: project.categories.map((cat) => {
            if (cat.id !== categoryId) return cat;

            const newItem: FunctionPoint = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name: '',
              description: '',
              complexity: 'medium',
            };

            return {
              ...cat,
              items: [...cat.items, newItem],
            };
          }),
        };
      }),
    );
  };

  // Удаление функции
  const deleteFunctionPoint = (projectId: string, categoryId: string, itemId: string) => {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;

        return {
          ...project,
          categories: project.categories.map((cat) => {
            if (cat.id !== categoryId) return cat;

            return {
              ...cat,
              items: cat.items.filter((item) => item.id !== itemId),
            };
          }),
        };
      }),
    );
  };

  // Обновление функции
  const updateFunctionPoint = (
    projectId: string,
    categoryId: string,
    itemId: string,
    field: keyof FunctionPoint,
    value: string
  ) => {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;

        return {
          ...project,
          categories: project.categories.map((cat) => {
            if (cat.id !== categoryId) return cat;

            return {
              ...cat,
              items: cat.items.map((item) => {
                if (item.id !== itemId) return item;
                return { ...item, [field]: value };
              }),
            };
          }),
        };
      }),
    );
  };

  // Подсчет функциональных точек для категории
  const calculateCategoryFP = (category: Category): number => {
    return category.items.reduce((sum, item) => {
      return sum + category.weights[item.complexity];
    }, 0);
  };

  // Подсчет общих FP для проекта
  const calculateTotalFP = (project: ProjectEstimate): number => {
    return project.categories.reduce((sum, cat) => sum + calculateCategoryFP(cat), 0);
  };

  // Оценка часов (1 FP = настраиваемое количество часов работы)
  const estimateHours = (fp: number): number => {
    return fp * hoursPerFP;
  };

  // Оценка стоимости (по часовой ставке)
  const estimateCost = (hours: number): number => {
    return hours * hourlyRate;
  };

  // Переключение раскрытия категории
  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  // Удаление проекта
  const deleteProject = (projectId: string) => {
    setProjects((prev) => {
      const updated = prev.filter((project) => project.id !== projectId);
      if (updated.length === prev.length) {
        return prev;
      }

      if (selectedProject === projectId) {
        setSelectedProject(updated.length > 0 ? updated[0].id : null);
      }

      return updated;
    });
  };

  // Дублирование проекта
  const duplicateProject = (projectId: string) => {
    setProjects((prev) => {
      const projectToDuplicate = prev.find((project) => project.id === projectId);
      if (!projectToDuplicate) {
        return prev;
      }

      const timestamp = Date.now();
      const newProjectId = `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
      const newProject: ProjectEstimate = {
        ...projectToDuplicate,
        id: newProjectId,
        name: `${projectToDuplicate.name} (копия)`,
        createdAt: new Date(timestamp).toISOString().split('T')[0],
        categories: projectToDuplicate.categories.map((cat, catIndex) => ({
          ...cat,
          items: cat.items.map((item, itemIndex) => ({
            ...item,
            id: `${cat.id}-${catIndex}-${itemIndex}-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
          })),
        })),
      };

      setSelectedProject(newProjectId);
      return [...prev, newProject];
    });
  };

  // Экспорт в CSV
  const exportToCSV = (project: ProjectEstimate) => {
    let csv = 'Категория,Код,Название функции,Описание,Сложность,FP\n';
    
    project.categories.forEach(cat => {
      cat.items.forEach(item => {
        const fp = cat.weights[item.complexity];
        csv += `"${cat.name}","${cat.code}","${item.name}","${item.description}","${item.complexity}",${fp}\n`;
      });
    });

    csv += `\n"ИТОГО",,,,,"${calculateTotalFP(project)} FP"\n`;
    csv += `"Оценка времени",,,,,"${estimateHours(calculateTotalFP(project))} часов"\n`;
    csv += `"Оценка стоимости",,,,,"${estimateCost(estimateHours(calculateTotalFP(project)))} ₽"\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${project.name}_оценка.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const currentProject = projects.find(p => p.id === selectedProject);

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-gray-900 mb-1">Оценка проекта</h1>
            <p className="text-gray-600">
              Предварительная оценка сложности и стоимости работ по методу функциональных точек
            </p>
          </div>

          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Новая оценка
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Создать новую оценку</DialogTitle>
                <DialogDescription>
                  Введите название и описание проекта для оценки
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Label htmlFor="project-name">Название проекта</Label>
                  <Input
                    id="project-name"
                    placeholder="Например: Интеграция с 1С"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="project-desc">Описание</Label>
                  <Textarea
                    id="project-desc"
                    placeholder="Краткое описание функциональности"
                    value={newProjectDesc}
                    onChange={(e) => setNewProjectDesc(e.target.value)}
                    rows={3}
                  />
                </div>
                <Button onClick={createProject} className="w-full">
                  Создать оценку
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Info Block */}
        <div className="mb-6">
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-blue-900 mb-1">Метод функциональных точек (FP)</h3>
                  <p className="text-sm text-blue-700">
                    Оценивает проект с точки зрения функциональности, а не кода. 
                    1 FP ≈ 8 часов работы. Используйте 5 категорий для полной оценки.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Project Selector */}
        <div className="mb-6">
          <Card>
            <CardHeader>
              <CardTitle>Выберите проект для оценки</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {projects.map(project => {
                  const totalFP = calculateTotalFP(project);
                  const totalHours = estimateHours(totalFP);
                  const isSelected = selectedProject === project.id;

                  return (
                    <div
                      key={project.id}
                      className={`p-4 border-2 rounded-lg transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div
                        onClick={() => setSelectedProject(project.id)}
                        className="cursor-pointer"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="text-gray-900">{project.name}</h3>
                          <Badge variant={isSelected ? 'default' : 'secondary'}>
                            {totalFP} FP
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-3">{project.description}</p>
                        <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                          <span>{project.createdAt}</span>
                          <span>≈ {totalHours} часов</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 pt-3 border-t border-gray-200">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => duplicateProject(project.id)}
                          className="flex-1 text-xs gap-1"
                        >
                          <Copy className="w-3 h-3" />
                          Копировать
                        </Button>
                        {projects.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteProject(project.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs gap-1"
                          >
                            <Trash2 className="w-3 h-3" />
                            Удалить
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Estimation Details */}
        {currentProject && (
          <>
            {/* Settings */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Параметры расчета</CardTitle>
                <CardDescription>Настройте коэффициенты для оценки времени и стоимости</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="hours-per-fp" className="mb-2 block">
                      Часов на 1 функциональную точку
                    </Label>
                    <Input
                      id="hours-per-fp"
                      type="number"
                      min="1"
                      max="20"
                      value={hoursPerFP}
                      onChange={(e) => setHoursPerFP(Number(e.target.value))}
                      className="w-full"
                    />
                    <p className="text-sm text-gray-500 mt-1">Типично: 6-10 часов</p>
                  </div>
                  <div>
                    <Label htmlFor="hourly-rate" className="mb-2 block">
                      Часовая ставка (₽)
                    </Label>
                    <Input
                      id="hourly-rate"
                      type="number"
                      min="500"
                      max="10000"
                      step="100"
                      value={hourlyRate}
                      onChange={(e) => setHourlyRate(Number(e.target.value))}
                      className="w-full"
                    />
                    <p className="text-sm text-gray-500 mt-1">Средняя ставка разработчика</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-muted-foreground">Всего функций</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-gray-900">
                    {currentProject.categories.reduce((sum, cat) => sum + cat.items.length, 0)}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-muted-foreground">Функциональные точки</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-blue-600">
                    {calculateTotalFP(currentProject)} FP
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-muted-foreground">Оценка времени</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-green-600">
                    {estimateHours(calculateTotalFP(currentProject))} ч
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-muted-foreground">Оценка стоимости</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-purple-600">
                    {(estimateCost(estimateHours(calculateTotalFP(currentProject))) / 1000).toFixed(0)}к ₽
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Categories Controls */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-gray-900">Категории функций</h2>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExpandedCategories(new Set(categoryTemplates.map(c => c.id)))}
                >
                  Развернуть все
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExpandedCategories(new Set())}
                >
                  Свернуть все
                </Button>
              </div>
            </div>

            {/* Categories */}
            <div className="space-y-4">
              {currentProject.categories.map(category => {
                const categoryFP = calculateCategoryFP(category);
                const isExpanded = expandedCategories.has(category.id);

                return (
                  <Card key={category.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <CardTitle>{category.name}</CardTitle>
                            <Badge variant="outline" className="gap-1">
                              <Calculator className="w-3 h-3" />
                              {categoryFP} FP
                            </Badge>
                            <Badge variant="secondary">
                              {category.items.length} функций
                            </Badge>
                          </div>
                          <CardDescription>
                            <span className="block">{category.description}</span>
                            <span className="block text-sm text-gray-400 mt-1">
                              Веса: низкая={category.weights.low} FP, средняя={category.weights.medium} FP, высокая={category.weights.high} FP
                            </span>
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => addFunctionPoint(currentProject.id, category.id)}
                          >
                            <Plus className="w-4 h-4 mr-1" />
                            Добавить
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleCategory(category.id)}
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>

                    {isExpanded && (
                      <CardContent>
                        {category.items.length === 0 ? (
                          <div className="text-center py-8 text-gray-500">
                            <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                            <p>Нет добавленных функций</p>
                            <p className="text-sm">Нажмите "Добавить" чтобы начать</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {category.items.map((item, index) => {
                              const fp = category.weights[item.complexity];
                              
                              return (
                                <div
                                  key={item.id}
                                  className="p-4 border border-gray-200 rounded-lg bg-gray-50"
                                >
                                  <div className="flex items-start gap-4">
                                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center text-blue-700 text-sm">
                                      {index + 1}
                                    </div>

                                    <div className="flex-1 space-y-3">
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                          <Label className="text-sm text-gray-600 mb-1">
                                            Название функции
                                          </Label>
                                          <Input
                                            placeholder="Например: Форма добавления клиента"
                                            value={item.name}
                                            onChange={(e) =>
                                              updateFunctionPoint(
                                                currentProject.id,
                                                category.id,
                                                item.id,
                                                'name',
                                                e.target.value
                                              )
                                            }
                                          />
                                        </div>

                                        <div>
                                          <Label className="text-sm text-gray-600 mb-1">
                                            Сложность
                                          </Label>
                                          <Select
                                            value={item.complexity}
                                            onValueChange={(value) =>
                                              updateFunctionPoint(
                                                currentProject.id,
                                                category.id,
                                                item.id,
                                                'complexity',
                                                value
                                              )
                                            }
                                          >
                                            <SelectTrigger>
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="low">
                                                Низкая ({category.weights.low} FP)
                                              </SelectItem>
                                              <SelectItem value="medium">
                                                Средняя ({category.weights.medium} FP)
                                              </SelectItem>
                                              <SelectItem value="high">
                                                Высокая ({category.weights.high} FP)
                                              </SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      </div>

                                      <div>
                                        <Label className="text-sm text-gray-600 mb-1">
                                          Описание
                                        </Label>
                                        <Textarea
                                          placeholder="Дополнительное описание функции..."
                                          value={item.description}
                                          onChange={(e) =>
                                            updateFunctionPoint(
                                              currentProject.id,
                                              category.id,
                                              item.id,
                                              'description',
                                              e.target.value
                                            )
                                          }
                                          rows={2}
                                        />
                                      </div>
                                    </div>

                                    <div className="flex-shrink-0 flex flex-col items-end gap-2">
                                      <div className="text-right space-y-1">
                                        <Badge variant="default" className="bg-blue-600 block">
                                          {fp} FP
                                        </Badge>
                                        <div className="text-sm text-gray-500">
                                          ≈ {fp * hoursPerFP} ч
                                        </div>
                                        <div className="text-sm text-gray-500">
                                          ≈ {((fp * hoursPerFP * hourlyRate) / 1000).toFixed(1)}к ₽
                                        </div>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          deleteFunctionPoint(
                                            currentProject.id,
                                            category.id,
                                            item.id
                                          )
                                        }
                                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>

            {/* Summary Footer */}
            <Card className="mt-6 bg-gradient-to-r from-blue-50 to-purple-50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg text-gray-900 mb-2">Итоговая оценка проекта</h3>
                    <div className="flex items-center gap-6 text-sm">
                      <div>
                        <span className="text-gray-600">Функциональных точек: </span>
                        <span className="text-blue-600">
                          {calculateTotalFP(currentProject)} FP
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Оценка времени: </span>
                        <span className="text-green-600">
                          {estimateHours(calculateTotalFP(currentProject))} часов
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Оценка стоимости: </span>
                        <span className="text-purple-600">
                          {(
                            estimateCost(estimateHours(calculateTotalFP(currentProject))) / 1000
                          ).toFixed(0)}
                          к ₽
                        </span>
                      </div>
                    </div>
                  </div>
                  <Button className="gap-2" onClick={() => exportToCSV(currentProject)}>
                    <Download className="w-4 h-4" />
                    Экспортировать в CSV
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Additional Info */}
            <div className="mt-6 space-y-3">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  <strong>Методика расчета:</strong> Используется стандарт IFPUG для функциональных точек. 
                  Текущие параметры: 1 FP = {hoursPerFP} часов, ставка = {hourlyRate} ₽/час.
                </AlertDescription>
              </Alert>
              
              <Alert className="bg-yellow-50 border-yellow-200">
                <Info className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800">
                  Это предварительная оценка. Финальная стоимость может отличаться в зависимости от требований и сложности интеграций.
                </AlertDescription>
              </Alert>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
