// МОК (2026-11-02-ui-ux): список «документов, найденных ботом» для ответов
// бота в AI-чатах. Бот отключён, реального контракта множественных вложений
// у сообщения нет — модуль даёт демо-имена для UI-списка файлов. УДАЛИТЬ
// модуль вместе с его вызовом в messenger.ts, когда бэкенд начнёт
// возвращать реальные имена найденных файлов (RAG top-k по ответу).
// Все пункты указывают на настоящий URL скачивания ответа бота.

import type { MessageAttachment } from '../../utils/types.ts'

// Имена демонстрационных документов (расширения дают иконки pdf/xlsx/doc)
export const MOCK_BOT_DOCUMENTS: readonly string[] = [
    'Заявление на отпуск.pdf',
    'Бюджет отдела 2026.xlsx',
    'Инструкция по отчётам.docx',
]

// Список вложений ответа бота: первый пункт — реальное имя файла ответа,
// когда контракт его несёт (сегодня file.filename не наполняется — фикстуры
// тестов), остальные — мок-имена; URL у всех один — безопасный fileUrl
// ответа, мок никогда не подставляет собственный URL
export function mockBotAttachments(url: string, realName?: string): MessageAttachment[] {
    const names = realName != null && realName !== ''
        ? [realName, ...MOCK_BOT_DOCUMENTS.slice(1)]
        : [...MOCK_BOT_DOCUMENTS]

    return names.map(name => ({ name, url }))
}
