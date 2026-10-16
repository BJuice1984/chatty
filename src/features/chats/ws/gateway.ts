// WS-шлюз чатов (stage 7; stage 11 — делегирование истории): замена
// MessagesController за портом ChatMessagesPort. Единственная реализация —
// own-адаптер (cookie-аутентификация + события message/history; cutover
// 2026-10-16 убрал курсный адаптер). Чистая функция appendMessages вынесена
// для детерминированных тестов слияния истории.

import type { Message } from '../../../utils/types.ts'
import type { ChatMessagesPort } from '../ports.ts'
import { chatHistoryController } from '../history/controller.ts'
import { OwnWsAdapter } from './own.ts'

// Входящая пачка (одиночное сообщение или история) приклеивается к текущей;
// история приходит убыванием (новые сначала) — разворачивается.
export function appendMessages(current: Message[], incoming: Message | Message[]): Message[] {
    const batch = Array.isArray(incoming) ? [...incoming].reverse() : [incoming]

    return [...current, ...batch]
}

const adapter = new OwnWsAdapter()

export const chatMessagesPort: ChatMessagesPort = {
    sendMessage: (chatId, message) => adapter.sendMessage(chatId, message),
    // Токен — историческая часть сигнатуры порта (cookie-аутентификация его
    // не использует): контроллерский цикл getToken → connect не меняется
    connect: chatId => adapter.connect(chatId),
    loadHistory: (chatId, beforeId, limit) => adapter.loadHistory(chatId, beforeId, limit),
}

// Контроллер истории шлёт «загрузить ещё» через порт, но не импортирует
// шлюз сам: own-адаптер уже тянет history-модуль за merge/курсором, прямая
// связь controller → gateway дала бы цикл gateway → own → controller →
// gateway. Шлюз подключает порт после сборки адаптера.
chatHistoryController.attachPort(chatMessagesPort)

// Наблюдаемое чистое закрытие сокетов для smoke-флоу CUTOVER-WS-CLOSE
export function closeAllChatSockets(): void {
    adapter.closeAll()
}
