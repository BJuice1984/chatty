// Локальные типы истории чата (stage 11): курсорная пагинация «загрузить ещё»
// поверх WS-шлюза. Типы живут во фиче — ядро (utils/Store) от них не зависит.

import type { Message } from '../../../utils/types.ts'

// Сообщение истории с идентичностью: DTO Message (utils/types.ts) не имеет id
// (техдолг stage 7), а дедупликация подгрузки требует ключа. own-адаптер
// прикладывает id из OwnMessageResponse (поле проходит через индексную
// сигнатуру Message без объявления).
export interface HistoryMessage extends Message {
    id?: number
}

// Состояние истории одного чата: курсор before_id (next_before_id из ответа
// бэкенда), флаги загрузки/наличия более старых сообщений и текстовая ошибка.
export interface ChatHistoryState {
    cursor: number | null
    isLoading: boolean
    hasMore: boolean
    error: string
}

// До первого ответа истории курсор неизвестен (null) — «загрузить ещё»
// заблокирован, primary-запрос истории шлют сами адаптеры при connect.
export const CHAT_HISTORY_INITIAL_STATE: ChatHistoryState = {
    cursor: null,
    isLoading: false,
    hasMore: true,
    error: '',
}

// Размер страницы подгрузки (limit запроса own-бэкенду).
export const CHAT_HISTORY_PAGE_LIMIT = 20
