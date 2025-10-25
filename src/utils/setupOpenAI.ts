/**
 * Утилита для быстрой настройки OpenAI API ключа
 * 
 * ВНИМАНИЕ: Это только для разработки и тестирования!
 * В продакшене НИКОГДА не храните ключи в коде!
 */

/**
 * Проверяет, настроен ли API ключ
 */
export function isOpenAIConfigured(): boolean {
  const key = localStorage.getItem('OPENAI_API_KEY');
  return Boolean(key && key.trim().length > 0);
}

/**
 * Устанавливает API ключ
 * Используйте только для разработки!
 */
export function setOpenAIKey(key: string): void {
  if (!key || key.trim().length === 0) {
    console.warn('[OpenAI] Попытка установить пустой ключ');
    return;
  }
  
  localStorage.setItem('OPENAI_API_KEY', key.trim());
  console.log('[OpenAI] API ключ установлен');
}

/**
 * Удаляет API ключ
 */
export function clearOpenAIKey(): void {
  localStorage.removeItem('OPENAI_API_KEY');
  console.log('[OpenAI] API ключ удален');
}

/**
 * Получает API ключ (для внутреннего использования)
 */
export function getOpenAIKey(): string | null {
  return localStorage.getItem('OPENAI_API_KEY');
}

/**
 * Проверяет валидность формата ключа
 */
export function isValidKeyFormat(key: string): boolean {
  return key.startsWith('sk-') && key.length > 20;
}

/**
 * Маскирует ключ для безопасного отображения
 */
export function maskApiKey(key: string): string {
  if (key.length < 10) return '***';
  return `${key.substring(0, 7)}...${key.substring(key.length - 4)}`;
}

/**
 * Проверяет работоспособность API ключа
 */
export async function testOpenAIConnection(): Promise<{ success: boolean; error?: string }> {
  const key = getOpenAIKey();
  
  if (!key) {
    return { success: false, error: 'API ключ не настроен' };
  }
  
  if (!isValidKeyFormat(key)) {
    return { success: false, error: 'Неверный формат API ключа' };
  }
  
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key}`,
      },
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error?.message || `HTTP ${response.status}`,
      };
    }
    
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Ошибка подключения',
    };
  }
}

/**
 * Вспомогательная функция для разработки
 * Быстро устанавливает ключ из переменной окружения или параметра
 * 
 * ИСПОЛЬЗУЙТЕ ТОЛЬКО ДЛЯ РАЗРАБОТКИ!
 */
export function quickSetupForDev(apiKey?: string): void {
  if (isOpenAIConfigured()) {
    console.log('[OpenAI] Ключ уже настроен:', maskApiKey(getOpenAIKey()!));
    return;
  }
  
  // Пробуем получить из переменной окружения (для dev сервера)
  const envKey = (import.meta as any)?.env?.VITE_OPENAI_API_KEY;
  const keyToUse = apiKey || envKey;
  
  if (keyToUse) {
    setOpenAIKey(keyToUse);
    console.log('[OpenAI] Автоматически настроен ключ для разработки');
    console.warn('[OpenAI] ⚠️ НЕ ИСПОЛЬЗУЙТЕ В ПРОДАКШЕНЕ!');
  } else {
    console.log('[OpenAI] Ключ не найден. Настройте вручную в настройках приложения');
  }
}

// Экспортируем все для удобного использования в консоли разработчика
if (typeof window !== 'undefined') {
  (window as any).openai = {
    setup: setOpenAIKey,
    clear: clearOpenAIKey,
    test: testOpenAIConnection,
    isConfigured: isOpenAIConfigured,
    mask: maskApiKey,
  };
  
  // Проверяем настройку при загрузке
  const configured = isOpenAIConfigured();
  
  if (configured) {
    const key = getOpenAIKey()!;
    console.log(
      '%c✅ OpenAI настроен%c\n' +
      `Ключ: ${maskApiKey(key)}\n` +
      'Проверить подключение: %cawait window.openai.test()%c\n' +
      'Подробнее: README_OPENAI.md',
      'color: #10a37f; font-weight: bold; font-size: 14px',
      'color: inherit',
      'color: #0066cc; background: #f0f0f0; padding: 2px 4px; border-radius: 3px',
      'color: inherit'
    );
  } else {
    console.log(
      '%c🤖 OpenAI AI Генерация документов%c\n\n' +
      '📝 Быстрая настройка:\n' +
      '%c  window.openai.setup("ваш-api-ключ")%c\n\n' +
      '📊 Доступные команды:\n' +
      '  • window.openai.setup("ключ") - установить ключ\n' +
      '  • window.openai.test() - проверить подключение\n' +
      '  • window.openai.clear() - удалить ключ\n' +
      '  • window.openai.isConfigured() - проверить настройку\n\n' +
      '📖 Полная документация: README_OPENAI.md',
      'color: #10a37f; font-weight: bold; font-size: 16px',
      'color: inherit',
      'color: #0066cc; background: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-family: monospace',
      'color: inherit'
    );
  }
}
