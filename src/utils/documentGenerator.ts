/**
 * ВАЖНО: Это демо-версия для разработки.
 * В продакшене НИКОГДА не храните API ключи в клиентском коде!
 * Используйте бэкенд сервер для безопасных вызовов к OpenAI.
 */

interface GenerateDocumentParams {
  documentType: 'act' | 'invoice' | 'contract';
  templateContent: string;
  taskData: {
    projectName: string;
    period: string;
    tasks: Array<{
      title: string;
      hours: number;
      description?: string;
    }>;
    totalHours: number;
    totalAmount: number;
    contractor: {
      name: string;
      inn?: string;
      passport?: string;
    };
    client: {
      name: string;
      inn?: string;
    };
  };
  customVariables?: Record<string, string>;
}

interface DocumentGenerationResult {
  success: boolean;
  content?: string;
  error?: string;
}

/**
 * Генерирует документ используя OpenAI API
 * 
 * ⚠️ ПРЕДУПРЕЖДЕНИЕ: В продакшене переместите этот код на бэкенд!
 */
export async function generateDocumentWithAI(
  params: GenerateDocumentParams
): Promise<DocumentGenerationResult> {
  try {
    // В продакшене это должно быть на бэкенде!
    const apiKey = localStorage.getItem('OPENAI_API_KEY');
    
    if (!apiKey) {
      return {
        success: false,
        error: 'API ключ OpenAI не настроен. Добавьте его в настройках.',
      };
    }

    const prompt = buildPrompt(params);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'Ты профессиональный помощник по созданию юридических и бухгалтерских документов. Твоя задача - заполнить шаблон документа корректными данными, соблюдая форматирование и структуру. Генерируй только содержимое документа, без дополнительных комментариев.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `OpenAI API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`
      );
    }

    const data = await response.json();
    const generatedContent = data.choices[0]?.message?.content;

    if (!generatedContent) {
      throw new Error('Не удалось получить сгенерированный контент');
    }

    return {
      success: true,
      content: generatedContent,
    };
  } catch (error) {
    console.error('Error generating document with AI:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Неизвестная ошибка',
    };
  }
}

/**
 * Создает промпт для генерации документа
 */
function buildPrompt(params: GenerateDocumentParams): string {
  const { documentType, templateContent, taskData, customVariables } = params;

  const documentTypeLabels = {
    act: 'Акт выполненных работ',
    invoice: 'Счет на оплату',
    contract: 'Договор',
  };

  let prompt = `Сгенерируй ${documentTypeLabels[documentType]} на основе следующих данных:\n\n`;

  // Основная информация
  prompt += `**Проект:** ${taskData.projectName}\n`;
  prompt += `**Период:** ${taskData.period}\n`;
  prompt += `**Исполнитель:** ${taskData.contractor.name}`;
  if (taskData.contractor.inn) {
    prompt += `, ИНН: ${taskData.contractor.inn}`;
  }
  if (taskData.contractor.passport) {
    prompt += `, Паспорт: ${taskData.contractor.passport}`;
  }
  prompt += `\n`;
  prompt += `**Заказчик:** ${taskData.client.name}`;
  if (taskData.client.inn) {
    prompt += `, ИНН: ${taskData.client.inn}`;
  }
  prompt += `\n\n`;

  // Список работ
  prompt += `**Выполненные работы:**\n`;
  taskData.tasks.forEach((task, index) => {
    prompt += `${index + 1}. ${task.title} - ${task.hours} ч`;
    if (task.description) {
      prompt += ` (${task.description})`;
    }
    prompt += `\n`;
  });

  prompt += `\n**Итого часов:** ${taskData.totalHours} ч\n`;
  prompt += `**Итоговая сумма:** ${taskData.totalAmount.toLocaleString('ru-RU')} ₽\n\n`;

  // Дополнительные переменные
  if (customVariables && Object.keys(customVariables).length > 0) {
    prompt += `**Дополнительные данные:**\n`;
    Object.entries(customVariables).forEach(([key, value]) => {
      prompt += `${key}: ${value}\n`;
    });
    prompt += `\n`;
  }

  // Шаблон (если есть)
  if (templateContent && templateContent.trim()) {
    prompt += `**Шаблон документа:**\n\`\`\`\n${templateContent}\n\`\`\`\n\n`;
    prompt += `Заполни этот шаблон указанными данными. Замени все переменные (например {{название}}, {{дата}}, {{сумма}}) на реальные значения. Сохрани форматирование и структуру шаблона.\n`;
  } else {
    prompt += `Создай профессиональный ${documentTypeLabels[documentType]} со стандартной структурой, используя предоставленные данные. Документ должен быть оформлен согласно российским стандартам.\n`;
  }

  prompt += `\nТекущая дата: ${new Date().toLocaleDateString('ru-RU')}\n`;

  return prompt;
}

/**
 * Простая генерация документа без AI (fallback)
 */
export function generateDocumentSimple(params: GenerateDocumentParams): string {
  const { documentType, taskData } = params;
  const today = new Date().toLocaleDateString('ru-RU');

  let content = '';

  if (documentType === 'act') {
    content = `АКТ ВЫПОЛНЕННЫХ РАБОТ\n\n`;
    content += `от ${today}\n\n`;
    content += `Проект: ${taskData.projectName}\n`;
    content += `Период: ${taskData.period}\n\n`;
    content += `Заказчик: ${taskData.client.name}${taskData.client.inn ? `, ИНН: ${taskData.client.inn}` : ''}\n`;
    content += `Исполнитель: ${taskData.contractor.name}${taskData.contractor.inn ? `, ИНН: ${taskData.contractor.inn}` : ''}${taskData.contractor.passport ? `, Паспорт: ${taskData.contractor.passport}` : ''}\n\n`;
    
    content += `ВЫПОЛНЕННЫЕ РАБОТЫ:\n\n`;
    taskData.tasks.forEach((task, index) => {
      content += `${index + 1}. ${task.title}\n`;
      if (task.description) {
        content += `   ${task.description}\n`;
      }
      content += `   Время: ${task.hours} ч\n\n`;
    });
    
    content += `\nИТОГО:\n`;
    content += `Часов: ${taskData.totalHours} ч\n`;
    content += `Сумма: ${taskData.totalAmount.toLocaleString('ru-RU')} ₽\n\n`;
    content += `\n\n_____________________\nПодпись Заказчика\n\n_____________________\nПодпись Исполнителя\n`;
  } else if (documentType === 'invoice') {
    content = `СЧЕТ НА ОПЛАТУ\n\n`;
    content += `№ _______ от ${today}\n\n`;
    content += `Получатель: ${taskData.client.name}\n`;
    content += `Плательщик: ${taskData.contractor.name}\n\n`;
    content += `Назначение платежа: Оплата за выполненные работы по проекту "${taskData.projectName}" за период ${taskData.period}\n\n`;
    content += `К оплате: ${taskData.totalAmount.toLocaleString('ru-RU')} ₽\n`;
  } else {
    content = `ДОГОВОР\n\nна выполнение работ\n\nот ${today}\n\n`;
    content += `Заказчик: ${taskData.client.name}\n`;
    content += `Исполнитель: ${taskData.contractor.name}\n\n`;
    content += `Предмет договора: выполнение работ по проекту "${taskData.projectName}"\n`;
  }

  return content;
}

/**
 * Проверяет доступность OpenAI API
 */
export async function checkOpenAIAvailability(): Promise<boolean> {
  const apiKey = localStorage.getItem('OPENAI_API_KEY');
  if (!apiKey) return false;

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}
