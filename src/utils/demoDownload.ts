/**
 * Утилита для безопасной загрузки файлов в демо-режиме
 * Вместо попыток загрузить файлы с несуществующего сервера,
 * создаем локальные demo файлы
 */

export function createDemoDocumentContent(data: {
  projectName?: string;
  period?: string;
  status?: string;
  fileName?: string;
}): string {
  const lines = [];
  
  lines.push('='.repeat(50));
  lines.push('ДЕМО ДОКУМЕНТ');
  lines.push('='.repeat(50));
  lines.push('');
  
  if (data.projectName) {
    lines.push(`Проект: ${data.projectName}`);
  }
  
  if (data.period) {
    lines.push(`Период: ${data.period}`);
  }
  
  if (data.status) {
    lines.push(`Статус: ${data.status}`);
  }
  
  if (data.fileName) {
    lines.push(`Файл: ${data.fileName}`);
  }
  
  lines.push('');
  lines.push('-'.repeat(50));
  lines.push('');
  lines.push('Это демо-файл для тестирования.');
  lines.push('');
  lines.push('В продакшене здесь будет реальный документ,');
  lines.push('загруженный с сервера.');
  lines.push('');
  lines.push(`Сгенерирован: ${new Date().toLocaleString('ru-RU')}`);
  lines.push('');
  lines.push('='.repeat(50));
  
  return lines.join('\n');
}

export function downloadDemoFile(content: string, filename: string): void {
  try {
    const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.txt') ? filename : filename + '.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('[demoDownload] Failed to download file:', error);
    throw error;
  }
}
