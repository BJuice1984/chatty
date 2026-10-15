// Чистые функции слияния истории (stage 11): дедупликация и порядок. Вынесены
// из контроллера для детерминированных тестов — прецедент appendMessages
// в ws/gateway.ts.

import type { Message } from '../../../utils/types.ts'
import type { HistoryMessage } from './types.ts'

// Ключ дедупликации: числовой id, когда сообщение его несёт (own прикладывает
// из OwnMessageResponse, practicum — raw-JSON), иначе составной ключ строки
// сообщения — идентичный контент в одну секунду схлопывается (лучшее, что
// даёт practicum-DTO без id).
export function historyMessageKey(message: HistoryMessage): string {
    if (typeof message.id === 'number') {
        return `id:${message.id}`
    }

    return [message.chat_id, message.user_id, message.time, message.content].join('|')
}

// Приклейка пачки истории: бэкенд отдаёт убыванием (desc) — один reverse
// (RV1: без второго разворота), затем дедупликация против уже загруженного.
// place: 'append' — первичная история/реконнект, 'prepend' — «загрузить ещё».
export function mergeHistoryMessages(
    current: Message[],
    incoming: HistoryMessage[],
    place: 'append' | 'prepend'
): Message[] {
    const batch = [...incoming].reverse()

    const seen = new Set(current.map(message => historyMessageKey(message as HistoryMessage)))

    const fresh = batch.filter(message => {
        const key = historyMessageKey(message)

        if (seen.has(key)) {
            return false
        }

        seen.add(key)

        return true
    })

    return place === 'prepend' ? [...fresh, ...current] : [...current, ...fresh]
}

// Самый старый числовой id пачки — курсор practicum-режима для следующего
// 'get old'. Бэкенд отдаёт убыванием (desc: новые первыми), поэтому «первый
// элемент» был бы новейшим id — берём минимум числовых id, не завися от
// порядка. null — числовых id нет.
export function oldestMessageId(messages: Message[]): number | null {
    let oldest: number | null = null

    for (const message of messages) {
        const id = (message as HistoryMessage).id

        if (typeof id === 'number' && (oldest === null || id < oldest)) {
            oldest = id
        }
    }

    return oldest
}
