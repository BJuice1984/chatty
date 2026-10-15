// Регрессионные тесты WSTransport (stage 11): bounded reconnect/backoff,
// close-cleanup (HARDEN-CLOSE — детерминированный носитель: явный close не
// реконнектит и снимает обработчики), реджект connect()-промиса и
// отсутствие дублей подписок при повторном connect/реконнекте.

import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import WSTransport, { WSTransportEvents } from './WSTransport.ts'

const dom = new JSDOM()
global.document = dom.window.document

type Listener = (event: { data?: string }) => void

// Зеркало приватного RECONNECT_MAX_ATTEMPTS транспорта: тест считает попытки.
const RECONNECT_MAX_ATTEMPTS = 5

// Все созданные фейковые сокеты: конструктор сам регистрирует инстанс,
// тесты берут последний через lastSocket().
const created: FakeWebSocket[] = []

// Фейковый WebSocket: открыт/закрыт вручную, слушатели — настоящий Map,
// чтобы проверять и снятие обработчиков, и доставку событий.
class FakeWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3

    readonly url: string
    readyState = FakeWebSocket.CONNECTING
    sent: string[] = []
    listeners = new Map<string, Listener[]>()

    constructor(url: string) {
        this.url = url
        created.push(this)
    }

    addEventListener(type: string, listener: Listener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    }

    removeEventListener(type: string, listener: Listener) {
        this.listeners.set(
            type,
            (this.listeners.get(type) ?? []).filter(item => item !== listener)
        )
    }

    send(data: string) {
        this.sent.push(data)
    }

    close() {
        this.readyState = FakeWebSocket.CLOSED
    }

    // Тестовые триггеры: имитируют события браузерного сокета.
    triggerOpen() {
        this.readyState = FakeWebSocket.OPEN
        this.fire('open')
    }

    triggerRemoteClose() {
        this.readyState = FakeWebSocket.CLOSED
        this.fire('close')
    }

    triggerMessage(data: string) {
        this.fire('message', { data })
    }

    private fire(type: string, event: { data?: string } = {}) {
        for (const listener of [...(this.listeners.get(type) ?? [])]) {
            listener(event)
        }
    }
}

