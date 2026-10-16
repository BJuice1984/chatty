import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import { env, joinUrl } from '../../../utils/env.ts'
import store from '../../../utils/Store.ts'
import { appendMessages, chatMessagesPort, closeAllChatSockets } from './gateway.ts'
import { OwnWsAdapter, ownChatUrl, toMessage } from './own.ts'
import { chatHistorySlice } from '../history/store.ts'
import type { Message } from '../../../utils/types.ts'

const dom = new JSDOM()
global.document = dom.window.document

const ownResponse = {
    id: 11,
    chat_id: 3,
    user_id: 7,
    content: 'hello',
    file_id: null,
    client_message_id: null,
    created_at: '2026-10-06T00:00:00Z',
}

const ownFileResponse = {
    ...ownResponse,
    id: 12,
    content: null,
    file_id: 5,
}

function message(id: number, content: string): Message {
    return { chat_id: 3, time: `t${id}`, type: 'message', user_id: 7, content }
}

describe('chats ws gateway', () => {
    it('should expose the port through the gateway', () => {
        expect(chatMessagesPort).to.have.property('sendMessage')
        expect(chatMessagesPort).to.have.property('connect')
        expect(chatMessagesPort).to.have.property('loadHistory')
        expect(closeAllChatSockets).to.be.a('function')
    })

    it('should keep the message identity for history deduplication', () => {
        // stage 11: merge истории дедуплицирует по id — own-маппинг сохраняет его
        expect(toMessage(ownResponse).id).to.eq(11)
    })

    it('should reject own-mode history requests for unconnected chats', async () => {
        let rejection: string | null = null

        await new OwnWsAdapter().loadHistory(3, 11, 20).catch(error => {
            rejection = error instanceof Error ? error.message : String(error)
        })

        expect(rejection).to.contain('not connected')
    })

    it('should append a single incoming message to the current list', () => {
        const result = appendMessages([message(1, 'a')], message(2, 'b'))

        expect(result.map(m => m.content)).to.deep.eq(['a', 'b'])
    })

    it('should reverse descending history batches before appending', () => {
        const history = [message(3, 'c'), message(2, 'b'), message(1, 'a')]

        expect(appendMessages([], history).map(m => m.content)).to.deep.eq(['a', 'b', 'c'])
    })

    it('should store own-mode history ascending via a single reversal (RV1 composition)', () => {
        // own.ts передаёт desc-массив бэкенда как есть (только toMessage) —
        // единственный reverse делает appendMessages; живое эхо приклеивается в конец
        const descFromBackend = [ownResponse, { ...ownResponse, id: 10, content: 'first' }]
        const stored = appendMessages([], descFromBackend.map(toMessage))
        const withEcho = appendMessages(stored, toMessage({ ...ownResponse, id: 13, content: 'echo' }))

        expect(withEcho.map(m => m.content)).to.deep.eq(['first', 'hello', 'echo'])
    })

    it('should map own MessageResponse onto the Message DTO', () => {
        const mapped = toMessage(ownResponse)

        expect(mapped.chat_id).to.eq(3)
        expect(mapped.user_id).to.eq(7)
        expect(mapped.time).to.eq('2026-10-06T00:00:00Z')
        expect(mapped.type).to.eq('message')
        expect(mapped.content).to.eq('hello')
        expect(mapped.file_url).to.eq(undefined)
    })

    it('should map own file messages to a safe download URL', () => {
        const mapped = toMessage(ownFileResponse)

        expect(mapped.content).to.eq('')
        expect(mapped.file_url).to.eq(joinUrl(env.filesUrl, '/5/download'))
    })

    it('should build the own WS URL without a token', () => {
        expect(ownChatUrl(3)).to.eq(joinUrl(env.wsUrl, '/ws/chats/3'))
    })
})

