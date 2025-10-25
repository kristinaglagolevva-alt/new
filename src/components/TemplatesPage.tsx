import { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Alert, AlertDescription } from './ui/alert';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { RichTextEditor } from './RichTextEditor';
import {
  FileText,
  Plus,
  Search,
  Trash2,
  Copy,
  Download,
  Upload,
  AlertCircle,
  Calendar,
  FolderOpen,
} from 'lucide-react';
import { useDatabase } from '../data/DataContext';
import type { DocumentTemplate, TemplateType } from '../data/models';
import { motion } from 'motion/react';
import mammoth from 'mammoth';
import { AIGenerateButton } from './AIGenerateButton';
import { TEMPLATE_PLACEHOLDER_MAP } from '../data/templatePlaceholders';

const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  act: 'Акт',
  invoice: 'Счёт',
  timesheet: 'Таймшит',
  custom: 'Другое',
};

const TEMPLATE_TYPES: Array<{ value: TemplateType; label: string }> = [
  { value: 'act', label: TEMPLATE_TYPE_LABELS.act },
  { value: 'invoice', label: TEMPLATE_TYPE_LABELS.invoice },
  { value: 'timesheet', label: TEMPLATE_TYPE_LABELS.timesheet },
  { value: 'custom', label: TEMPLATE_TYPE_LABELS.custom },
];

const DEFAULT_TEMPLATE_TYPE: TemplateType = 'act';

const PLACEHOLDER_HINT_KEYS = ['actNumber', 'startPeriodDate', 'endPeriodDate', 'companyName', 'seoFullName'] as const;
const PLACEHOLDER_HINTS = PLACEHOLDER_HINT_KEYS.map((key) => TEMPLATE_PLACEHOLDER_MAP[key]).filter(
  (placeholder): placeholder is NonNullable<typeof TEMPLATE_PLACEHOLDER_MAP[key]> => Boolean(placeholder)
);

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

