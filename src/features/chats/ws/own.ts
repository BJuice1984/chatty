// Own-реализация WS-шлюза (stage 7; stage 11 — история через history-модуль):
// cookie-аутентификация (токен не нужен — URL /ws/chats/{chatId} от env.wsUrl),
// события бэкенда:
//   исходящие: {type:'message', content:{content, file_id?, client_message_id?}},
//              {type:'history', content:{before_id, limit}}
//   входящие:  {type:'message', content:MessageResponse} (broadcast, включая эхо),
//              {type:'history', content:{messages, next_before_id, ...}},
//              {type:'pong'} / ошибки — игнорируются.
// MessageResponse {id, chat_id, user_id, content, file_id, client_message_id,
// created_at} маппится на DTO Message: created_at → time, file_id → file_url
// (filesUrl + /{file_id}/download); id сохраняется — дедупликация истории
// (stage 11) идёт по нему. История приходит убыванием (desc) — единственный
// reverse делает merge истории (RV1: без второго разворота).

import WSTransport, { WSTransportEvents } from '../../../utils/WSTransport.ts'
import { env, joinUrl } from '../../../utils/env.ts'
import store from '../../../utils/Store.ts'
import type { Message } from '../../../utils/types.ts'
import { chatHistoryController } from '../history/controller.ts'
import type { HistoryMessage } from '../history/types.ts'
// Регистрация хелпера ChatHistory для messenger.hbs: модуль истории попадает
// в бандл в обоих режимах через импорт ws-адаптеров (components фичи не
// импортируют — guard-блокер).
import '../history/view.ts'
import { appendMessages } from './gateway.ts'

interface OwnMessageResponse {
    id: number
    chat_id: number
    user_id: number
    content: string | null
    file_id: number | null
    client_message_id: string | null
    created_at: string
}

interface OwnWsEvent {
    type: string
    content: unknown
}

interface OwnHistoryContent {
    messages: OwnMessageResponse[]
    next_before_id: number | null
}

export function ownChatUrl(chatId: number): string {
    return joinUrl(env.wsUrl, `/ws/chats/${chatId}`)
}

// WSTransportMessage контрактен Практикуму (content?: string); own-протоколу для
// history нужен объект в content — транспорт сериализует JSON как есть, мост
// через структурный каст (WSTransport — readOnly, принадлежит stage 1).
function sendOwnEvent(socket: WSTransport, event: { type: string; content?: unknown }): void {
    socket.send(event as unknown as { type: string; content?: string })
}

export function toMessage(response: OwnMessageResponse): Message {
    return {
        // id нужен дедупликации истории: DTO Message не объявляет его, но
        // индексная сигнатура пропускает — читает локальный HistoryMessage
        id: response.id,
        chat_id: response.chat_id,
        time: response.created_at,
        type: 'message',
        user_id: response.user_id,
        content: response.content ?? '',
        file_url: response.file_id == null
            ? undefined
            : joinUrl(env.filesUrl, `/${response.file_id}/download`),
    }
}

export class OwnWsAdapter {
    private sockets: Map<number, WSTransport> = new Map()

    async connect(id: number): Promise<void> {
        if (this.sockets.has(id)) {
            return
        }

        const wsTransport = new WSTransport(ownChatUrl(id))

        this.sockets.set(id, wsTransport)

        await wsTransport.connect()

        wsTransport.on(WSTransportEvents.Message, event => {
            const wsEvent = event as OwnWsEvent

            if (wsEvent.type === 'message' && wsEvent.content != null) {
                store.set(`messages.${id}`, appendMessages(
                    store.getState().messages?.[id] ?? [],
                    toMessage(wsEvent.content as OwnMessageResponse)
                ))

                return
            }

            if (wsEvent.type === 'history' && wsEvent.content != null) {
                const content = wsEvent.content as OwnHistoryContent
                // desc-порядок бэкенда передаётся как есть — reverse за merge
                const incoming = content.messages.map(toMessage) as HistoryMessage[]

                // Ответ на «загрузить ещё» — prepend через history-модуль;
                // первичная история (connect/реконнект) — append с
                // дедупликацией и инициализацией курсора next_before_id.
                if (chatHistoryController.isLoadPending(id)) {
                    chatHistoryController.applyOlderHistory(id, incoming, content.next_before_id)
                } else {
                    chatHistoryController.applyInitialHistory(id, incoming, content.next_before_id)
                }
            }
        })
        wsTransport.on(WSTransportEvents.Close, () => this.sockets.delete(id))

        sendOwnEvent(wsTransport, { type: 'history', content: { before_id: null, limit: 50 } })
    }

    sendMessage(id: number, message: string): Promise<void> {
        const socket = this.sockets.get(id)

        if (!socket) {
            return Promise.reject(new Error(`Chat ${id} is not connected`))
        }

        // бэкенд принимает и скалярный content (оборачивает в {'content': value})
        socket.send({ type: 'message', content: message })

        return Promise.resolve()
    }

    // «Загрузить ещё»: before_id + limit; ответ придёт событием history и
    // уйдёт в applyOlderHistory (курсор/merge живут в history-модуле).
    loadHistory(id: number, beforeId: number | null, limit: number): Promise<void> {
        const socket = this.sockets.get(id)

        if (!socket) {
            return Promise.reject(new Error(`Chat ${id} is not connected`))
        }

        sendOwnEvent(socket, { type: 'history', content: { before_id: beforeId, limit } })

        return Promise.resolve()
    }

    closeAll(): void {
        this.sockets.forEach(socket => socket.close())
        this.sockets.clear()
    }
}