// HD-R2: внутренний реконнект транспорта пере-запрашивает первичную историю
// из единственного места (подписка Connected), а висящий «загрузить ещё»
// не путает маршрутизацию ответа — без дублей и без переворота порядка.
describe('own ws adapter reconnect (HD-R2)', () => {
    type SocketListener = (event: { data?: string }) => void

    const created: FakeWebSocket[] = []

    class FakeWebSocket {
        static readonly CONNECTING = 0
        static readonly OPEN = 1
        static readonly CLOSING = 2
        static readonly CLOSED = 3

        readyState = FakeWebSocket.CONNECTING
        sent: string[] = []
        listeners = new Map<string, SocketListener[]>()

        constructor() {
            created.push(this)
        }

        addEventListener(type: string, listener: SocketListener) {
            this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
        }

        removeEventListener() {}

        send(data: string) {
            this.sent.push(data)
        }

        close() {
            this.readyState = FakeWebSocket.CLOSED
        }

        triggerOpen() {
            this.readyState = FakeWebSocket.OPEN
            for (const listener of [...(this.listeners.get('open') ?? [])]) {
                listener({})
            }
        }

        triggerRemoteClose() {
            this.readyState = FakeWebSocket.CLOSED
            for (const listener of [...(this.listeners.get('close') ?? [])]) {
                listener({})
            }
        }

        triggerMessage(data: string) {
            for (const listener of [...(this.listeners.get('message') ?? [])]) {
                listener({ data })
            }
        }
    }

    let clock: sinon.SinonFakeTimers
    let originalWebSocket: typeof WebSocket

    beforeEach(() => {
        clock = sinon.useFakeTimers()
        created.length = 0
        originalWebSocket = globalThis.WebSocket
        globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
        store.set('messages', { 3: [] })
        chatHistorySlice.resetHistory(3)
    })

    afterEach(() => {
        globalThis.WebSocket = originalWebSocket
        clock.restore()
        store.set('messages', { 3: [] })
        chatHistorySlice.resetHistory(3)
    })

    function historyResponse(ids: number[]): string {
        // Бэкенд отдаёт убыванием (desc): новые первыми
        const descending = [...ids].sort((a, b) => b - a)

        return JSON.stringify({
            type: 'history',
            content: {
                messages: descending.map(id => ({
                    ...ownResponse,
                    id,
                    content: `msg-${id}`,
                })),
                next_before_id: 20,
            },
        })
    }

    function storedIds(): Array<number | undefined> {
        return (store.getState().messages?.[3] ?? [])
            .map(item => (item as { id?: number }).id)
    }

    it('re-requests the initial page on an internal reconnect without duplicates or reorder', async () => {
        const adapter = new OwnWsAdapter()
        const connected = adapter.connect(3)

        created[0].triggerOpen()
        await connected

        // Первичная история запрашивается ровно один раз — из Connected
        expect(created[0].sent).to.deep.eq([
            '{"type":"history","content":{"before_id":null,"limit":50}}',
        ])

        created[0].triggerMessage(historyResponse([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]))

        expect(storedIds()).to.deep.eq([21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
        expect(chatHistorySlice.getHistory(3).cursor).to.eq(20)

        // «Загрузить ещё» в полёте: pending-флаг поднят, запрос before_id=20 отправлен
        chatHistorySlice.patchHistory(3, { isLoading: true })

        await adapter.loadHistory(3, 20, 20)

        expect(created[0].sent.filter(item => item.includes('"before_id":20'))).to.have.length(1)

        // Обрыв и внутренний backoff-реконнект: транспорт сам открывает новый сокет
        created[0].triggerRemoteClose()
        await clock.tickAsync(1000)

        expect(created).to.have.length(2)

        created[1].triggerOpen()

        // Второй Connected сбросил pending-флаг и пере-запросил первичную страницу
        expect(chatHistorySlice.getHistory(3).isLoading).to.be.false
        expect(created[1].sent).to.deep.eq([
            '{"type":"history","content":{"before_id":null,"limit":50}}',
        ])

        // За время обрыва появилось сообщение 31: свежая первичная страница
        // содержит его. Ответ маршрутизируется как первичная история (append,
        // дедупликация по id) — не как ответ на «загрузить ещё» (prepend).
        created[1].triggerMessage(historyResponse([21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]))

        // Нет дублей (21..30 повторились и схлопнулись), нет переворота: 31 в конце
        expect(storedIds()).to.deep.eq([21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31])
        expect(chatHistorySlice.getHistory(3).cursor).to.eq(20)
        expect(chatHistorySlice.getHistory(3).isLoading).to.be.false
    })

    it('requests the initial history exactly once per connection (no post-await double send)', async () => {
        const adapter = new OwnWsAdapter()
        const connected = adapter.connect(3)

        created[0].triggerOpen()
        await connected

        expect(created[0].sent.filter(item => item.includes('"before_id":null'))).to.have.length(1)
    })
})
