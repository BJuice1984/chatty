import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import store from '../../utils/Store.ts'
import { ChatsFeatureController, applyReactionDelta, toggleOwnReaction } from './controller.ts'
import { chatSearchSlice, chatsSlice } from './store.ts'
import { notifyChatDeleted, notifyReactionEvent } from './ws/gateway.ts'
import { OwnWsAdapter } from './ws/own.ts'
import type { ChatsPort } from './ports.ts'
import type { ChatSearchMatch, Message, ReactionSummary } from '../../utils/types.ts'

const dom = new JSDOM()
global.document = dom.window.document

function makePort(overrides: Partial<ChatsPort> = {}): ChatsPort {
    return {
        fetchChats: async () => [],
        createChat: async () => undefined,
        deleteChat: async () => undefined,
        // eslint-disable-next-line no-unused-vars
        getToken: async (chatId: number) => ({ token: `token-${chatId}` }),
        addUsers: async () => undefined,
        removeUsers: async () => undefined,
        getChatUsers: async () => [],
        changeChatAvatar: async () => ({ avatar: '' }),
        searchUsers: async () => [],
        searchChats: async () => [],
        setReaction: async () => ({
            message_id: 0,
            active: true,
            reactions: [],
        }),
        ...overrides,
    }
}

function makeMessages(overrides: Record<string, unknown> = {}) {
    return {
        sendMessage: async () => undefined,
        connect: async () => undefined,
        loadHistory: async () => undefined,
        closeChat: async () => undefined,
        ...overrides,
    }
}

function storedMessage(chatId: number, id: number, reactions: ReactionSummary[]): void {
    const message: Message = { chat_id: chatId, time: `t${id}`, type: 'message', user_id: 7, content: `m${id}`, id, reactions }

    storeSetMessages(chatId, [message])
}

// минимальная инициализация messages.{chatId} в сторе
function storeSetMessages(chatId: number, messages: Message[]): void {
    store.set('messages', { ...(store.getState().messages ?? {}), [chatId]: messages })
}

