// WS-шлюз чатов (stage 7; stage 11 — делегирование истории; chats-social —
// события reaction/chat_deleted): замена MessagesController за портом
// ChatMessagesPort. Единственная реализация — own-адаптер
// (cookie-аутентификация + события message/history/reaction/chat_deleted;
// cutover 2026-10-16 убрал курсный адаптер). Чистая функция appendMessages
// вынесена для детерминированных тестов слияния истории.
//
// События reaction/chat_deleted адаптер не обрабатывает сам: бизнес-логика
// (viewer-side чипы, сброс выбранного чата) живёт в контроллере фичи, поэтому
// шлюз держит регистрируемых слушателей — тот же паттерн attachPort, что у
// history-модуля (прямой импорт контроллера дал бы цикл
// controller → gateway → own → controller).

import type { Message } from '../../../utils/types.ts'
import type { ChatMessagesPort, ChatReactionEvent } from '../ports.ts'
import { chatHistoryController } from '../history/controller.ts'
import { OwnWsAdapter } from './own.ts'

// Входящая пачка (одиночное сообщение или история) приклеивается к текущей;
// история приходит убыванием (новые сначала) — разворачивается.
export function appendMessages(current: Message[], incoming: Message | Message[]): Message[] {
    const batch = Array.isArray(incoming) ? [...incoming].reverse() : [incoming]

    return [...current, ...batch]
}

// eslint-disable-next-line no-unused-vars
type ReactionListener = (event: ChatReactionEvent) => void
// eslint-disable-next-line no-unused-vars
type ChatDeletedListener = (chatId: number) => void

export interface ChatsEventListeners {

    onReaction?: ReactionListener

    onChatDeleted?: ChatDeletedListener
}

let reactionListener: ReactionListener | null = null
let chatDeletedListener: ChatDeletedListener | null = null

// Адаптеры зовут notify-* из своих WS-обработчиков; слушатели назначает
// контроллер фичи через setChatsEventListeners (конструкторская регистрация)
export function setChatsEventListeners(listeners: ChatsEventListeners): void {
    if (listeners.onReaction !== undefined) {
        reactionListener = listeners.onReaction
    }

    if (listeners.onChatDeleted !== undefined) {
        chatDeletedListener = listeners.onChatDeleted
    }
}

export function notifyReactionEvent(event: ChatReactionEvent): void {
    reactionListener?.(event)
}

export function notifyChatDeleted(chatId: number): void {
    chatDeletedListener?.(chatId)
}

const adapter = new OwnWsAdapter()

export const chatMessagesPort: ChatMessagesPort = {
    sendMessage: (chatId, message, replyToId) => adapter.sendMessage(chatId, message, replyToId),
    // Токен — историческая часть сигнатуры порта (cookie-аутентификация его
    // не использует): контроллерский цикл getToken → connect не меняется
    connect: chatId => adapter.connect(chatId),
    loadHistory: (chatId, beforeId, limit) => adapter.loadHistory(chatId, beforeId, limit),
    closeChat: chatId => adapter.closeChat(chatId),
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
