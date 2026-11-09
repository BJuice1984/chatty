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
// 2026-11-01-settings: шов доставки фоновых сообщений — звук (WebAudio-пинг
// без ассета, контекст ленивый) и браузерное уведомление (только при
// выданном разрешении и скрытой вкладке) для чужого сообщения в чате,
// который сейчас не открыт (шлюз открытого чата — сам мессенджер).

import WSTransport, { WSTransportEvents } from '../../../utils/WSTransport.ts'
import { env, joinUrl } from '../../../utils/env.ts'
import store from '../../../utils/Store.ts'
import type { Message } from '../../../utils/types.ts'
import { getPreferences, notificationPermission } from '../../../utils/preferences.ts'
import { type OwnMessageResponse, toMessage } from '../message-mapping.ts'
import { chatHistoryController } from '../history/controller.ts'
import type { HistoryMessage } from '../history/types.ts'
// Регистрация хелпера ChatHistory для messenger.hbs: модуль истории попадает
// в бандл через импорт ws-адаптера (components фичи не импортируют —
// guard-блокер).
import '../history/view.ts'
import { appendMessages, notifyChatAiToggled, notifyChatAvatarUpdated, notifyChatDeleted, notifyChatMembersChanged, notifyChatRenamed, notifyReactionEvent, notifyUserAvatarUpdated, notifyWsConnected, notifyWsUnexpectedClose } from './gateway.ts'

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

// toMessage и OwnMessageResponse живут в общем модуле фичи
// (message-mapping.ts) — их используют REST- и WS-адаптеры; здесь
// реэкспорт для стабильности прежнего пути импорта (тесты ws)
export { toMessage } from '../message-mapping.ts'
export type { OwnMessageResponse } from '../message-mapping.ts'

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

// Короткий WebAudio-пинг без ассета: AudioContext создаётся лениво и только
// при первом реально сыгранном звуке. Кеш привязан к конструктору: подмена
// глобала (тестовые заглушки) естественно пересоздаёт контекст, в живом
// приложении конструктор один — истинный ленивый синглтон
interface LazyPingContext {
    context: AudioContext
    ctor: unknown
}

let pingContext: LazyPingContext | null = null