describe('chats feature boundary', () => {
    afterEach(() => {
        chatsSlice.setChats([])
    })

    it('should expose the port through the controller (boundary smoke)', () => {
        const port = makePort()
        const messages = makeMessages()
        const controller = new ChatsFeatureController(port, messages)

        expect(controller).to.be.instanceOf(ChatsFeatureController)
    })

    it('should store fetched chats in the slice and connect sockets per chat', async () => {
        const connect = sinon.spy()
        const port = makePort({
            fetchChats: async () => [
                { id: 1, title: 'one', avatar: '', unread_count: 0 },
                { id: 2, title: 'two', avatar: '', unread_count: 0 },
            ],
        })
        const controller = new ChatsFeatureController(port, makeMessages({ connect }))

        await controller.fetchChats()

        expect(chatsSlice.getChats().map(chat => chat.id)).to.deep.eq([1, 2])
        expect(connect.calledTwice).to.be.true
        expect(connect.firstCall.args).to.deep.eq([1, 'token-1'])
    })

    it('should select a chat through the slice', () => {
        chatsSlice.selectChat(42)

        expect(chatsSlice.getSelectedChat()).to.eq(42)
    })

    // Список чатов приходит с аватарами в самом ответе (members в GET /chats
    // собирает аватар собеседника адаптер): отдельных запросов участников на
    // каждый чат больше нет — N+1 закрыт, значения кладутся как приехали
    it('should store list avatars as fetched and issue zero member requests', async () => {
        store.set('user', { id: 1 })
        const getChatUsers = sinon.spy(async () => [])
        const port = makePort({
            fetchChats: async () => [
                { id: 7, title: 'duo', avatar: '15/download', unread_count: 0 },
                { id: 9, title: 'group', avatar: '', unread_count: 0 },
            ],
            getChatUsers,
        })
        const controller = new ChatsFeatureController(port, makeMessages())

        await controller.fetchChats()

        const chats = chatsSlice.getChats()

        expect(chats.find(chat => chat.id === 7)?.avatar).to.eq('15/download')
        expect(chats.find(chat => chat.id === 9)?.avatar).to.eq('')
        expect(getChatUsers.notCalled).to.be.true

        store.set('user', null)
    })

    // Смена одного аватара чата — точечный патч стора из ответа загрузки:
    // без рефетча списка (и его WS-connect-цикла по всем чатам); id чата —
    // из FormData той же формы, что читает адаптер
    it('should patch one chat avatar point-wise without refetching the list', async () => {
        chatsSlice.setChats([
            { id: 7, title: 'duo', avatar: '', unread_count: 0 },
            { id: 9, title: 'other', avatar: 'keep-me', unread_count: 0 },
        ])
        const fetchChats = sinon.spy(async () => [])
        const port = makePort({
            fetchChats,
            changeChatAvatar: async () => ({ avatar: '11/download' }),
        })
        const controller = new ChatsFeatureController(port, makeMessages())
        const form = new FormData()

        form.append('chatId', '7')

        await controller.changeChatAvatar(form)

        const chats = chatsSlice.getChats()

        expect(chats.find(chat => chat.id === 7)?.avatar).to.eq('11/download')
        expect(chats.find(chat => chat.id === 9)?.avatar).to.eq('keep-me')
        expect(fetchChats.notCalled).to.be.true
    })

    it('should add users by login through the port and refresh both lists', async () => {
        const searchUsers = sinon.stub().resolves([
            { id: 101, login: 'ada', display_name: 'ada' },
        ])
        const addUsers = sinon.stub().resolves()
        const getChatUsers = sinon.stub().resolves([])
        const fetchChats = sinon.stub().resolves([])
        const port = makePort({
            searchUsers,
            addUsers,
            getChatUsers,
            fetchChats,
        })
        const controller = new ChatsFeatureController(port, makeMessages())

        await controller.addUsersByLogin({ login: 'ada' }, 7)

        expect(searchUsers.calledWith({ login: 'ada' })).to.be.true
        expect(addUsers.calledOnce).to.be.true
        expect(addUsers.firstCall.args[0]).to.deep.eq({ users: [101], chatId: 7 })
        expect(getChatUsers.calledWith(7)).to.be.true
        expect(fetchChats.calledOnce).to.be.true
    })

    it('should search users typed for the add-user modal', async () => {
        const searchUsers = sinon.stub().resolves([{ id: 5, login: 'bob@example.com', display_name: 'bob' }])
        const controller = new ChatsFeatureController(makePort({ searchUsers }), makeMessages())

        const results = await controller.searchUsers('bob')

        expect(searchUsers.calledWith({ login: 'bob' })).to.be.true
        expect(results).to.deep.eq([{ id: 5, login: 'bob@example.com', display_name: 'bob' }])
    })

    it('should keep the search silent on port failure', async () => {
        const searchUsers = sinon.stub().rejects(new Error('boom'))
        const controller = new ChatsFeatureController(makePort({ searchUsers }), makeMessages())

        const results = await controller.searchUsers('bob')

        expect(results).to.deep.eq([])
    })

    it('should pass replyToId through to the messages port', async () => {
        const sendMessage = sinon.stub().resolves()
        const controller = new ChatsFeatureController(makePort(), makeMessages({ sendMessage }))

        await controller.sendMessage(3, 'ответ', 21)

        expect(sendMessage.calledOnceWith(3, 'ответ', 21)).to.be.true
    })
})

// Живой поиск по чатам (2026-10-26-chat-search): контроллер режет пробелы,
// сбрасывает без запроса на пустом вводе, обесценивает устаревшие ответы
// монотонным счётчиком и молчит на ошибке порта
describe('chats controller search', () => {
    afterEach(() => {
        chatSearchSlice.resetSearch()
    })

    it('trims the query before the port call and stores it with results', async () => {
        const results: ChatSearchMatch[] = [{ chat_id: 3, matched_in: 'title' }]
        const searchChats = sinon.stub().resolves(results)
        const controller = new ChatsFeatureController(makePort({ searchChats }), makeMessages())

        await controller.searchChats('  боевой  ')

        expect(searchChats.calledOnceWith('боевой')).to.be.true
        expect(chatSearchSlice.getSearch()).to.deep.eq({ query: 'боевой', results })
    })

    it('resets without a port call on empty and whitespace input', async () => {
        chatSearchSlice.setSearch('старый', [{ chat_id: 3, matched_in: 'title' }])
        const searchChats = sinon.stub().resolves([])
        const controller = new ChatsFeatureController(makePort({ searchChats }), makeMessages())

        await controller.searchChats('')
        await controller.searchChats('   ')

        expect(searchChats.notCalled).to.be.true
        expect(chatSearchSlice.getSearch()).to.eq(undefined)
    })

    it('drops a stale answer: the Store keeps the second result', async () => {
        const stale: ChatSearchMatch[] = [{ chat_id: 1, matched_in: 'title' }]
        const fresh: ChatSearchMatch[] = [{
            chat_id: 2,
            matched_in: 'message',
            snippet: { before: 'a', match: 'b', after: 'c' },
            last_match_at: '2026-10-26T10:00:00Z',
        }]
        let resolveFirst: (results: ChatSearchMatch[]) => void = () => {}
        const searchChats = sinon.stub()

        searchChats.onFirstCall().returns(new Promise<ChatSearchMatch[]>(resolve => {
            resolveFirst = resolve
        }))
        searchChats.onSecondCall().resolves(fresh)

        const controller = new ChatsFeatureController(makePort({ searchChats }), makeMessages())
        const first = controller.searchChats('первый')
        const second = controller.searchChats('второй')

        await second

        expect(chatSearchSlice.getSearch()?.query).to.eq('второй')
        expect(chatSearchSlice.getSearch()?.results).to.deep.eq(fresh)

        // медленный первый ответ разрешается последним — и не побеждает
        resolveFirst(stale)
        await first

        expect(chatSearchSlice.getSearch()?.query).to.eq('второй')
        expect(chatSearchSlice.getSearch()?.results).to.deep.eq(fresh)
    })

    it('keeps the Store untouched and silent when the port rejects', async () => {
        chatSearchSlice.setSearch('было', [{ chat_id: 3, matched_in: 'title' }])
        const searchChats = sinon.stub().rejects(new Error('сеть'))
        const controller = new ChatsFeatureController(makePort({ searchChats }), makeMessages())

        await controller.searchChats('новый')

        expect(chatSearchSlice.getSearch()).to.deep.eq({
            query: 'было',
            results: [{ chat_id: 3, matched_in: 'title' }],
        })
    })
})

