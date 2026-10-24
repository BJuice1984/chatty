// Чистые функции слияния истории (stage 11): дедупликация и порядок. Вынесены
// из контроллера для детерминированных тестов — прецедент appendMessages
// в ws/gateway.ts.

import type { Message } from '../../../utils/types.ts'
import type { HistoryMessage } from './types.ts'

// Ключ дедупликации: числовой id, когда сообщение его несёт (own-адаптер
// прикладывает его из OwnMessageResponse), иначе составной ключ строки
// сообщения — идентичный контент в одну секунду схлопывается.
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

    const seen = new Set(current.map(message => historyMessageKey(message)))

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