export function TemplatesPage() {
  const { templates, createTemplate, updateTemplate, deleteTemplate } = useDatabase();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    type: DEFAULT_TEMPLATE_TYPE,
    category: '',
    description: '',
    content: '',
  });

  const selectedTemplate = useMemo(
    () => templates.find(t => t.id === selectedTemplateId),
    [templates, selectedTemplateId]
  );

  // Auto-select first template on load
  useEffect(() => {
    if (!selectedTemplateId && templates.length > 0) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  // Update form when template is selected
  useEffect(() => {
    if (selectedTemplate && isEditing) {
      setFormData({
        name: selectedTemplate.name,
        type: selectedTemplate.type,
        category: selectedTemplate.category || '',
        description: selectedTemplate.description || '',
        content: selectedTemplate.content,
      });
    }
  }, [selectedTemplate, isEditing]);

  const filteredTemplates = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return templates;

    return templates.filter((template) => {
      const typeLabel = TEMPLATE_TYPE_LABELS[template.type]?.toLowerCase() ?? '';
      const category = template.category?.toLowerCase() ?? '';
      const description = template.description?.toLowerCase() ?? '';
      return (
        template.name.toLowerCase().includes(search) ||
        template.type.toLowerCase().includes(search) ||
        typeLabel.includes(search) ||
        category.includes(search) ||
        description.includes(search)
      );
    });
  }, [templates, searchTerm]);

  const groupedTemplates = useMemo(() => {
    const groups = new Map<string, DocumentTemplate[]>();
    
    filteredTemplates.forEach(template => {
      const category = template.category || 'Без категории';
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(template);
    });

    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, 'ru-RU'));
  }, [filteredTemplates]);

  const handleCreateTemplate = async () => {
    const name = formData.name.trim();
    if (!name) {
      alert('Введите название шаблона.');
      return;
    }

    const payload = {
      name,
      type: formData.type,
      category: formData.category.trim() ? formData.category.trim() : null,
      description: formData.description.trim() ? formData.description.trim() : null,
      content: formData.content,
    };

    try {
      const newTemplate = await createTemplate(payload);
      setSelectedTemplateId(newTemplate.id);
      setShowCreateDialog(false);
      resetForm();
    } catch (error) {
      console.error('Failed to create template:', error);
    }
  };

  const handleUpdateTemplate = async () => {
    if (!selectedTemplateId) return;
    const name = formData.name.trim();
    if (!name) {
      alert('Название шаблона не может быть пустым.');
      return;
    }

    const payload: Partial<DocumentTemplate> = {
      name,
      type: formData.type,
      category: formData.category.trim() ? formData.category.trim() : null,
      description: formData.description.trim() ? formData.description.trim() : null,
      content: formData.content,
    };

    try {
      await updateTemplate(selectedTemplateId, payload);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update template:', error);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplateId) return;
    
    try {
      await deleteTemplate(selectedTemplateId);
      setShowDeleteDialog(false);
      setSelectedTemplateId(null);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to delete template:', error);
    }
  };

  const handleDuplicateTemplate = async () => {
    if (!selectedTemplate) return;
    
    try {
      const newTemplate = await createTemplate({
        name: `${selectedTemplate.name} (копия)`,
        type: selectedTemplate.type,
        category: selectedTemplate.category ?? null,
        description: selectedTemplate.description ?? null,
        content: selectedTemplate.content,
      });
      setSelectedTemplateId(newTemplate.id);
    } catch (error) {
      console.error('Failed to duplicate template:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: DEFAULT_TEMPLATE_TYPE,
      category: '',
      description: '',
      content: '',
    });
  };

  const handleImportDocx = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.docx')) {
      alert('Пожалуйста, выберите файл .docx');
      return;
    }

    setIsImporting(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      
      if (isEditing && selectedTemplateId) {
        // Import into current template
        setFormData({ ...formData, content: result.value });
      } else {
        // Create new template from imported file
        const fileName = file.name.replace('.docx', '');
        setFormData({
          name: fileName,
          type: DEFAULT_TEMPLATE_TYPE,
          category: '',
          description: 'Импортировано из Word',
          content: result.value,
        });
        setShowCreateDialog(true);
      }

      if (result.messages.length > 0) {
        console.warn('Import warnings:', result.messages);
      }
    } catch (error) {
      console.error('Failed to import DOCX:', error);
      alert('Не удалось импортировать файл. Пожалуйста, попробуйте другой файл.');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const getTypeBadgeColor = (type: TemplateType) => {
    switch (type) {
      case 'act':
        return 'bg-blue-100 text-blue-700 hover:bg-blue-100';
      case 'invoice':
        return 'bg-purple-100 text-purple-700 hover:bg-purple-100';
      case 'timesheet':
        return 'bg-amber-100 text-amber-700 hover:bg-amber-100';
      case 'custom':
      default:
        return 'bg-gray-100 text-gray-700 hover:bg-gray-100';
    }
  };

  const resolveAIDocumentType = (type?: TemplateType) => {
    if (!type) return undefined;
    if (type === 'act') return 'act';
    if (type === 'invoice') return 'invoice';
    return 'contract';
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-gray-900 mb-1">Шаблоны документов</h1>
            <p className="text-gray-600">
              Редактирование шаблонов в текстовом формате, не выводим на печати
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx"
              onChange={handleImportDocx}
              className="hidden"
            />
            <AIGenerateButton
              onGenerate={(content) => {
                if (selectedTemplateId) {
                  setFormData({ ...formData, content });
                }
              }}
              context={{
                documentType: resolveAIDocumentType(selectedTemplate?.type),
              }}
              buttonSize="sm"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="gap-2"
            >
              <Upload className="w-4 h-4" />
              {isImporting ? 'Импорт...' : 'Импорт из Word'}
            </Button>
            <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Новый шаблон
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Поиск по названию или типу..."
            className="pl-10"
          />
        </div>
      </div>

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Templates List */}
        <div className="lg:col-span-1">
          <div
            className="self-start"
            style={{
              position: 'sticky',
              top: '24px',
              height: 'calc(100vh - 80px)',
              maxHeight: 'calc(100vh - 80px)',
            }}
          >
            <Card className="h-full overflow-hidden" style={{ height: '100%' }}>
              <CardContent className="p-0 h-full flex flex-col min-h-0">
                <div className="p-4 border-b bg-muted/30">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-5 h-5 text-muted-foreground" />
                    <h3 className="font-medium">Список шаблонов</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {templates.length} шаблонов
                  </p>
                </div>
                <ScrollArea className="flex-1 min-h-0 lg:h-full">
                  <div className="p-2">
                    {groupedTemplates.length === 0 ? (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        Шаблоны не найдены
                      </div>
                    ) : (
                      groupedTemplates.map(([category, categoryTemplates]) => (
                        <div key={category} className="mb-4">
                          <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase">
                            {category}
                          </div>
                            <div className="space-y-2">
                              {categoryTemplates.map((template) => (
                                <motion.button
                                  key={template.id}
                                  onClick={() => {
                                    setSelectedTemplateId(template.id);
                                    setIsEditing(false);
                                  }}
                                  className={`w-full text-left p-3 rounded-lg transition-all ${
                                    selectedTemplateId === template.id
                                      ? 'bg-primary/10 border-2 border-primary/30 shadow-md'
                                      : 'bg-white border border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300'
                                  }`}
                                  whileHover={{ scale: 1.02, y: -1 }}
                                  whileTap={{ scale: 0.98 }}
                                >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-start gap-2 mb-1">
                                      <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                      <span className="font-medium leading-tight line-clamp-2 break-words">
                                        {template.name}
                                      </span>
                                    </div>
                                    {template.description && (
                                      <p className="text-xs text-muted-foreground line-clamp-2 mb-1">
                                        {template.description}
                                      </p>
                                    )}
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                      <Calendar className="w-3 h-3" />
                                      {formatDate(template.updatedAt)}
                                    </div>
                                  </div>
                                  <Badge className={`flex-shrink-0 ${getTypeBadgeColor(template.type)}`}>
                                    {TEMPLATE_TYPE_LABELS[template.type] ?? template.type}
                                  </Badge>
                                </div>
                              </motion.button>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Template Details */}
        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            {selectedTemplate ? (
              <>
                {/* Header */}
                <div className="p-6 border-b">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1">
                      {isEditing ? (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>Название</Label>
                            <Input
                              value={formData.name}
                              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                              placeholder="Название шаблона"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>Тип документа</Label>
                              <Select
                                value={formData.type}
                                onValueChange={(value) => setFormData({ ...formData, type: value as TemplateType })}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TEMPLATE_TYPES.map((type) => (
                                    <SelectItem key={type.value} value={type.value}>
                                      {type.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>Категория</Label>
                              <Input
                                value={formData.category}
                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                placeholder="Категория"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>Описание (необязательно)</Label>
                            <Input
                              value={formData.description}
                              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                              placeholder="Краткое описание шаблона"
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-3 mb-2">
                            <h2>{selectedTemplate.name}</h2>
                            <Badge className={getTypeBadgeColor(selectedTemplate.type)}>
                              {TEMPLATE_TYPE_LABELS[selectedTemplate.type] ?? selectedTemplate.type}
                            </Badge>
                          </div>
                          {selectedTemplate.description && (
                            <p className="text-sm text-muted-foreground mb-3">
                              {selectedTemplate.description}
                            </p>
                          )}
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              Обновлено {formatDate(selectedTemplate.updatedAt)}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    
                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isImporting}
                          >
                            <Upload className="w-4 h-4" />
                          </Button>
                          <Separator orientation="vertical" className="h-6" />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsEditing(false)}
                          >
                            Отмена
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleUpdateTemplate}
                          >
                            Сохранить
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDuplicateTemplate}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              // Export template as HTML
                              const blob = new Blob([selectedTemplate.content], { type: 'text/html' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `${selectedTemplate.name}.html`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowDeleteDialog(true)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => setIsEditing(true)}
                          >
                            Редактировать
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Content Editor */}
                <div className="p-0">
                  <RichTextEditor
                    content={isEditing ? formData.content : selectedTemplate.content}
                    onChange={(content) => setFormData({ ...formData, content })}
                    editable={isEditing}
                    previewType={isEditing ? formData.type : selectedTemplate.type}
                  />
                </div>
              </>
            ) : (
              <div className="p-12 text-center">
                <FileText className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="font-medium mb-2">Шаблон не выбран</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Выберите шаблон из списка или создайте новый
                </p>
                <Button onClick={() => setShowCreateDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Создать шаблон
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create Template Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Создать новый шаблон</DialogTitle>
            <DialogDescription>
              Форма для создания нового шаблона документа
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-name">Название шаблона</Label>
              <Input
                id="new-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Например: Акт приёмки работ"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="new-type">Тип документа</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value) => setFormData({ ...formData, type: value as TemplateType })}
                >
                  <SelectTrigger id="new-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-category">Категория</Label>
                <Input
                  id="new-category"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="ЮЛ, ИП, ФЛ..."
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-description">Описание (необязательно)</Label>
              <Input
                id="new-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Краткое описание шаблона"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-content">Содержание шаблона</Label>
              <div className="h-[400px] border rounded-lg overflow-hidden">
                <RichTextEditor
                  content={formData.content}
                  onChange={(content) => setFormData({ ...formData, content })}
                  editable={true}
                  previewType={formData.type}
                />
              </div>
            </div>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <div>
                    <p className="font-medium mb-1">Используйте переменные для автозаполнения:</p>
                    <div className="text-xs space-y-1">
                      {PLACEHOLDER_HINTS.map((placeholder) => (
                        <p key={placeholder.key}>
                          • <code className="bg-slate-100 px-1 rounded">{placeholder.token}</code> — {placeholder.label}
                        </p>
                      ))}
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <p className="font-medium mb-1">Импорт из Word:</p>
                    <p className="text-xs">
                      Вы можете загрузить готовый .docx документ, и он будет автоматически конвертирован в редактируемый формат.
                    </p>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateDialog(false);
                resetForm();
              }}
            >
              Отмена
            </Button>
            <Button
              onClick={handleCreateTemplate}
              disabled={!formData.name.trim() || !formData.content.trim()}
            >
              Создать шаблон
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить шаблон?</DialogTitle>
            <DialogDescription>
              Подтверждение удаления шаблона
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Вы уверены, что хотите удалить шаблон "
              <span className="font-medium text-foreground">{selectedTemplate?.name}</span>
              "? Это действие нельзя отменить.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleDeleteTemplate}>
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