// Чистые функции реконсиляции реакций: чипы вьюера считаются локально от
// state.user.id — WS-broadcast несёт mine относительно отправителя действия
describe('reaction summary reducers', () => {
    it('adds a new emoji with count and viewer mine flag', () => {
        const next = applyReactionDelta([], { user_id: 7, emoji: '👍', active: true }, 7)

        expect(next).to.deep.eq([{ emoji: '👍', count: 1, mine: true }])
    })

    it('keeps the viewer mine untouched for another user action', () => {
        const start: ReactionSummary[] = [{ emoji: '👍', count: 1, mine: true }]
        const next = applyReactionDelta(start, { user_id: 42, emoji: '👍', active: true }, 7)

        expect(next).to.deep.eq([{ emoji: '👍', count: 2, mine: true }])
    })

    it('recomputes mine for the viewer own action', () => {
        const start: ReactionSummary[] = [{ emoji: '👍', count: 1, mine: true }]
        const next = applyReactionDelta(start, { user_id: 7, emoji: '👍', active: false }, 7)

        expect(next).to.deep.eq([])
    })

    it('keeps the stable emoji order of the existing summary', () => {
        const start: ReactionSummary[] = [
            { emoji: '❤️', count: 2, mine: false },
            { emoji: '👍', count: 1, mine: false },
        ]
        const next = applyReactionDelta(start, { user_id: 9, emoji: '👍', active: true }, 7)

        expect(next.map(item => item.emoji)).to.deep.eq(['❤️', '👍'])
        expect(next[1].count).to.eq(2)
    })

    it('toggles the own chip by its current mine state', () => {
        const active = toggleOwnReaction([{ emoji: '😂', count: 1, mine: false }], 7, '😂')

        expect(active.active).to.be.true
        expect(active.reactions).to.deep.eq([{ emoji: '😂', count: 2, mine: true }])

        const back = toggleOwnReaction(active.reactions, 7, '😂')

        expect(back.active).to.be.false
        expect(back.reactions).to.deep.eq([{ emoji: '😂', count: 1, mine: false }])
    })
})

