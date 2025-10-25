import { useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';

interface AIGenerateButtonProps {
  onGenerate: (content: string) => void;
  context?: {
    documentType?: 'act' | 'invoice' | 'contract';
    projectName?: string;
    additionalInfo?: string;
  };
  buttonVariant?: 'default' | 'outline' | 'ghost';
  buttonSize?: 'default' | 'sm' | 'lg';
}

export function AIGenerateButton({
  onGenerate,
  context,
  buttonVariant = 'outline',
  buttonSize = 'default',
}: AIGenerateButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const hasApiKey = Boolean(localStorage.getItem('OPENAI_API_KEY'));

  const handleGenerate = async () => {
    if (!hasApiKey) {
      setError('Настройте API ключ OpenAI в настройках приложения');
      return;
    }

    if (!prompt.trim()) {
      setError('Введите описание того, что нужно сгенерировать');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const apiKey = localStorage.getItem('OPENAI_API_KEY');
      
      let systemPrompt = 'Ты профессиональный помощник по созданию юридических и бухгалтерских документов. ';
      systemPrompt += 'Генерируй документы на русском языке в соответствии с российскими стандартами. ';
      systemPrompt += 'Используй профессиональный деловой стиль.';

      let userPrompt = prompt;

      // Добавляем контекст если есть
      if (context?.documentType) {
        const typeLabels = {
          act: 'Акт выполненных работ',
          invoice: 'Счет на оплату',
          contract: 'Договор',
        };
        userPrompt = `Создай ${typeLabels[context.documentType]}.\n\n${userPrompt}`;
      }

      if (context?.projectName) {
        userPrompt += `\n\nПроект: ${context.projectName}`;
      }

      if (context?.additionalInfo) {
        userPrompt += `\n\n${context.additionalInfo}`;
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error?.message || `Ошибка API: ${response.status}`
        );
      }

      const data = await response.json();
      const generatedContent = data.choices[0]?.message?.content;

      if (!generatedContent) {
        throw new Error('Не удалось получить сгенерированный контент');
      }

      onGenerate(generatedContent);
      setOpen(false);
      setPrompt('');
    } catch (err) {
      console.error('AI generation error:', err);
      setError(err instanceof Error ? err.message : 'Ошибка генерации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant={buttonVariant}
        size={buttonSize}
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <Sparkles className="w-4 h-4" />
        Сгенерировать с AI
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              Генерация с помощью AI
            </DialogTitle>
            <DialogDescription>
              Опишите что нужно сгенерировать, и AI создаст контент для вас
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!hasApiKey && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  API ключ OpenAI не настроен. Перейдите в Настройки → Интеграции, чтобы добавить ключ.
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="ai-prompt">Что сгенерировать?</Label>
              <Textarea
                id="ai-prompt"
                placeholder="Например: Создай акт выполненных работ для разработки веб-приложения. Исполнитель - Иванов И.И., заказчик - ООО Актех. Работы: разработка UI (40 часов), интеграция API (30 часов). Период - январь 2025."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Чем подробнее описание, тем лучше результат
              </p>
            </div>

            {context && (
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div className="text-sm text-blue-900">
                  <strong>Контекст:</strong>
                  {context.documentType && (
                    <div className="mt-1">
                      Тип документа: {context.documentType === 'act' ? 'Акт' : context.documentType === 'invoice' ? 'Счет' : 'Договор'}
                    </div>
                  )}
                  {context.projectName && (
                    <div className="mt-1">Проект: {context.projectName}</div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                Отмена
              </Button>
              <Button onClick={handleGenerate} disabled={loading || !hasApiKey}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Генерация...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Сгенерировать
                  </>
                )}
              </Button>
            </div>

            <div className="pt-3 border-t">
              <p className="text-xs text-muted-foreground">
                💡 Модель: GPT-4 | Стоимость: ~$0.03-0.10 за генерацию
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                ⚠️ Это демо-версия. В продакшене используйте бэкенд сервер для безопасности.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
