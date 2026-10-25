// Own-адаптер stories-сокета: лента историй общая для всех, поэтому канал
// один на приложение (в отличие от чат-сокетов) и не привязан к чату.
// WSTransport переиспользуется без правок: cookie-аутентификация, bounded-
// реконнект, ping-keepalive каждые 5 c, явное закрытие не реконнектит.
// Открывается со страницы чатов (CDM, идемпотентно); события уходят
// слушателю через gateway — бизнес-логика вставки живёт в контроллере.

import WSTransport, { WSTransportEvents } from '../../../../utils/WSTransport.ts'
import { env, joinUrl } from '../../../../utils/env.ts'
import type { OwnStoryResponse } from '../api/own.ts'
import { notifyStoriesSocketEvent } from './gateway.ts'

export function ownStoriesUrl(): string {
    return joinUrl(env.wsUrl, '/ws/stories')
}

let socket: WSTransport | null = null

export function connectStoriesSocket(): void {
    if (socket !== null) {
        return
    }

    const transport = new WSTransport(ownStoriesUrl())

    // подписки до connect(): Connected стреляет синхронно на open
    // (прецедент-комментарий в chats/ws/own.ts)
    transport.on(WSTransportEvents.Message, event => {
        const wsEvent = event as { type?: string, content?: unknown }

        if (wsEvent.type === 'story_created' && wsEvent.content != null) {
            notifyStoriesSocketEvent({ kind: 'story_created', content: wsEvent.content as OwnStoryResponse })

            return
        }

        if (wsEvent.type === 'story_deleted' && wsEvent.content != null) {
            notifyStoriesSocketEvent({ kind: 'story_deleted', content: wsEvent.content as { story_id: number } })
        }
        // неизвестные типы молча игнорируются (pong отфильтрован транспортом)
    })
    transport.on(WSTransportEvents.Close, () => {
        // сокет умер (исчерпание реконнектов) либо закрыт явно — обнуляем
        // ссылку, следующий CDM страницы откроет свежий
        socket = null
    })

    socket = transport
    // отказ коннекта не должен всплывать необработанным реджектом:
    // bounded-реконнект уже отработал внутри транспорта, Close обнулил ссылку
    transport.connect().catch((e: unknown) => {
        // сокет успели закрыть явно (closeStoriesSocket обнуляет ссылку до
        // close) — это не ошибка; реальный отказ логируем
        if (socket !== transport) {
            return
        }

        console.error('Ошибка подключения stories-сокета:', e)
    })
}

export function closeStoriesSocket(): void {
    const transport = socket

    socket = null
    transport?.close()
}
