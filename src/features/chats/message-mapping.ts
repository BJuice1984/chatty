// Отображение серверного ответа сообщения (REST-страница истории и WS
// broadcast используют один контракт) в Message стора. Общий модуль уровня
// фичи: его импортируют и api/own (REST-fallback хвоста истории), и ws/own
// (live-доставка) — прямой импорт между адаптерами создавал цикл

import { env, joinUrl } from '../../utils/env.ts'
import type { Message, MessageReplyTo, ReactionSummary } from '../../utils/types.ts'

export interface OwnMessageResponse {
    id: number
    chat_id: number
    user_id: number
    content: string | null
    file_id: number | null
    // исходное имя файла вложения (2026-11-06): без него пункт вложения
    // показывает фолбэк «Файл»
    file_name?: string | null
    client_message_id: string | null
    // маркер служебного сообщения (messages.kind, 2026-11-05): null/нет поля —
    // обычное сообщение
    kind?: string | null
    reply_to_id?: number | null
    reply_to?: {
        id: number
        user_id: number
        snippet: string
    } | null
    reactions?: {
        emoji: string
        count: number
        mine: boolean
    }[]
    created_at: string
}

export function toMessage(response: OwnMessageResponse): Message {
    // цитата-снимок сервера: пользователь не авторство, snippet достаточно
    const replyTo: MessageReplyTo | null = response.reply_to == null
        ? null
        : {
            id: response.reply_to.id,
            user_id: response.reply_to.user_id,
            snippet: response.reply_to.snippet,
        }
    const reactions: ReactionSummary[] = (response.reactions ?? []).map(item => ({
        emoji: item.emoji,
        count: item.count,
        mine: item.mine,
    }))

    return {
        // id нужен дедупликации истории и ключом реакций/реплаев
        id: response.id,
        chat_id: response.chat_id,
        time: response.created_at,
        type: 'message',
        user_id: response.user_id,
        content: response.content ?? '',
        // служебный маркер проходит насквозь (UI рисует строку без пузыря)
        kind: response.kind ?? undefined,
        // имя файла вложения: маппер messenger строит пункт вложения с
        // именем и иконкой по расширению (фолбэк — безликое «Файл»)
        file_name: response.file_name ?? undefined,
        file_url: response.file_id == null
            ? undefined
            : joinUrl(env.filesUrl, `/${response.file_id}/download`),
        // id-цепочка ответа: и прямой id цели, и серверный снимок цитаты
        replyToId: response.reply_to_id ?? undefined,
        replyTo,
        reactions,
    }
}