describe('chats controller reactions', () => {
    afterEach(() => {
        store.set('messages', undefined)
        store.set('user', undefined)
    })

    it('toggles optimistically and reconciles with the REST summary', async () => {
        storedMessage(3, 11, [])
        store.set('user', { id: 7, login: 'a@example.com' } as never)
        const setReaction = sinon.stub().resolves({
            message_id: 11,
            active: true,
            reactions: [{ emoji: '👍', count: 1, mine: true }],
        })
        const controller = new ChatsFeatureController(makePort({ setReaction }), makeMessages())

        await controller.setReaction(3, 11, '👍')

        expect(setReaction.calledOnceWith({ chatId: 3, messageId: 11, emoji: '👍' })).to.be.true
        expect(store.getState().messages?.[3]?.[0]?.reactions).to.deep.eq([{ emoji: '👍', count: 1, mine: true }])
    })

    it('rolls the optimistic chip back when the port rejects', async () => {
        storedMessage(3, 11, [{ emoji: '👍', count: 1, mine: true }])
        store.set('user', { id: 7, login: 'a@example.com' } as never)
        const setReaction = sinon.stub().rejects(new Error('boom'))
        const controller = new ChatsFeatureController(makePort({ setReaction }), makeMessages())

        await controller.setReaction(3, 11, '👍')

        expect(store.getState().messages?.[3]?.[0]?.reactions).to.deep.eq([{ emoji: '👍', count: 1, mine: true }])
    })

    it('stays silent without a viewer identity', async () => {
        storedMessage(3, 11, [])
        const setReaction = sinon.stub().resolves({ message_id: 11, active: true, reactions: [] })
        const controller = new ChatsFeatureController(makePort({ setReaction }), makeMessages())

        await controller.setReaction(3, 11, '👍')

        expect(setReaction.called).to.be.false
    })

    it('applies a foreign reaction event as a delta (viewer-side)', () => {
        storedMessage(3, 11, [{ emoji: '❤️', count: 1, mine: true }])
        store.set('user', { id: 7, login: 'a@example.com' } as never)
        // конструктор регистрирует WS-слушателя в шлюзе
        const controller = new ChatsFeatureController(makePort(), makeMessages())

        expect(controller).to.be.instanceOf(ChatsFeatureController)

        notifyReactionEvent({ chat_id: 3, message_id: 11, user_id: 42, emoji: '❤️', active: true })

        expect(store.getState().messages?.[3]?.[0]?.reactions).to.deep.eq([{ emoji: '❤️', count: 2, mine: true }])
    })

    it('skips the own WS echo while the REST toggle is in flight', async () => {
        // вьюер + ещё один пользователь: тоггл вьюера снимает только его чип
        storedMessage(3, 11, [{ emoji: '👍', count: 2, mine: true }])
        store.set('user', { id: 7, login: 'a@example.com' } as never)
        let resolveRest: (value: { message_id: number; active: boolean; reactions: ReactionSummary[] }) => void = () => {}
        const setReaction = () => new Promise<{ message_id: number; active: boolean; reactions: ReactionSummary[] }>(resolve => {
            resolveRest = resolve
        })
        const controller = new ChatsFeatureController(makePort({ setReaction }), makeMessages())

        const pending = controller.setReaction(3, 11, '👍')

        // оптимистичный тоггл уже снял свой чип: осталась чужая единица
        expect(store.getState().messages?.[3]?.[0]?.reactions)
            .to.deep.eq([{ emoji: '👍', count: 1, mine: false }])

        // собственное эхо пришло раньше REST-ответа — повторная дельта
        // (count до нуля) не применяется, чип чужой реакции выживает
        notifyReactionEvent({ chat_id: 3, message_id: 11, user_id: 7, emoji: '👍', active: false })

        expect(store.getState().messages?.[3]?.[0]?.reactions)
            .to.deep.eq([{ emoji: '👍', count: 1, mine: false }])

        resolveRest({ message_id: 11, active: false, reactions: [{ emoji: '👍', count: 1, mine: false }] })
        await pending

        expect(store.getState().messages?.[3]?.[0]?.reactions)
            .to.deep.eq([{ emoji: '👍', count: 1, mine: false }])
    })

    it('applies the own WS echo after the flight window (second tab)', () => {
        storedMessage(3, 11, [])
        store.set('user', { id: 7, login: 'a@example.com' } as never)
        const controller = new ChatsFeatureController(makePort(), makeMessages())

        expect(controller).to.be.instanceOf(ChatsFeatureController)

        notifyReactionEvent({ chat_id: 3, message_id: 11, user_id: 7, emoji: '👍', active: true })

        expect(store.getState().messages?.[3]?.[0]?.reactions).to.deep.eq([{ emoji: '👍', count: 1, mine: true }])
    })

    it('ignores reaction events for messages outside the loaded page', () => {
        storedMessage(3, 11, [])
        store.set('user', { id: 7, login: 'a@example.com' } as never)
        const controller = new ChatsFeatureController(makePort(), makeMessages())

        expect(controller).to.be.instanceOf(ChatsFeatureController)

        notifyReactionEvent({ chat_id: 3, message_id: 999, user_id: 42, emoji: '👍', active: true })

        expect(store.getState().messages?.[3]?.[0]?.reactions).to.deep.eq([])
    })
})

