// Контроллер истории чата (stage 11): курсорная пагинация «загрузить ещё».
// Сама подгрузка — WS-запрос через порт ChatMessagesPort; ответ приходит
// событием Message в ws-адаптере, поэтому приклейку сообщений и обновление
// курсора делают applyInitialHistory/applyOlderHistory (их зовут адаптеры).
// Порт подключается шлюзом через attachPort: own/practicum уже импортируют
// этот модуль за merge/применением ответов — прямой импорт gateway создал бы
// цикл gateway → own → controller → gateway.

import store from '../../../utils/Store.ts'
import type { ChatMessagesPort } from '../ports.ts'
import { mergeHistoryMessages, oldestMessageId } from './merge.ts'
import { chatHistorySlice } from './store.ts'
import { CHAT_HISTORY_PAGE_LIMIT, type HistoryMessage } from './types.ts'

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export class ChatHistoryController {
    private port: ChatMessagesPort | null = null

    // Шлюз (ws/gateway.ts) подключает порт после сборки адаптера по env.mode.
    attachPort(port: ChatMessagesPort): void {
        this.port = port
    }

    // Адаптеры различают ответ на «загрузить ещё» от первичной истории.
    isLoadPending(chatId: number): boolean {
        return chatHistorySlice.getHistory(chatId).isLoading
    }

    // «Загрузить ещё»: не грузит параллельно, не идёт дальше курсора и не
    // стреляет до первичной истории (cursor === null). Ошибка запроса (сокета
    // нет) возвращается текстом в состояние — повтор клика возможен.
    loadOlder(chatId: number): void {
        const state = chatHistorySlice.getHistory(chatId)

        if (state.isLoading || !state.hasMore || state.cursor === null) {
            return
        }

        chatHistorySlice.patchHistory(chatId, { isLoading: true, error: '' })

        // Опциональный метод порта: шлюз всегда предоставляет его, тестовые
        // стабы без истории просто не дойдут сюда (cursor остаётся null).
        this.port?.loadHistory?.(chatId, state.cursor, CHAT_HISTORY_PAGE_LIMIT)
            .catch(error => {
                chatHistorySlice.patchHistory(chatId, {
                    isLoading: false,
                    error: errorText(error),
                })
            })
    }

    // Первичная история (connect/реконнект): append с дедупликацией (после
    // реконнекта повторная пачка не должна дублировать уже загруженное) и
    // инициализация курсора/признака «есть ещё».
    applyInitialHistory(chatId: number, incoming: HistoryMessage[], nextCursor: number | null): void {
        const current = store.getState().messages?.[chatId] ?? []

        store.set(`messages.${chatId}`, mergeHistoryMessages(current, incoming, 'append'))

        chatHistorySlice.patchHistory(chatId, {
            cursor: nextCursor,
            hasMore: incoming.length > 0 && nextCursor !== null,
            error: '',
        })
    }

    // Ответ на «загрузить ещё»: prepend старых сообщений с дедупликацией по
    // id (пересечения с живыми эхо-сообщениями схлопываются), курсор и флаг
    // «есть ещё» — из ответа; пустой ответ закрывает пагинацию.
    applyOlderHistory(chatId: number, incoming: HistoryMessage[], nextCursor: number | null): void {
        const current = store.getState().messages?.[chatId] ?? []

        store.set(`messages.${chatId}`, mergeHistoryMessages(current, incoming, 'prepend'))

        chatHistorySlice.patchHistory(chatId, {
            isLoading: false,
            cursor: nextCursor,
            hasMore: incoming.length > 0 && nextCursor !== null,
            error: '',
        })
    }

    // Курсор practicum-режима: 'get old' не возвращает next_before_id —
    // следующим before_id становится самый старый id пачки.
    static cursorForBatch(batch: HistoryMessage[]): number | null {
        return oldestMessageId(batch)
    }
}

export const chatHistoryController = new ChatHistoryController()
