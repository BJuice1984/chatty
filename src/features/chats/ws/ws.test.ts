import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import { env, joinUrl } from '../../../utils/env.ts'
import store from '../../../utils/Store.ts'
import {
    appendMessages,
    chatMessagesPort,
    closeAllChatSockets,
    setChatsEventListeners,
} from './gateway.ts'
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
        expect(chatMessagesPort).to.have.property('closeChat')
        expect(closeAllChatSockets).to.be.a('function')
    })

    it('should keep the message identity for history deduplication', () => {
        // stage 11: merge истории дедуплицирует по id — own-маппинг сохраняет его
        expect(toMessage(ownResponse).id).to.eq(11)
    })

    it('should map the reply chain and reactions onto the Message DTO', () => {
        const mapped = toMessage({
            ...ownResponse,
            id: 21,
            reply_to_id: 11,
            reply_to: { id: 11, user_id: 2, snippet: 'первое' },
            reactions: [
                { emoji: '❤️', count: 2, mine: false },
                { emoji: '👍', count: 1, mine: true },
            ],
        })

        expect(mapped.replyToId).to.eq(11)
        expect(mapped.replyTo).to.deep.eq({ id: 11, user_id: 2, snippet: 'первое' })
        expect(mapped.reactions).to.deep.eq([
            { emoji: '❤️', count: 2, mine: false },
            { emoji: '👍', count: 1, mine: true },
        ])
    })

    it('should map reply-less messages without the quote block', () => {
        const mapped = toMessage(ownResponse)

        expect(mapped.replyTo).to.eq(null)
        expect(mapped.replyToId).to.eq(undefined)
        expect(mapped.reactions).to.deep.eq([])
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

// chats-social: маршрутизация событий реакции/удаления чата и реплаи.
// Реакцию адаптер не трактует сам — сводка broadcast'а несёт mine относительно
// отправителя действия, пересчёт viewer-side делает контроллер (шлюз-слушатель).
// chat_deleted: сокет чата закрывается явно, без backoff-реконнекта.
describe('own ws adapter social events', () => {
    type SocketListener = (event: { data?: string }) => void

    const created: FakeWebSocket[] = []

    class FakeWebSocket {
        static readonly CONNECTING = 0
        static readonly OPEN = 1
        static readonly CLOSING = 2
        static readonly CLOSED = 3

        readyState = FakeWebSocket.CONNECTING
        sent: string[] = []
        closed = false
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

    async function connectedSocket(): Promise<{ adapter: OwnWsAdapter; socket: FakeWebSocket }> {
        const adapter = new OwnWsAdapter()
        const connected = adapter.connect(3)

        created[0].triggerOpen()
        await connected

        return { adapter, socket: created[0] }
    }

    it('forwards reaction events to the gateway listener as-is', async () => {
        const onReaction = sinon.spy()

        setChatsEventListeners({ onReaction })

        const { socket } = await connectedSocket()

        socket.triggerMessage(JSON.stringify({
            type: 'reaction',
            content: { chat_id: 3, message_id: 11, user_id: 42, emoji: '👍', active: true },
        }))

        expect(onReaction.calledOnceWith({
            chat_id: 3,
            message_id: 11,
            user_id: 42,
            emoji: '👍',
            active: true,
        })).to.be.true
    })

    it('closes the chat socket on chat_deleted and does not reconnect', async () => {
        const onChatDeleted = sinon.spy()

        setChatsEventListeners({ onChatDeleted })

        const { socket } = await connectedSocket()

        socket.triggerMessage(JSON.stringify({ type: 'chat_deleted', content: { chat_id: 3 } }))

        expect(onChatDeleted.calledOnceWith(3)).to.be.true
        expect(socket.readyState).to.eq(FakeWebSocket.CLOSED)
        expect(socket.closed).to.be.true

        // явное закрытие не реконнектит: новых сокетов не появляется
        await clock.tickAsync(10_000)

        expect(created).to.have.length(1)
    })

    it('sends a reply with reply_to_id in the message event', async () => {
        const { adapter, socket } = await connectedSocket()

        await adapter.sendMessage(3, 'ответ', 21)

        expect(socket.sent[socket.sent.length - 1]).to.eq(
            '{"type":"message","content":{"content":"ответ","reply_to_id":21}}'
        )
    })

    it('keeps the scalar content shape for plain messages', async () => {
        const { adapter, socket } = await connectedSocket()

        await adapter.sendMessage(3, 'просто')

        expect(socket.sent[socket.sent.length - 1]).to.eq('{"type":"message","content":"просто"}')
    })

    it('closes through the adapter closeChat without reconnect', async () => {
        const { adapter, socket } = await connectedSocket()

        await adapter.closeChat(3)

        expect(socket.closed).to.be.true

        await clock.tickAsync(10_000)

        expect(created).to.have.length(1)
    })

    it('bumps the chat unread badge in real time for foreign messages in unopened chats', async function () {
        store.set('user', { id: 7, display_name: '', first_name: '', second_name: '', email: '', login: '', phone: '', avatar: '' })
        store.set('chats', [{ id: 3, title: 'Project', unread_count: 0 }, { id: 9, title: 'Other', unread_count: 2 }])
        store.set('selectedChat', 9)
        store.set('messages', { 3: [] })

        const { socket } = await connectedSocket()

        // чужое сообщение в невыданном чате: пилюля выросла сразу
        socket.triggerMessage(JSON.stringify({ type: 'message', content: { ...ownResponse, user_id: 42 } }))
        expect((store.getState().chats ?? []).find(chat => (chat as { id: number }).id === 3)).to.include({ unread_count: 1 })
        expect((store.getState().chats ?? []).find(chat => (chat as { id: number }).id === 9)).to.include({ unread_count: 2 })

        // своё сообщение не считается непрочитанным
        socket.triggerMessage(JSON.stringify({ type: 'message', content: { ...ownResponse, id: 12 } }))
        expect((store.getState().chats ?? []).find(chat => (chat as { id: number }).id === 3)).to.include({ unread_count: 1 })

        // выбранный чат прочитан по определению — счётчик не растёт
        store.set('selectedChat', 3)
        socket.triggerMessage(JSON.stringify({ type: 'message', content: { ...ownResponse, id: 13, user_id: 42 } }))
        expect((store.getState().chats ?? []).find(chat => (chat as { id: number }).id === 3)).to.include({ unread_count: 1 })

        await new OwnWsAdapter().closeChat(3)
        store.set('chats', undefined)
        store.set('selectedChat', undefined)
        store.set('user', undefined)
    })

    it('patches the chat last_message in real time beside the unread badge', async () => {
        store.set('chats', [
            { id: 3, title: 'Project', unread_count: 0, last_message: { content: 'старое', time: '2026-10-01T00:00:00Z' } },
            { id: 9, title: 'Other', unread_count: 0 },
        ])

        const { socket } = await connectedSocket()

        // входящий текст: RAW-контент и время события в last_message списка
        socket.triggerMessage(JSON.stringify({ type: 'message', content: { ...ownResponse, user_id: 42 } }))
        expect((store.getState().chats ?? []).find(chat => (chat as { id: number }).id === 3))
            .to.deep.include({ last_message: { content: 'hello', time: '2026-10-06T00:00:00Z' } })
        expect((store.getState().chats ?? []).find(chat => (chat as { id: number }).id === 9))
            .to.not.have.property('last_message')

        // файловое сообщение (content null): плейсхолдер «Вложение» — toMessage
        // схлопнул бы null в '', поэтому патч читает RAW-поле
        socket.triggerMessage(JSON.stringify({ type: 'message', content: { ...ownFileResponse, id: 14, user_id: 42 } }))
        expect((store.getState().chats ?? []).find(chat => (chat as { id: number }).id === 3))
            .to.deep.include({ last_message: { content: 'Вложение', time: '2026-10-06T00:00:00Z' } })

        await new OwnWsAdapter().closeChat(3)
        store.set('chats', undefined)
    })

    it('ignores reaction notifications while no listener is attached', async () => {
        // слушатель не регистрируется — notify не должен падать
        const { socket } = await connectedSocket()

        expect(() =>
            socket.triggerMessage(JSON.stringify({
                type: 'reaction',
                content: { chat_id: 3, message_id: 11, user_id: 42, emoji: '👍', active: false },
            }))
        ).to.not.throw()
    })
})