describe('WSTransport', () => {
    let clock: sinon.SinonFakeTimers
    let originalWebSocket: typeof WebSocket

    beforeEach(() => {
        clock = sinon.useFakeTimers()
        created.length = 0
        originalWebSocket = globalThis.WebSocket
        globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    })

    afterEach(() => {
        globalThis.WebSocket = originalWebSocket
        clock.restore()
    })

    function lastSocket(): FakeWebSocket {
        return created[created.length - 1]
    }

    it('resolves connect on open and emits a single Connected event', async () => {
        const transport = new WSTransport('ws://localhost:1234')
        const connected = sinon.spy()

        transport.on(WSTransportEvents.Connected, connected)

        const promise = transport.connect()

        created[0].triggerOpen()
        await promise

        expect(created).to.have.length(1)
        expect(connected.calledOnce).to.be.true
    })

    it('reconnects after a remote close (HARDEN-RECONNECT)', async () => {
        const transport = new WSTransport('ws://localhost:1234')
        const message = sinon.spy()

        transport.on(WSTransportEvents.Message, message)

        const promise = transport.connect()

        created[0].triggerOpen()
        await promise

        // Обрыв: сервер закрыл сокет — транспорт сам открывает новый.
        created[0].triggerRemoteClose()
        await clock.tickAsync(1000)

        expect(created).to.have.length(2)

        // Сообщения нового сокета доставляются ровно один раз — подписки
        // старого не протекли в новый цикл (no duplicate subscriptions).
        lastSocket().triggerMessage('{"type":"message","content":"hi"}')
        await clock.tickAsync(1)

        expect(message.calledOnce).to.be.true
        expect((message.firstCall.args[0] as { content: string }).content).to.eq('hi')
    })

    it('grows the backoff delay between reconnect attempts', async () => {
        const transport = new WSTransport('ws://localhost:1234')

        const promise = transport.connect()

        created[0].triggerOpen()
        await promise

        // Попытка 1 после обрыва: задержка 1000 мс — до границы сокета ещё нет.
        created[0].triggerRemoteClose()
        await clock.tickAsync(999)
        expect(created).to.have.length(1)
        await clock.tickAsync(1)
        expect(created).to.have.length(2)

        // Попытка 2 (сокет не открылся — подряд): задержка выросла до 2000 мс.
        created[1].triggerRemoteClose()
        await clock.tickAsync(1999)
        expect(created).to.have.length(2)
        await clock.tickAsync(1)
        expect(created).to.have.length(3)

        // Попытка 3: 4000 мс.
        created[2].triggerRemoteClose()
        await clock.tickAsync(3999)
        expect(created).to.have.length(3)
        await clock.tickAsync(1)
        expect(created).to.have.length(4)
    })

    it('does not reconnect, clears ping and removes listeners on explicit close (HARDEN-CLOSE)', async () => {
        const transport = new WSTransport('ws://localhost:1234')
        const closeEvent = sinon.spy()
        const message = sinon.spy()

        transport.on(WSTransportEvents.Close, closeEvent)
        transport.on(WSTransportEvents.Message, message)

        const promise = transport.connect()

        created[0].triggerOpen()
        await promise

        transport.close()

        // Явное закрытие эмитит Close ровно один раз и снимает слушатели
        // сокета: события «мёртвого» сокета больше не доезжают до транспорта.
        expect(closeEvent.calledOnce).to.be.true

        created[0].triggerMessage('{"type":"message","content":"late"}')
        created[0].triggerRemoteClose()
        expect(message.called).to.be.false
        expect(closeEvent.calledOnce).to.be.true

        // Ping-интервал очищен: тикаем далеко за период — отправок нет.
        await clock.tickAsync(30_000)
        expect(created[0].sent).to.not.include('{"type":"ping"}')

        // Реконнекта нет даже после прошествия всех backoff-интервалов.
        await clock.tickAsync(60_000)
        expect(created).to.have.length(1)
    })

    it('rejects the connect promise when attempts are exhausted', async () => {
        const transport = new WSTransport('ws://localhost:1234')
        const closeEvent = sinon.spy()

        transport.on(WSTransportEvents.Close, closeEvent)

        const promise = transport.connect()

        // Пять безответных попыток: сокет умирает, не открывшись.
        created[0].triggerRemoteClose()
        for (let attempt = 0; attempt < RECONNECT_MAX_ATTEMPTS; attempt += 1) {
            await clock.tickAsync(2 ** attempt * 1000 + 1)
            lastSocket().triggerRemoteClose()
        }

        // Все таймеры выжаты — попыток больше не планируется.
        await clock.tickAsync(120_000)
        expect(created).to.have.length(1 + RECONNECT_MAX_ATTEMPTS)

        let rejection: string | null = null

        await promise.catch(error => {
            rejection = error instanceof Error ? error.message : String(error)
        })

        expect(rejection).to.contain('исчерпаны попытки')
        expect(closeEvent.calledOnce).to.be.true
    })

    it('rejects a pending connect promise on explicit close', async () => {
        const transport = new WSTransport('ws://localhost:1234')

        const promise = transport.connect()

        transport.close()

        let rejection: string | null = null

        await promise.catch(error => {
            rejection = error instanceof Error ? error.message : String(error)
        })

        expect(rejection).to.contain('вручную')
    })

    it('keeps subscriptions single across repeated connect cycles', async () => {
        const transport = new WSTransport('ws://localhost:1234')
        const connected = sinon.spy()
        const message = sinon.spy()

        transport.on(WSTransportEvents.Connected, connected)
        transport.on(WSTransportEvents.Message, message)

        const first = transport.connect()

        created[0].triggerOpen()
        await first

        transport.close()

        const second = transport.connect()

        created[1].triggerOpen()
        await second

        // Каждый open эмитит Connected ровно один раз (нет накопления
        // обработчиков от предыдущего connect).
        expect(connected.calledTwice).to.be.true

        created[1].triggerMessage('{"type":"message","content":"again"}')
        await clock.tickAsync(1)

        expect(message.calledOnce).to.be.true
    })

    it('sends pings only while the socket is open', async () => {
        const transport = new WSTransport('ws://localhost:1234')

        const promise = transport.connect()

        created[0].triggerOpen()
        await promise

        await clock.tickAsync(10_000)

        expect(created[0].sent.filter(item => item === '{"type":"ping"}')).to.have.length(2)

        // Обрыв: во время backoff-паузы ping молча пропускается.
        created[0].triggerRemoteClose()
        await clock.tickAsync(2000)

        expect(created).to.have.length(2)
        expect(created[1].sent).to.deep.eq([])
    })
})