function playIncomingPing(): void {
    try {
        const ctor = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext

        if (typeof ctor !== 'function') {
            return
        }

        if (pingContext === null || pingContext.ctor !== ctor) {
            pingContext = { context: new ctor(), ctor }
        }

        const context = pingContext.context
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        const now = context.currentTime

        oscillator.frequency.value = 880
        gain.gain.setValueAtTime(0.08, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(now)
        oscillator.stop(now + 0.15)
    } catch {
        // звук не должен ронять доставку сообщения
    }
}

// Шов доставки фоновых сообщений (2026-11-01-settings): чужое сообщение в
// НЕоткрытом чате (предикаты инкремента непрочитанных) опционально звучит и
// показывает браузерное уведомление — заголовок чата из стора, тело — текст
// сообщения (файловое без текста — «Вложение»). Уведомление требует всех
// трёх условий: тумблер включён, разрешение выдано, вкладка скрыта
export function deliverBackgroundNotice(chatId: number, payload: OwnMessageResponse): void {
    const state = store.getState()

    if (state.selectedChat === chatId) {
        return
    }

    if (state.user?.id === payload.user_id) {
        return
    }

    const preferences = getPreferences()

    if (preferences.sound) {
        playIncomingPing()
    }

    if (preferences.browserNotifications
        && notificationPermission() === 'granted'
        && document.hidden) {
        const chat = (state.chats ?? []).find(entry => (entry as { id?: number }).id === chatId)
        const title = typeof (chat as { title?: unknown } | undefined)?.title === 'string'
            ? (chat as { title: string }).title
            : 'Новое сообщение'

        new Notification(title, { body: payload.content ?? 'Вложение' })
    }
}

export class OwnWsAdapter {
    private sockets: Map<number, WSTransport> = new Map()

    // Марки намеренных закрытий (2026-11-04 offline, review F-3): Close
    // транспорта без payload одинаков для явного close() и исчерпания
    // реконнектов, поэтому каждый собственный путь закрытия ставит марку
    // ДО socket.close(), а Close-обработчик нотифицирует индикатор ТОЛЬКО
    // по немаркированному закрытию; марка одноразова (погашается событием),
    // Connected чистит осевшие марки нового соединения
    private readonly intentionalCloses = new Set<number>()

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
            this.intentionalCloses.delete(id)
            notifyWsConnected(id)
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

                // Дедуп по серверному id: повторная доставка того же
                // сообщения (идемпотентный повтор bot/runs и т.п.) не
                // дублирует ни ленту, ни счётчик непрочитанных
                const known = (store.getState().messages?.[id] ?? []) as { id?: number }[]

                if (typeof message.id === 'number' && known.some(item => item.id === message.id)) {
                    return
                }

                // События состава (2026-11-07): kind-строки add/kick/leave/
                // rejoin дергают контроллер — рефетч состава открытого чата
                // (новый участник появляется, ушедший гаснет по left_at,
                // кикнутый исчезает); после дедуп-гарда — повторная доставка
                // не гоняет рефетч
                if (typeof raw.kind === 'string' && raw.kind.startsWith('chat_member_')) {
                    notifyChatMembersChanged(id)
                }

                // Эхо своего сообщения (2026-11-07): заменяем старейшую
                // оптимистичную запись (ownTempId) серверной — гейт viewer-id
                // строгий, контент НИКОГДА не матчер (чужое совпадающее
                // сообщение не должно поглощать чужой темп); контент —
                // только тай-брейкер среди нескольких своих темпов
                const viewerId = store.getState().user?.id

                if (message.user_id === viewerId) {
                    const list = (store.getState().messages?.[id] ?? [])
                    const tempIndex = list.findIndex(item => item.ownTempId != null)
                    const tieIndex = tempIndex !== -1 && message.content != null
                        ? list.findIndex(item => item.ownTempId != null && item.content === message.content)
                        : -1
                    const index = tieIndex !== -1 ? tieIndex : tempIndex

                    if (index !== -1) {
                        const next = [...list]

                        next[index] = message
                        store.set(`messages.${id}`, next)
                        liftLastMessage(id, raw)

                        return
                    }
                }

                store.set(`messages.${id}`, appendMessages(
                    store.getState().messages?.[id] ?? [],
                    message
                ))
                incrementUnread(id, message.user_id)
                liftLastMessage(id, raw)
                deliverBackgroundNotice(id, raw)

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

            // bot_delta (2026-11-04 bot-stream, контракт WS-BE-BOT-STREAM):
            // {'message_id': <id вопроса>, 'delta': <текст>} — стрим ответа
            // бота. Дельта дописывается в контент pending-хвоста ОДНИМ
            // store-эмитом и только когда хвост существует и его pending_for
            // равен message_id дельты; всё прочее (нет хвоста, чужой
            // pending_for, поздняя дельта после финального сообщения) —
            // молчаливый дроп: финальное сообщение заменяет хвост
            // существующим путём (дедуп/dropPending/REST-fallback)
            if (wsEvent.type === 'bot_delta' && wsEvent.content != null) {
                const content = wsEvent.content as { message_id?: unknown, delta?: unknown }

                if (typeof content.message_id !== 'number' || typeof content.delta !== 'string') {
                    return
                }

                const list = (store.getState().messages?.[id] ?? []) as (Message & { isPending?: boolean, pending_for?: number })[]
                const tailIndex = list.findIndex(item =>
                    item.isPending === true && item.pending_for === content.message_id)

                if (tailIndex === -1) {
                    return
                }

                const tail = list[tailIndex]

                store.set(`messages.${id}`, [
                    ...list.slice(0, tailIndex),
                    { ...tail, content: `${tail.content}${content.delta}` },
                    ...list.slice(tailIndex + 1),
                ])

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

                return
            }

            // Чат переименован (2026-11-05-messenger-ux-pack): заголовок в
            // списке/шапке обновляет контроллер через gateway-слушатель;
            // сокет жив — событие чисто информационное
            if (wsEvent.type === 'chat_renamed' && wsEvent.content != null) {
                const content = wsEvent.content as { chat_id: number, title: string }

                notifyChatRenamed({ chat_id: content.chat_id, title: content.title })
            }

            // Бот включён в чате (2026-11-06-chat-create-flow): is_ai-патч
            // слайса делает контроллер через gateway-слушатель; сокет жив
            if (wsEvent.type === 'chat_ai_toggled' && wsEvent.content != null) {
                const content = wsEvent.content as { chat_id: number, is_ai: boolean }

                notifyChatAiToggled({ chat_id: content.chat_id, is_ai: content.is_ai })
            }

            // Аватар чата обновлён (2026-11-07): патч chats-слайса (плитка
            // списка и шапка) делает контроллер через gateway-слушатель;
            // сокет жив — событие чисто информационное, узор chat_renamed
            if (wsEvent.type === 'chat_avatar_updated' && wsEvent.content != null) {
                const content = wsEvent.content as { chat_id: number, avatar: string }

                notifyChatAvatarUpdated({ chat_id: content.chat_id, avatar: content.avatar })
            }

            // Аватар участника обновлён (2026-11-09): сервер фан-аутит во
            // все чаты пользователя; патч chatUsers открытого чата и
            // рефетч списка делает контроллер через gateway-слушатель,
            // сокет жив — узор chat_avatar_updated
            if (wsEvent.type === 'user_avatar_updated' && wsEvent.content != null) {
                const content = wsEvent.content as { chat_id: number, user_id: number, avatar: string }

                notifyUserAvatarUpdated({
                    chat_id: content.chat_id,
                    user_id: content.user_id,
                    avatar: content.avatar,
                })
            }
        })
        wsTransport.on(WSTransportEvents.Close, () => {
            this.sockets.delete(id)

            // Немаркированное закрытие — исчерпание реконнектов (обрыв без
            // восстановления): индикатор показывает его; намеренные пути
            // закрытия марку уже погасили (review F-3)
            if (this.intentionalCloses.delete(id)) {
                return
            }

            notifyWsUnexpectedClose(id)
        })

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

    // Явное закрытие сокета чата (chat_deleted/выход): транспорт не
    // реконнектит; марка до close() гасит индикатор на Close (намеренно)
    closeChat(id: number): Promise<void> {
        const socket = this.sockets.get(id)

        if (socket != null) {
            this.intentionalCloses.add(id)
            socket.close()
        }

        return Promise.resolve()
    }

    closeAll(): void {
        for (const id of this.sockets.keys()) {
            this.intentionalCloses.add(id)
        }

        this.sockets.forEach(socket => socket.close())
        this.sockets.clear()
    }

    // Принудительный реконнект (2026-11-04 offline, review F-7): закрывает и
    // роняет каждую НЕ-OPEN запись — застрявший в backoff чат снова становится
    // открываемым (гард sockets.has больше не мешает), OPEN-сокеты не трогаем.
    // Дропы маркируются намеренными: индикатор не мигает на онлайн-пути
    reconnectAll(): void {
        for (const [id, socket] of [...this.sockets]) {
            if (socket.isOpen) {
                continue
            }

            this.intentionalCloses.add(id)
            socket.close()
            this.sockets.delete(id)
        }
    }
}
