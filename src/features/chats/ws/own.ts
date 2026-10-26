// Реализация WS-шлюза собственного бэкенда (stage 7; stage 11 — история через
// history-модуль; stage chats-social — реакции, реплаи, chat_deleted;
// 2026-10-26-chat-search — подъём last_message в списке):
// cookie-аутентификация (токен не нужен — URL /ws/chats/{chatId} от env.wsUrl),
// события бэкенда:
//   исходящие: {type:'message', content:{content, file_id?, client_message_id?, reply_to_id?}},
//              {type:'history', content:{before_id, limit}},
//              {type:'ping', content:{}}
//   входящие:  {type:'message', content:MessageResponse} (broadcast, включая эхо),
//              {type:'history', content:{messages, next_before_id, ...}},
//              {type:'reaction', content:{chat_id, message_id, user_id, emoji, active}}
//              — пересобирается в контроллерский слушатель через gateway,
//              {type:'chat_deleted', content:{chat_id}} — сокет чата закрывается,
//              событие уходит контроллеру,
//              {type:'pong'} / ошибки — игнорируются.
// MessageResponse {id, chat_id, user_id, content, file_id, client_message_id,
// reply_to_id, reply_to, reactions, created_at} маппится на DTO Message:
// created_at → time, file_id → file_url (filesUrl + /{file_id}/download),
// reply_to → replyTo, reactions проходят как есть (mine относительно
// запросившего историю); id сохраняется — дедупликация истории (stage 11)
// идёт по нему. История приходит убыванием (desc) — единственный reverse
// делает merge истории (RV1: без второго разворота).

import WSTransport, { WSTransportEvents } from '../../../utils/WSTransport.ts'
import { env, joinUrl } from '../../../utils/env.ts'
import store from '../../../utils/Store.ts'
import type { Message, MessageReplyTo, ReactionSummary } from '../../../utils/types.ts'
import { chatHistoryController } from '../history/controller.ts'
import type { HistoryMessage } from '../history/types.ts'
// Регистрация хелпера ChatHistory для messenger.hbs: модуль истории попадает
// в бандл через импорт ws-адаптера (components фичи не импортируют —
// guard-блокер).
import '../history/view.ts'
import { appendMessages, notifyChatDeleted, notifyReactionEvent } from './gateway.ts'

interface OwnMessageResponse {
    id: number
    chat_id: number
    user_id: number
    content: string | null
    file_id: number | null
    client_message_id: string | null
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

// Контент события — скаляр (текст сообщения) или объект (history/ping);
// транспорт сериализует его в JSON как есть.
function sendOwnEvent(
    socket: WSTransport,
    event: { type: string; content?: string | Record<string, unknown> }
): void {
    socket.send(event)
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
        file_url: response.file_id == null
            ? undefined
            : joinUrl(env.filesUrl, `/${response.file_id}/download`),
        // id-цепочка ответа: и прямой id цели, и серверный снимок цитаты
        replyToId: response.reply_to_id ?? undefined,
        replyTo,
        reactions,
    }
}

// Счётчик непрочитанных в реальном времени: чужое сообщение в чате,
// который сейчас не открыт, сразу поднимает пилюлю в списке — без ожидания
// перечитывания GET /chats. Свои сообщения не считаются (как и на бэкенде),
// открытый чат прочитан по определению (last_read уходит с выдачей истории)
function incrementUnread(chatId: number, authorId: number): void {
    const state = store.getState()

    if (state.selectedChat === chatId) {
        return
    }

    if (state.user?.id === authorId) {
        return
    }

    const chats = (state.chats ?? []).map(chat =>
        (chat as { id?: number }).id === chatId
            ? { ...chat, unread_count: ((chat as { unread_count?: number }).unread_count ?? 0) + 1 }
            : chat)

    store.set('chats', chats)
}

