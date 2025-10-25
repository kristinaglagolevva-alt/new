# Интеграция с OpenAI для генерации документов

## ⚠️ ВАЖНОЕ ПРЕДУПРЕЖДЕНИЕ О БЕЗОПАСНОСТИ

**НИКОГДА не используйте это решение в продакшене без бэкенда!**

Текущая реализация хранит API ключ OpenAI в `localStorage` браузера и вызывает API напрямую из фронтенда. Это сделано ТОЛЬКО для демонстрации и разработки.

### Почему это небезопасно:

1. **API ключ виден в коде** - любой может открыть DevTools и украсть ваш ключ
2. **Нет контроля расходов** - злоумышленник может исчерпать ваш баланс OpenAI
3. **CORS проблемы** - браузер может блокировать прямые запросы к OpenAI
4. **Нет rate limiting** - нет защиты от превышения лимитов

## ✅ Правильное решение для продакшена

### Вариант 1: Node.js/Express бэкенд

Создайте отдельный сервер:

\`\`\`javascript
// server.js
import express from 'express';
import OpenAI from 'openai';

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Хранится на сервере!
});

app.post('/api/generate-document', async (req, res) => {
  try {
    const { documentType, templateContent, taskData } = req.body;
    
    // Ваша валидация и логика
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'Ты помощник по созданию документов...' },
        { role: 'user', content: buildPrompt(req.body) },
      ],
    });
    
    res.json({ content: completion.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000);
\`\`\`

### Вариант 2: Serverless функции (Vercel/Netlify)

\`\`\`javascript
// api/generate-document.js
import OpenAI from 'openai';

export default async function handler(req, res) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  
  // ... ваша логика
}
\`\`\`

### Вариант 3: Supabase Edge Functions

\`\`\`typescript
// supabase/functions/generate-document/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import OpenAI from 'openai'

serve(async (req) => {
  const openai = new OpenAI({
    apiKey: Deno.env.get('OPENAI_API_KEY'),
  })
  
  // ... ваша логика
})
\`\`\`

## Как использовать текущую демо-версию

### 1. Добавьте API ключ

Перейдите в **Настройки → Интеграции → OpenAI API** и вставьте ваш ключ.

### 2. Используйте функцию генерации

\`\`\`typescript
import { generateDocumentWithAI } from './utils/documentGenerator';

const result = await generateDocumentWithAI({
  documentType: 'act',
  templateContent: '...',
  taskData: {
    projectName: 'Мой проект',
    period: 'Январь 2025',
    // ... остальные данные
  },
});

if (result.success) {
  console.log(result.content);
} else {
  console.error(result.error);
}
\`\`\`

## Рекомендуемая архитектура для продакшена

\`\`\`
┌─────────────┐
│   Browser   │
│  (Frontend) │
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────┐
│   Backend   │ ← API ключ хранится здесь!
│   Server    │
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────┐
│  OpenAI API │
└─────────────┘
\`\`\`

## Переменные окружения

Для бэкенда создайте `.env` файл:

\`\`\`bash
OPENAI_API_KEY=sk-proj-...
PORT=3000
NODE_ENV=production
\`\`\`

**Никогда не коммитьте `.env` в git!**

Добавьте в `.gitignore`:
\`\`\`
.env
.env.local
.env.*.local
\`\`\`

## Мониторинг использования

1. Посетите https://platform.openai.com/usage
2. Настройте лимиты расходов
3. Включите email уведомления о превышении
4. Регулярно проверяйте логи использования

## Стоимость

- GPT-4: ~$0.03 за 1K входных токенов, ~$0.06 за 1K выходных токенов
- GPT-3.5-turbo: ~$0.0015 за 1K входных токенов, ~$0.002 за 1K выходных токенов

Для генерации одного документа обычно требуется 500-2000 токенов.

## Поддержка

Если у вас возникли вопросы:
- Документация OpenAI: https://platform.openai.com/docs
- Примеры: https://github.com/openai/openai-cookbook
