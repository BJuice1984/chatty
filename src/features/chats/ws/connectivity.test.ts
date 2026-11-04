// Наблюдатель offline/online (2026-11-04-bot-wait-offline): offline показывает
// reconnect-оверлей, online гасит его, силой роняет застрявшие чат- и
// stories-сокеты и рефетчит список. Проверяется на РЕАЛЬНЫХ швах (gateway-
// адаптер + stories-модуль) с FakeWebSocket — стаб только у fetchChats
// контроллера; Auth-прогрева нет и не должно быть (review F-4 — фичу auth
// онлайн-путь не трогает вовсе).

import { expect } from 'chai'
import sinon from 'sinon'
import store from '../../../utils/Store.ts'
import { resetBusyOverlayForTests } from '../../../utils/busyOverlay.ts'
import ChatsController from '../controller.ts'
import { chatMessagesPort, closeAllChatSockets, setChatsEventListeners } from './gateway.ts'
import { closeStoriesSocket } from '../stories/ws/own.ts'
import { installConnectivityWatchers, resetConnectivityWatchersForTests } from './connectivity.ts'

type SocketListener = (event: { data?: string }) => void

const created: FakeWebSocket[] = []

class FakeWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3

    url: string
    readyState = FakeWebSocket.CONNECTING
    closed = false
    listeners = new Map<string, SocketListener[]>()

    constructor(url: string) {
        this.url = url
        created.push(this)
    }

    addEventListener(type: string, listener: SocketListener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    }

    removeEventListener() {}

    send(): void {}

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
}

describe('chats ws connectivity watcher', () => {
    let clock: sinon.SinonFakeTimers
    let originalWebSocket: typeof WebSocket
    let fetchChats: sinon.SinonStub

    beforeEach(() => {
        clock = sinon.useFakeTimers()
        created.length = 0
        originalWebSocket = globalThis.WebSocket
        globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
        resetBusyOverlayForTests()
        resetConnectivityWatchersForTests()
        setChatsEventListeners({ onChatDeleted: () => undefined })
        fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
    })

    afterEach(() => {
        closeAllChatSockets()
        closeStoriesSocket()
        globalThis.WebSocket = originalWebSocket
        clock.restore()
        resetBusyOverlayForTests()
        resetConnectivityWatchersForTests()
        fetchChats.restore()
        store.set('messages', undefined)
    })

    function fireOffline(): void {
        window.dispatchEvent(new window.Event('offline'))
    }

    function fireOnline(): void {
        window.dispatchEvent(new window.Event('online'))
    }

    function overlay(): HTMLElement | null {
        return document.getElementById('busy-overlay')
    }

    it('window offline shows the reconnect overlay', () => {
        installConnectivityWatchers()

        expect(overlay()).to.be.null

        fireOffline()

        const node = overlay()

        expect(node).to.be.not.null
        expect(node?.className).to.contain('busy-overlay_kind_reconnect')
    })

    it('online hides the overlay, force-drops the stuck chat socket, opens a fresh stories socket and refetches the list', async () => {
        // чат-сокет застрял: connect без open — транспорт в CONNECTING
        chatMessagesPort.connect(3, '').catch(() => undefined)

        expect(created).to.have.length(1)

        installConnectivityWatchers()
        fireOffline()

        expect(overlay()).to.be.not.null

        fireOnline()
        await clock.tickAsync(1)

        // застрявший чат-сокет закрыт силой и уронен из Map адаптера
        expect(created[0].closed).to.be.true

        // stories-сокет открыт свежий (ссылки до события не было)
        expect(created.filter(socket => socket.url.includes('/ws/stories'))).to.have.length(1)

        // список рефетчится: fetchChats переоткроет чаты и Connected-ресинк
        // догонит хвосты истории
        expect(fetchChats.calledOnce).to.be.true

        // оверлей снят (grace-удаление на macrotask)
        expect(overlay()).to.be.null
    })

    it('install is idempotent: a double bind adds exactly one listener set', async () => {
        installConnectivityWatchers()
        installConnectivityWatchers()

        fireOffline()
        fireOnline()
        await clock.tickAsync(1)

        // один набор слушателей = одна пара show/hide: оверлей снят после
        // ПЕРВОГО online (двойной набор оставил бы refcount = 1) и один рефеч
        expect(overlay()).to.be.null
        expect(fetchChats.calledOnce).to.be.true
    })

    it('does not fire the online path when bound while navigator.onLine is false', () => {
        Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })

        try {
            installConnectivityWatchers()

            // бинд в офлайне молчит: ни действий онлайн-пути, ни оверлея —
            // реакции начнутся с событий (первый offline/online)
            expect(fetchChats.called).to.be.false
            expect(created).to.have.length(0)
            expect(overlay()).to.be.null
        } finally {
            delete (window.navigator as { onLine?: boolean }).onLine
        }
    })

    it('survives repeated offline/online cycles with balanced overlay pairs', async () => {
        installConnectivityWatchers()

        fireOffline()

        expect(overlay()).to.be.not.null

        fireOnline()
        await clock.tickAsync(1)

        expect(overlay()).to.be.null

        fireOffline()

        expect(overlay()).to.be.not.null

        fireOnline()
        await clock.tickAsync(1)

        expect(overlay()).to.be.null
        expect(fetchChats.calledTwice).to.be.true
    })
})
