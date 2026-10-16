// Контроллер истории чата (stage 11): курсорная пагинация «загрузить ещё».
// Сама подгрузка — WS-запрос через порт ChatMessagesPort; ответ приходит
// событием Message в ws-адаптере, поэтому приклейку сообщений и обновление
// курсора делают applyInitialHistory/applyOlderHistory (их зовут адаптеры).
// Порт подключается шлюзом через attachPort: own-адаптер уже импортирует
// этот модуль за merge/применением ответов — прямой импорт gateway создал бы
// цикл gateway → own → controller → gateway.

import store from '../../../utils/Store.ts'
import type { ChatMessagesPort } from '../ports.ts'
import { mergeHistoryMessages } from './merge.ts'
import { chatHistorySlice } from './store.ts'
import { CHAT_HISTORY_PAGE_LIMIT, type HistoryMessage } from './types.ts'

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

// Ответ идёт через WS-событие, промис loadHistory резолвится сразу: если
// событие потерялось (send на закрытом сокете молча отбрасывается браузером),
// loading завис бы навсегда (HD-R3) — таймаут возвращает строке рабочее
// состояние с кнопкой повтора.
const LOAD_TIMEOUT_MS = 10_000

// UX: успешный ответ приходит быстрее, чем глаз успевает заметить статус
// «Загружаем сообщения…» — после ответа держим его ещё 2 секунды.
const SUCCESS_STATUS_HOLD_MS = 2_000

export class ChatHistoryController {
    private port: ChatMessagesPort | null = null
    private loadTimers: Map<number, ReturnType<typeof setTimeout>> = new Map()
    private statusHoldTimers: Map<number, ReturnType<typeof setTimeout>> = new Map()

    private holdSuccessStatus(chatId: number): void {
        const timer = this.statusHoldTimers.get(chatId)

        if (timer !== undefined) {
            clearTimeout(timer)
        }

        this.statusHoldTimers.set(chatId, setTimeout(() => {
            this.statusHoldTimers.delete(chatId)
            chatHistorySlice.patchHistory(chatId, { isLoading: false })
        }, SUCCESS_STATUS_HOLD_MS))
    }

    private armLoadTimeout(chatId: number): void {
        this.clearLoadTimeout(chatId)
        this.loadTimers.set(chatId, setTimeout(() => {
            this.loadTimers.delete(chatId)

            if (chatHistorySlice.getHistory(chatId).isLoading) {
                chatHistorySlice.patchHistory(chatId, {
                    isLoading: false,
                    error: 'Не удалось загрузить историю — попробуйте ещё раз',
                })
            }
        }, LOAD_TIMEOUT_MS))
    }

    private clearLoadTimeout(chatId: number): void {
        const timer = this.loadTimers.get(chatId)

        if (timer !== undefined) {
            clearTimeout(timer)
            this.loadTimers.delete(chatId)
        }
    }

    // Шлюз (ws/gateway.ts) подключает порт после сборки адаптера по env.mode.
    attachPort(port: ChatMessagesPort): void {
        this.port = port
    }

    // Адаптеры различают ответ на «загрузить ещё» от первичной истории.
    isLoadPending(chatId: number): boolean {
        return chatHistorySlice.getHistory(chatId).isLoading
    }

    // Реконнект транспорта (HD-R2): ответ на висящий «загрузить ещё» уже не
    // придёт (сокет умер), а свежая первичная страница не должна быть принята
    // за него — сбрасываем pending-флаг и оба таймера (таймаут загрузки и
    // UX-удержание статуса), после чего ответ маршрутизируется в
    // applyInitialHistory.
    resetPendingLoad(chatId: number): void {
        this.clearLoadTimeout(chatId)

        const hold = this.statusHoldTimers.get(chatId)

        if (hold !== undefined) {
            clearTimeout(hold)
            this.statusHoldTimers.delete(chatId)
        }

        if (chatHistorySlice.getHistory(chatId).isLoading) {
            chatHistorySlice.patchHistory(chatId, { isLoading: false })
        }
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
        this.armLoadTimeout(chatId)

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
        this.clearLoadTimeout(chatId)
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
        this.clearLoadTimeout(chatId)
        const current = store.getState().messages?.[chatId] ?? []

        store.set(`messages.${chatId}`, mergeHistoryMessages(current, incoming, 'prepend'))

        chatHistorySlice.patchHistory(chatId, {
            cursor: nextCursor,
            hasMore: incoming.length > 0 && nextCursor !== null,
            error: '',
        })

        // Сообщения и курсор применены сразу, а статус «Загружаем сообщения…»
        // держим ещё 2 секунды — мгновенный сброс выглядит морганием
        this.holdSuccessStatus(chatId)
    }
}

export const chatHistoryController = new ChatHistoryController()
