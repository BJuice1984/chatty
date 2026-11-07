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

// Чат переименован (2026-11-05-messenger-ux-pack): {chat_id, title}
// eslint-disable-next-line no-unused-vars
type ChatRenamedListener = (event: { chat_id: number, title: string }) => void

// Бот включён в чате (2026-11-06-chat-create-flow): {chat_id, is_ai}
// eslint-disable-next-line no-unused-vars
type ChatAiToggledListener = (event: { chat_id: number, is_ai: boolean }) => void

// Состав чата изменился (2026-11-07): kind-строки chat_member_* приезжают
// обычным 'message'-событием — шлюз дергает слушателя, контроллер рефетчит
// состав открытого чата (новый участник появляется, ушедший гаснет по
// left_at, кикнутый исчезает)
// eslint-disable-next-line no-unused-vars
type ChatMembersChangedListener = (chatId: number) => void

// Аватар чата обновлён (2026-11-07): {chat_id, avatar} — патч chats-слайса
// у остальных клиентов (плитка списка и шапка без рефетча)
// eslint-disable-next-line no-unused-vars
type ChatAvatarUpdatedListener = (event: { chat_id: number, avatar: string }) => void

// eslint-disable-next-line no-unused-vars
type WsUnexpectedCloseListener = (chatId: number) => void
// eslint-disable-next-line no-unused-vars
type WsConnectedListener = (chatId: number) => void

export interface ChatsEventListeners {

    onReaction?: ReactionListener

    onChatDeleted?: ChatDeletedListener

    onChatRenamed?: ChatRenamedListener

    onChatAiToggled?: ChatAiToggledListener

    onChatMembersChanged?: ChatMembersChangedListener

    onChatAvatarUpdated?: ChatAvatarUpdatedListener

    // Индикатор смерти WS (2026-11-04 offline, review F-3): Close транспорта
    // без payload неотличим от исчерпания реконнектов — адаптер дифференцирует
    // намеренность собственными марками и нотифицирует ТОЛЬКО немаркированные
    // (исчерпавшиеся) закрытия; Connected гасит индикатор
    onWsUnexpectedClose?: WsUnexpectedCloseListener

    onWsConnected?: WsConnectedListener
}

let reactionListener: ReactionListener | null = null
let chatDeletedListener: ChatDeletedListener | null = null
let chatRenamedListener: ChatRenamedListener | null = null
let chatAiToggledListener: ChatAiToggledListener | null = null
let chatMembersChangedListener: ChatMembersChangedListener | null = null
let chatAvatarUpdatedListener: ChatAvatarUpdatedListener | null = null
let wsUnexpectedCloseListener: WsUnexpectedCloseListener | null = null
let wsConnectedListener: WsConnectedListener | null = null

// Адаптеры зовут notify-* из своих WS-обработчиков; слушатели назначает
// контроллер фичи через setChatsEventListeners (конструкторская регистрация)
export function setChatsEventListeners(listeners: ChatsEventListeners): void {
    if (listeners.onReaction !== undefined) {
        reactionListener = listeners.onReaction
    }

    if (listeners.onChatDeleted !== undefined) {
        chatDeletedListener = listeners.onChatDeleted
    }

    if (listeners.onChatRenamed !== undefined) {
        chatRenamedListener = listeners.onChatRenamed
    }

    if (listeners.onChatAiToggled !== undefined) {
        chatAiToggledListener = listeners.onChatAiToggled
    }

    if (listeners.onChatMembersChanged !== undefined) {
        chatMembersChangedListener = listeners.onChatMembersChanged
    }

    if (listeners.onChatAvatarUpdated !== undefined) {
        chatAvatarUpdatedListener = listeners.onChatAvatarUpdated
    }

    if (listeners.onWsUnexpectedClose !== undefined) {
        wsUnexpectedCloseListener = listeners.onWsUnexpectedClose
    }

    if (listeners.onWsConnected !== undefined) {
        wsConnectedListener = listeners.onWsConnected
    }
}

export function notifyReactionEvent(event: ChatReactionEvent): void {
    reactionListener?.(event)
}

export function notifyChatDeleted(chatId: number): void {
    chatDeletedListener?.(chatId)
}

export function notifyChatRenamed(event: { chat_id: number, title: string }): void {
    chatRenamedListener?.(event)
}

export function notifyChatAiToggled(event: { chat_id: number, is_ai: boolean }): void {
    chatAiToggledListener?.(event)
}

export function notifyChatMembersChanged(chatId: number): void {
    chatMembersChangedListener?.(chatId)
}

export function notifyChatAvatarUpdated(event: { chat_id: number, avatar: string }): void {
    chatAvatarUpdatedListener?.(event)
}

export function notifyWsUnexpectedClose(chatId: number): void {
    wsUnexpectedCloseListener?.(chatId)
}

export function notifyWsConnected(chatId: number): void {
    wsConnectedListener?.(chatId)
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

// Принудительный реконнект чат-сокетов (2026-11-04 offline, review F-7):
// дропает всё, что не OPEN — застрявший в backoff чат снова открываем
// (иначе гард sockets.has молчит до F5); открытые сокеты не трогаем.
// Вызывает онлайн-путь connectivity-наблюдателя; список переоткроет и
// ресинкнет fetchChats (Connected-ресync адаптера)
export function reconnectAllChatSockets(): void {
    adapter.reconnectAll()
}
