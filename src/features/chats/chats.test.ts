import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import store from '../../utils/Store.ts'
import { ChatsFeatureController, applyReactionDelta, toggleOwnReaction } from './controller.ts'
import { chatsSlice } from './store.ts'
import { notifyChatDeleted, notifyReactionEvent } from './ws/gateway.ts'
import type { ChatsPort } from './ports.ts'
import type { Message, ReactionSummary } from '../../utils/types.ts'

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
