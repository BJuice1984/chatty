// Own-адаптер stories-сокета: один глобальный сокет на приложение
// (/ws/stories), идемпотентный коннект, события story_created/story_deleted
// уходят gateway-слушателю, неизвестные типы и битые кадры молча игнорируются,
// явное закрытие не реконнектит, а ссылка обнуляется — повторный connect
// открывает свежий сокет. FakeWebSocket-паттерн из chats/ws/ws.test.ts.

import { expect } from 'chai'
import sinon from 'sinon'
import { ownStoriesUrl } from './own.ts'
import { connectStoriesSocket, closeStoriesSocket } from './own.ts'
import { setStoriesSocketListener, type StoriesSocketEvent } from './gateway.ts'

type SocketListener = (event: { data?: string }) => void

const created: FakeWebSocket[] = []

class FakeWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3

    readyState = FakeWebSocket.CONNECTING
    url: string
    sent: string[] = []
    closed = false
    listeners = new Map<string, SocketListener[]>()

    constructor(url: string) {
        this.url = url
        created.push(this)
    }

    addEventListener(type: string, listener: SocketListener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    }

    // WSTransport отписывается при закрытии — фейк обязан это уважать,
    // иначе кадры «обрабатываются» мёртким транспортом
    removeEventListener(type: string, listener: SocketListener) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener))
    }

    send(data: string) {
        this.sent.push(data)
    }

    close() {
        this.readyState = FakeWebSocket.CLOSED
        this.closed = true
    }

    triggerOpen() {
        this.readyState = FakeWebSocket.OPEN
        for (const listener of [...(this.listeners.get('open') ?? [])]) {
            listener({})
        }
    }

    triggerMessage(data: string) {
        for (const listener of [...(this.listeners.get('message') ?? [])]) {
            listener({ data })
        }
    }

    triggerClose() {
        this.readyState = FakeWebSocket.CLOSED
        for (const listener of [...(this.listeners.get('close') ?? [])]) {
            listener({})
        }
    }
}

describe('stories ws adapter', () => {
    let clock: sinon.SinonFakeTimers
    let originalWebSocket: typeof WebSocket

    const events: StoriesSocketEvent[] = []

    beforeEach(() => {
        clock = sinon.useFakeTimers()
        created.length = 0
        originalWebSocket = globalThis.WebSocket
        globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
        events.length = 0
        setStoriesSocketListener(event => events.push(event))
    })

    afterEach(() => {
        closeStoriesSocket()
        globalThis.WebSocket = originalWebSocket
        clock.restore()
        setStoriesSocketListener(() => undefined)
    })

    it('opens one /ws/stories socket and is idempotent on repeated connects', async () => {
        const connected = connectStoriesSocket()

        created[0].triggerOpen()
        await connected

        expect(created).to.have.lengthOf(1)
        expect(created[0].url).to.eq(ownStoriesUrl())
        expect(ownStoriesUrl()).to.eq('ws://localhost:8000/api/v1/ws/stories')

        connectStoriesSocket()

        expect(created).to.have.lengthOf(1)
    })

    it('routes story_created frames to the registered listener', async () => {
        const connected = connectStoriesSocket()

        created[0].triggerOpen()
        await connected

        created[0].triggerMessage(JSON.stringify({
            type: 'story_created',
            content: {
                id: 7,
                owner_id: 42,
                owner_display_name: 'ada',
                owner_avatar_url: null,
                image_url: '9/download',
                created_at: '2026-10-25T12:00:00Z',
                viewed: false,
                is_own: false,
            },
        }))

        expect(events).to.have.lengthOf(1)
        expect(events[0]?.kind).to.eq('story_created')
        expect(events[0] && events[0].kind === 'story_created' ? events[0].content.id : null).to.eq(7)
    })

    it('ignores unknown event types and malformed payloads without throwing', async () => {
        const connected = connectStoriesSocket()

        created[0].triggerOpen()
        await connected

        created[0].triggerMessage(JSON.stringify({ type: 'reaction', content: {} }))
        created[0].triggerMessage(JSON.stringify({ type: 'story_created' }))
        created[0].triggerMessage(JSON.stringify({ type: 'story_deleted' }))

        expect(events).to.have.lengthOf(0)
    })

    it('closes through closeStoriesSocket and a later connect opens a fresh socket', async () => {
        const first = connectStoriesSocket()

        created[0].triggerOpen()
        await first

        closeStoriesSocket()

        expect(created[0].closed).to.be.true

        const second = connectStoriesSocket()

        expect(created).to.have.lengthOf(2)
        created[1].triggerOpen()
        await second

        expect(created[1].closed).to.be.false
    })

    it('processes no events after the socket is closed', async () => {
        const connected = connectStoriesSocket()

        created[0].triggerOpen()
        await connected

        closeStoriesSocket()

        created[0].triggerMessage(JSON.stringify({ type: 'story_created', content: { id: 1 } }))

        expect(events).to.have.lengthOf(0)
    })
})