// Подъём чата по активности (2026-10-26-chat-search): каждое сообщение,
// пришедшее по WS, патчит last_message в списке — сортировку по нему делает
// страница. Сервер рассылает broadcast всем сокетам чата, включая сокет
// автора, поэтому одно место поднимает и входящие, и собственные отправки;
// отдельного патча на пути отправки нет и быть не должно (двойная запись).
// Читаем RAW-поле OwnMessageResponse: toMessage схлопывает файловый null
// в '' и плейсхолдер «Вложение» был бы потерян
function liftLastMessage(chatId: number, payload: OwnMessageResponse): void {
    const chats = (store.getState().chats ?? []).map(chat =>
        (chat as { id?: number }).id === chatId
            ? { ...chat, last_message: { content: payload.content ?? 'Вложение', time: payload.created_at } }
            : chat)

    store.set('chats', chats)
}

export class OwnWsAdapter {
    private sockets: Map<number, WSTransport> = new Map()

    async connect(id: number): Promise<void> {
        if (this.sockets.has(id)) {
            return
        }

        const wsTransport = new WSTransport(ownChatUrl(id))

        this.sockets.set(id, wsTransport)

        // Подписки регистрируются до connect(): Connected стреляет синхронно
        // на open — подписка после await connect() пропустила бы первое
        // открытие сокета.
        wsTransport.on(WSTransportEvents.Connected, () => {
            // HD-R2: первичная история запрашивается из единственного места —
            // здесь. Connected срабатывает и на первом open, и на внутреннем
            // backoff-реконнекте, поэтому после обрыва страница пере-запрашивается.
            // Висящий «загрузить ещё» ответа уже не получит (сокет умер) —
            // сбрасываем pending-флаг, иначе свежая первичная страница была бы
            // ошибочно смержена как ответ на подгрузку (переворот порядка).
            chatHistoryController.resetPendingLoad(id)
            sendOwnEvent(wsTransport, { type: 'history', content: { before_id: null, limit: 50 } })
        })

        wsTransport.on(WSTransportEvents.Message, event => {
            const wsEvent = event as OwnWsEvent

            if (wsEvent.type === 'message' && wsEvent.content != null) {
                const raw = wsEvent.content as OwnMessageResponse
                const message = toMessage(raw)

                store.set(`messages.${id}`, appendMessages(
                    store.getState().messages?.[id] ?? [],
                    message
                ))
                incrementUnread(id, message.user_id)
                liftLastMessage(id, raw)

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

                return
            }

            // Реакция: сводку не верим (mine в broadcast относителен
            // отправителя действия) — пересылаем событие контроллеру,
            // тот пересчитывает чипы viewer-side
            if (wsEvent.type === 'reaction' && wsEvent.content != null) {
                const content = wsEvent.content as {
                    chat_id: number
                    message_id: number
                    user_id: number
                    emoji: string
                    active: boolean
                }

                notifyReactionEvent({
                    chat_id: content.chat_id,
                    message_id: content.message_id,
                    user_id: content.user_id,
                    emoji: content.emoji,
                    active: content.active,
                })

                return
            }

            // Чат удалён владельцем: событие уходит контроллеру (сброс выбора,
            // обновление списка), собственный сокет закрываем явно — без
            // реконнекта в удалённый чат
            if (wsEvent.type === 'chat_deleted' && wsEvent.content != null) {
                const chatId = (wsEvent.content as { chat_id: number }).chat_id

                void this.closeChat(chatId)
                notifyChatDeleted(chatId)
            }
        })
        wsTransport.on(WSTransportEvents.Close, () => this.sockets.delete(id))

        await wsTransport.connect()
    }

    sendMessage(id: number, message: string, replyToId?: number): Promise<void> {
        const socket = this.sockets.get(id)

        if (!socket) {
            return Promise.reject(new Error(`Chat ${id} is not connected`))
        }

        if (replyToId != null) {
            // ответ на сообщение: объект-контраткт с reply_to_id
            sendOwnEvent(socket, { type: 'message', content: { content: message, reply_to_id: replyToId } })
        } else {
            // бэкенд принимает и скалярный content (оборачивает в {'content': value})
            socket.send({ type: 'message', content: message })
        }

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

    // Явное закрытие сокета чата (chat_deleted): транспорт не реконнектит
    closeChat(id: number): Promise<void> {
        this.sockets.get(id)?.close()

        return Promise.resolve()
    }

    closeAll(): void {
        this.sockets.forEach(socket => socket.close())
        this.sockets.clear()
    }
}
