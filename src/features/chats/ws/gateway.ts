// WS-шлюз чатов (stage 7; stage 11 — делегирование истории): замена
// MessagesController за портом ChatMessagesPort. Выбор реализации — env.mode
// (practicum: токен в URL + 'get old'; own: cookie-auth + события
// message/history). Чистая функция appendMessages вынесена для
// детерминированных тестов слияния истории.

import { env } from '../../../utils/env.ts'
import type { Message } from '../../../utils/types.ts'
import type { ChatMessagesPort } from '../ports.ts'
import { chatHistoryController } from '../history/controller.ts'
import { OwnWsAdapter } from './own.ts'
import { PracticumWsAdapter } from './practicum.ts'

// Входящая пачка (одиночное сообщение или история) приклеивается к текущей;
// история приходит убыванием (новые сначала) — разворачивается.
export function appendMessages(current: Message[], incoming: Message | Message[]): Message[] {
    const batch = Array.isArray(incoming) ? [...incoming].reverse() : [incoming]

    return [...current, ...batch]
}

const adapter = env.mode === 'own' ? new OwnWsAdapter() : new PracticumWsAdapter()

export const chatMessagesPort: ChatMessagesPort = {
    sendMessage: (chatId, message) => adapter.sendMessage(chatId, message),
    connect: (chatId, token) => adapter.connect(chatId, token),
    loadHistory: (chatId, beforeId, limit) => adapter.loadHistory(chatId, beforeId, limit),
}

// Контроллер истории шлёт «загрузить ещё» через порт, но не импортирует
// шлюз сам: own/practicum уже тянут history-модуль за merge/курсором, прямая
// связь controller → gateway дала бы цикл gateway → own → controller →
// gateway. Шлюз подключает порт после сборки адаптера.
chatHistoryController.attachPort(chatMessagesPort)

// Наблюдаемое чистое закрытие сокетов для smoke-флоу CUTOVER-WS-CLOSE
export function closeAllChatSockets(): void {
    adapter.closeAll()
}