describe('chats controller chat_deleted', () => {
    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
        store.set('user', undefined)
    })

    it('resets the selected chat, closes the socket and refetches the list', async () => {
        store.set('selectedChat', 3)
        const closeChat = sinon.stub().resolves()
        const fetchChats = sinon.stub().resolves([])
        const controller = new ChatsFeatureController(makePort({ fetchChats }), makeMessages({ closeChat }))

        notifyChatDeleted(3)

        // fetchChats асинхронный — даём микрозадачам завершиться
        await Promise.resolve()

        expect(controller).to.be.instanceOf(ChatsFeatureController)
        expect(store.getState().selectedChat).to.eq(undefined)
        expect(closeChat.calledOnceWith(3)).to.be.true
        expect(fetchChats.calledOnce).to.be.true
    })
})

// 2026-10-26-chat-search: подъём чата по активности. Сервер рассылает каждое
// созданное сообщение ВСЕМ сокетам чата, включая сокет автора, — один патч
// last_message в WS-обработчике поднимает и входящие, и собственные
// отправки; пути отправки своего патча нет (иначе двойная запись).
describe('chats ws last_message lift', () => {
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

        triggerMessage(data: string) {
            for (const listener of [...(this.listeners.get('message') ?? [])]) {
                listener({ data })
            }
        }
    }

    // RAW-поле OwnMessageResponse: файловые сообщения несут content null
    const ownMessageResponse = {
        id: 11,
        chat_id: 3,
        user_id: 7,
        content: 'hello',
        file_id: null,
        client_message_id: null,
        created_at: '2026-10-26T10:00:00Z',
    }

    let clock: sinon.SinonFakeTimers
    let originalWebSocket: typeof WebSocket

    beforeEach(() => {
        clock = sinon.useFakeTimers()
        created.length = 0
        originalWebSocket = globalThis.WebSocket
        globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
        store.set('messages', { 3: [] })
        store.set('chats', [
            { id: 3, title: 'Project', unread_count: 0 },
            { id: 9, title: 'Other', unread_count: 0 },
        ])
    })

    afterEach(() => {
        globalThis.WebSocket = originalWebSocket
        clock.restore()
        store.set('messages', { 3: [] })
        store.set('chats', undefined)
        store.set('user', undefined)
        store.set('selectedChat', undefined)
    })

    function storedLastMessage(chatId: number): unknown {
        return (store.getState().chats ?? [])
            .find(chat => (chat as { id?: number }).id === chatId)?.last_message
    }

    async function connectedSocket(): Promise<{ adapter: OwnWsAdapter; socket: FakeWebSocket }> {
        const adapter = new OwnWsAdapter()
        const connected = adapter.connect(3)

        created[0].triggerOpen()
        await connected

        return { adapter, socket: created[0] }
    }

    it('patches chats[chat_id].last_message with the raw content for incoming messages', async () => {
        const { adapter, socket } = await connectedSocket()

        socket.triggerMessage(JSON.stringify({ type: 'message', content: ownMessageResponse }))

        expect(storedLastMessage(3)).to.deep.eq({ content: 'hello', time: '2026-10-26T10:00:00Z' })
        // соседний чат не тронут
        expect(storedLastMessage(9)).to.eq(undefined)

        await adapter.closeChat(3)
    })

    it('uses the «Вложение» placeholder for file-only incoming messages', async () => {
        const { adapter, socket } = await connectedSocket()

        socket.triggerMessage(JSON.stringify({
            type: 'message',
            content: { ...ownMessageResponse, id: 12, content: null, file_id: 5 },
        }))

        expect(storedLastMessage(3)).to.deep.eq({ content: 'Вложение', time: '2026-10-26T10:00:00Z' })

        await adapter.closeChat(3)
    })

    it('lifts own-sent messages through the same broadcast without a send-path patch', async () => {
        const sendMessage = sinon.stub().resolves()
        const controller = new ChatsFeatureController(makePort(), makeMessages({ sendMessage }))
        const { adapter, socket } = await connectedSocket()

        await controller.sendMessage(3, 'моё')

        // путь отправки в стор не пишет: список ещё держит прежнее состояние
        expect(sendMessage.calledOnceWith(3, 'моё')).to.be.true
        expect(storedLastMessage(3)).to.eq(undefined)

        // сервер вещает созданное сообщение всем сокетам чата, автору в том
        // числе, — это эхо и поднимает чат (тот же механизм, что входящие)
        socket.triggerMessage(JSON.stringify({
            type: 'message',
            content: { ...ownMessageResponse, id: 13, content: 'моё' },
        }))

        expect(storedLastMessage(3)).to.deep.eq({ content: 'моё', time: '2026-10-26T10:00:00Z' })

        await adapter.closeChat(3)
    })
})
