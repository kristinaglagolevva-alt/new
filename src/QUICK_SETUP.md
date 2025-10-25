# Быстрая настройка OpenAI

## Шаг 1: Добавьте API ключ

1. Откройте приложение
2. Перейдите в **Настройки** (иконка шестеренки в боковом меню)
3. Найдите раздел **Интеграции → OpenAI API**
4. Вставьте ваш ключ в поле "API ключ OpenAI"

Или выполните в консоли браузера (F12):

\`\`\`javascript
localStorage.setItem('OPENAI_API_KEY', 'sk-proj-your-key');
// Обновите страницу после этого
\`\`\`

## Шаг 2: Используйте генерацию

После настройки вы сможете:

1. **В шаблонах документов** - генерировать контент через AI
2. **При создании пакетов документов** - использовать AI для заполнения
3. **В редакторе** - вставлять сгенерированный текст

## Примеры использования

### В коде:

\`\`\`typescript
import { generateDocumentWithAI } from './utils/documentGenerator';

// Генерация акта выполненных работ
const result = await generateDocumentWithAI({
  documentType: 'act',
  templateContent: '', // Или ваш шаблон
  taskData: {
    projectName: 'Разработка системы',
    period: 'Январь 2025',
    tasks: [
      { title: 'Создание UI', hours: 40 },
      { title: 'Интеграция API', hours: 30 },
    ],
    totalHours: 70,
    totalAmount: 210000,
    contractor: {
      name: 'Иванов Иван Иванович',
      inn: '123456789012',
    },
    client: {
      name: 'ООО "Актех"',
      inn: '7701234567',
    },
  },
});

if (result.success) {
  console.log('Сгенерированный документ:', result.content);
} else {
  console.error('Ошибка:', result.error);
}
\`\`\`

## Проверка работы

Откройте консоль браузера (F12) и выполните:

\`\`\`javascript
import { checkOpenAIAvailability } from './utils/documentGenerator';

const isAvailable = await checkOpenAIAvailability();
console.log('OpenAI доступен:', isAvailable);
\`\`\`

## ⚠️ Важно

Это демо-версия! В продакшене используйте бэкенд сервер для безопасного хранения API ключа.

Смотрите полные инструкции в файле `OPENAI_INTEGRATION.md`.
