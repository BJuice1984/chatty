// Слайс состояния истории (stage 11): ключ chatHistory в Store, значение —
// Map «chatId → ChatHistoryState». Store.ts писать нельзя (AppState закрыт)
// — тот же каст-идиом, что у aiAssistantSlice/chatsSlice: типы во фиче,
// чтение через приведение AppState.

import store, { AppState } from '../../../utils/Store.ts'
import { CHAT_HISTORY_INITIAL_STATE, type ChatHistoryState } from './types.ts'

type ChatHistoryStoreState = AppState & { chatHistory?: Record<number, ChatHistoryState> }

function historyMap(state: AppState): Record<number, ChatHistoryState> {
    return (state as ChatHistoryStoreState).chatHistory ?? {}
}

export interface ChatHistorySlice {
    // eslint-disable-next-line no-unused-vars
    getHistory(chatId: number): ChatHistoryState
    // eslint-disable-next-line no-unused-vars
    patchHistory(chatId: number, patch: Partial<ChatHistoryState>): void
    // eslint-disable-next-line no-unused-vars
    resetHistory(chatId: number): void
}

export const chatHistorySlice: ChatHistorySlice = {
    getHistory(chatId) {
        return historyMap(store.getState())[chatId] ?? CHAT_HISTORY_INITIAL_STATE
    },

    patchHistory(chatId, patch) {
        const current = historyMap(store.getState())[chatId] ?? CHAT_HISTORY_INITIAL_STATE

        store.set('chatHistory', {
            ...historyMap(store.getState()),
            [chatId]: { ...current, ...patch },
        })
    },

    resetHistory(chatId) {
        // helpers.set (Store) глубоко мержит: удаление ключа через
        // set('chatHistory', map-без-чата) не работает — возвращаем
        // инициализирующее состояние поверх.
        chatHistorySlice.patchHistory(chatId, CHAT_HISTORY_INITIAL_STATE)
    },
}
