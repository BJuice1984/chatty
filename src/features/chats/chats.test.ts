import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import store from '../../utils/Store.ts'
import { TransportError } from '../../utils/HTTPTransport.ts'
import { resetBusyOverlayForTests } from '../../utils/busyOverlay.ts'
import { NEW_CHAT_TITLE } from '../../utils/constants.ts'
import { ChatsFeatureController, applyReactionDelta, setContactsIntegration, setDocumentSearch, toggleOwnReaction } from './controller.ts'
import { ownChatsPort } from './api/own.ts'
import { chatSearchSlice, chatsSlice } from './store.ts'
import { notifyChatAiToggled, notifyChatDeleted, notifyChatRenamed, notifyReactionEvent, notifyWsConnected, notifyWsUnexpectedClose } from './ws/gateway.ts'
import { OwnWsAdapter } from './ws/own.ts'
import type { ChatsPort } from './ports.ts'
import type { ChatInfo, ChatSearchMatch, Message, ReactionSummary } from '../../utils/types.ts'

const dom = new JSDOM()
global.document = dom.window.document

function makePort(overrides: Partial<ChatsPort> = {}): ChatsPort {
    return {
        fetchChats: async () => [],
        createChat: async () => ({ chatId: 1 }),
        deleteChat: async () => undefined,
        renameChat: async () => undefined,
        enableAi: async () => undefined,
        readAll: async () => ({ updated: 0 }),
        // eslint-disable-next-line no-unused-vars
        getToken: async (chatId: number) => ({ token: `token-${chatId}` }),
        addUsers: async () => undefined,
        removeUsers: async () => undefined,
        leaveChat: async () => undefined,
        rejoinChat: async () => undefined,
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

    // Один бот-ран на чат (2026-11-03): пока в AI-чате жив isPending-
    // плейсхолдер «Ассистент печатает…», повторная отправка игнорируется —
    // параллельные раны вешают модель-провайдера; после снятия pending
    // отправка проходит (старт рана ждёт WS-эхо своего сообщения — вне
    // этого юнит-теста)
    it('should ignore a send into an AI chat while the bot run is pending', async () => {
        const sendMessage = sinon.stub().resolves()
        const controller = new ChatsFeatureController(
            makePort(),
            makeMessages({ sendMessage })
        )
        chatsSlice.setChats([{ id: 3, title: 'ai', avatar: '', unread_count: 0, is_ai: true }] as never)
        storeSetMessages(3, [{ chat_id: 3, time: 't1', type: 'message', user_id: 7, content: 'моё', isPending: true }])

        await controller.sendMessage(3, 'второе')

        expect(sendMessage.called).to.be.false

        storeSetMessages(3, [{ chat_id: 3, time: 't1', type: 'message', user_id: 7, content: 'моё', id: 11 }])
        sendMessage.resetHistory()

        await controller.sendMessage(3, 'второе')

        expect(sendMessage.calledOnceWith(3, 'второе')).to.be.true
    })

    // 2026-10-27-ai-chat-creation: create форвардит is_ai в порт как есть;
    // заголовок ИИ-чата — константа utils/constants (её берут вниз обе
    // фичи, из контроллера чатов она не реэкспортируется)
    it('should forward is_ai to createChat on create', async () => {
        const createChat = sinon.stub().resolves({ chatId: 9 })
        const controller = new ChatsFeatureController(makePort({ createChat }), makeMessages())

        await controller.create({ title: 'AI ассистент', is_ai: true })

        expect(createChat.calledOnceWith({ title: 'AI ассистент', is_ai: true })).to.be.true
    })

    it('should keep a title-only create exactly as before', async () => {
        const createChat = sinon.stub().resolves({ chatId: 9 })
        const controller = new ChatsFeatureController(makePort({ createChat }), makeMessages())

        await controller.create({ title: 'просто чат' })

        // снятый чекбокс/старые вызовы: payload без is_ai, без значения-false
        expect(createChat.calledOnceWith({ title: 'просто чат' })).to.be.true
    })
})

// One-click создание + «+AI» (2026-11-06-chat-create-flow): порядок
// POST → fetchChats → select/getChatUsers, оптимистичные патчи и откат
describe('chats controller create-and-select and enable-ai', () => {
    beforeEach(() => {
        chatsSlice.setChats([])
        store.set('chatUsers', [])
        store.set('selectedChat', undefined)
    })

    afterEach(() => {
        chatsSlice.setChats([])
        store.set('chatUsers', [])
        store.set('selectedChat', undefined)
    })

    function chatRow(overrides: Partial<ChatInfo> = {}): ChatInfo {
        return {
            id: 41,
            title: NEW_CHAT_TITLE,
            avatar: '',
            unread_count: 0,
            ...overrides,
        }
    }

    it('creates the auto-titled chat, refreshes the list, then selects it', async () => {
        const calls: string[] = []
        const fetchChats = sinon.stub().callsFake(async () => {
            calls.push('fetchChats')
            chatsSlice.setChats([chatRow()])

            return [chatRow()]
        })
        const getChatUsers = sinon.stub().callsFake(async () => {
            calls.push('getChatUsers')

            return []
        })
        const createChat = sinon.stub().callsFake(async () => {
            calls.push('createChat')

            return { chatId: 41 }
        })
        const controller = new ChatsFeatureController(
            makePort({ createChat, fetchChats, getChatUsers }),
            makeMessages()
        )

        await controller.createAndSelect()

        // payload: сид авто-названия + флаг (адаптер шлёт только выставленным)
        expect(createChat.calledOnceWith({ title: NEW_CHAT_TITLE, auto_titled: true })).to.be.true
        // порядок обязателен: селект ПОСЛЕ fetch — карточка уже в слайсе
        expect(calls).to.deep.eq(['createChat', 'fetchChats', 'getChatUsers'])
        expect(store.getState().selectedChat).to.eq(41)
    })

    it('stays on the current selection when the port create fails', async () => {
        const createChat = sinon.stub().rejects(new Error('boom'))
        const fetchChats = sinon.stub().resolves([])
        const controller = new ChatsFeatureController(
            makePort({ createChat, fetchChats }),
            makeMessages()
        )

        await controller.createAndSelect()

        expect(fetchChats.notCalled).to.be.true
        expect(store.getState().selectedChat).to.eq(undefined)
    })

    it('enableAi patches is_ai optimistically and reverts on port error', async () => {
        chatsSlice.setChats([chatRow({ id: 7 })])
        const enableAi = sinon.stub().rejects(new Error('boom'))
        const controller = new ChatsFeatureController(makePort({ enableAi }), makeMessages())

        const pending = controller.enableAi(7)

        expect((chatsSlice.getChats().find(chat => chat.id === 7) as ChatInfo).is_ai).to.eq(true)

        await pending

        expect((chatsSlice.getChats().find(chat => chat.id === 7) as ChatInfo).is_ai).to.eq(false)
    })

    it('chat_ai_toggled event patches is_ai in the slice (other clients)', async () => {
        chatsSlice.setChats([chatRow({ id: 7 })])
        new ChatsFeatureController(makePort(), makeMessages())

        notifyChatAiToggled({ chat_id: 7, is_ai: true })

        expect((chatsSlice.getChats().find(chat => chat.id === 7) as ChatInfo).is_ai).to.eq(true)

        // значение-равное событие — идемпотентный пропуск без записи
        notifyChatAiToggled({ chat_id: 7, is_ai: true })

        expect((chatsSlice.getChats().find(chat => chat.id === 7) as ChatInfo).is_ai).to.eq(true)
    })

    // 2026-11-06-quick: сервер сажает бота в участники сразу при включении
    // AI — событие рефетчит состав, чтобы аватарка бота приехала в шапку
    // не после первого ответа
    it('chat_ai_toggled(refresh) refetches the chat members for the bot seat', async () => {
        chatsSlice.setChats([chatRow({ id: 7 })])
        const getChatUsers = sinon.stub().resolves([])
        new ChatsFeatureController(makePort({ getChatUsers }), makeMessages())

        notifyChatAiToggled({ chat_id: 7, is_ai: true })

        await new Promise(resolve => setTimeout(resolve, 0))

        expect(getChatUsers.calledOnceWith(7)).to.be.true

        // выключение AI состав не трогает
        chatsSlice.setChats([chatRow({ id: 7 })])
        notifyChatAiToggled({ chat_id: 7, is_ai: false })

        await new Promise(resolve => setTimeout(resolve, 0))

        expect(getChatUsers.callCount).to.eq(1)
    })

    // 2026-11-06-quick: вход в чат с непрочитанными при живом сокете —
    // Connected-выдача истории не повторится, серверный маркер чтения
    // двигает явный loadHistory (иначе fetchChats возвращал пилюлю)
    it('selectChat re-requests history for a chat with unread and skips a read one', async () => {
        chatsSlice.setChats([
            chatRow({ id: 3, unread_count: 4 } as Partial<ChatInfo>),
            chatRow({ id: 4, unread_count: 0 } as Partial<ChatInfo>),
        ])
        const loadHistory = sinon.stub().resolves()
        const controller = new ChatsFeatureController(makePort(), makeMessages({ loadHistory }))

        controller.selectChat(3)
        controller.selectChat(4)

        expect(loadHistory.calledOnceWith(3, null, 50)).to.be.true
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

// 2026-11-01-chat-leave: кик и собственный выход. Кик — публичный метод
// (мгновенный кик по клику аватара из getChatUsers умер вместе с приватным
// deleteChatUsers); выход архивирует членство — сокет чата гасится без
// реконнекта, выбор сбрасывается, список рефетчится (чат остаётся с leftAt)
describe('chats controller chat leave', () => {
    afterEach(() => {
        store.set('chatUsers', undefined)
        store.set('selectedChat', undefined)
    })

    it('kicks members through the port and refetches both the roster and the list', async () => {
        const removeUsers = sinon.stub().resolves()
        const getChatUsers = sinon.stub().resolves([])
        const fetchChats = sinon.stub().resolves([])
        const controller = new ChatsFeatureController(
            makePort({ removeUsers, getChatUsers, fetchChats }),
            makeMessages()
        )

        await controller.removeUsersFromChat([101, 102], 7)

        expect(removeUsers.calledOnceWith({ users: [101, 102], chatId: 7 })).to.be.true
        expect(getChatUsers.calledOnceWith(7)).to.be.true
        expect(fetchChats.calledOnce).to.be.true
    })

    // закрепляем смерть legacy-провода: состав кладётся как приехал, без
    // onClick — клик по аватару на уровне контроллера ничего не делает
    it('stores the roster without the legacy instant-kick onClick wiring', async () => {
        const controller = new ChatsFeatureController(makePort({
            getChatUsers: async () => [{
                id: 101,
                first_name: 'ada',
                second_name: '',
                display_name: 'ada',
                login: 'ada@example.com',
                email: 'ada@example.com',
                phone: '',
                avatar: '',
            }],
        }), makeMessages())

        await controller.getChatUsers(3)

        const [user] = chatsSlice.getChatUsers() ?? []

        expect(user?.id).to.eq(101)
        expect(user).to.not.have.property('onClick')
    })

    it('leaves through the port, closes the socket without reconnect, clears selection and refetches', async () => {
        store.set('selectedChat', 3)
        const leaveChat = sinon.stub().resolves()
        const closeChat = sinon.stub().resolves()
        const connect = sinon.spy()
        const fetchChats = sinon.stub().resolves([])
        const controller = new ChatsFeatureController(
            makePort({ leaveChat, fetchChats }),
            makeMessages({ closeChat, connect })
        )

        await controller.leaveChat(3)

        expect(leaveChat.calledOnceWith(3)).to.be.true
        expect(store.getState().selectedChat).to.eq(undefined)
        expect(closeChat.calledOnceWith(3)).to.be.true
        expect(connect.notCalled).to.be.true
        expect(fetchChats.calledOnce).to.be.true
    })
})

// 2026-11-01-settings: возврат в архивированный чат. Реактивация через порт,
// затем рефетч списка — карточка сама выходит из «покинутых» (leftAt гаснет);
// ошибка порта молчит, список не трогаем
describe('chats controller chat rejoin', () => {
    afterEach(() => {
        chatsSlice.setChats([])
    })

    it('rejoins through the port and refetches the list', async () => {
        const rejoinChat = sinon.stub().resolves()
        const fetchChats = sinon.stub().resolves([])
        const controller = new ChatsFeatureController(
            makePort({ rejoinChat, fetchChats }),
            makeMessages()
        )

        await controller.rejoinChat(3)

        expect(rejoinChat.calledOnceWith(3)).to.be.true
        expect(fetchChats.calledOnce).to.be.true
    })

    it('stays silent and keeps the list when the port rejects', async () => {
        const errorSpy = sinon.stub(console, 'error')
        const rejoinChat = sinon.stub().rejects(new Error('boom'))
        const fetchChats = sinon.stub().resolves([])
        const controller = new ChatsFeatureController(
            makePort({ rejoinChat, fetchChats }),
            makeMessages()
        )

        try {
            await controller.rejoinChat(3)
        } finally {
            errorSpy.restore()
        }

        expect(fetchChats.notCalled).to.be.true
    })
})

// Адаптер возврата (узор chats/api/api.test.ts): подмена XMLHttpRequest
// закрепляет метод/адрес/CSRF — POST /chats/{id}/rejoin c double-submit
describe('chats api rejoin (fake XHR)', () => {
    interface CapturedCall {
        method: string
        url: string
        headers: Record<string, string>
    }

    class FakeXHR {
        static calls: CapturedCall[] = []

        onload: (() => void) | null = null
        withCredentials = false
        responseType = ''
        timeout = 0
        status = 0
        response: unknown = null

        private method = ''
        private url = ''
        private headers: Record<string, string> = {}

        open(method: string, url: string): void {
            this.method = method
            this.url = url
        }

        setRequestHeader(name: string, value: string): void {
            this.headers[name] = value
        }

        send(): void {
            FakeXHR.calls.push({ method: this.method, url: this.url, headers: { ...this.headers } })

            this.status = 204
            this.response = null
            this.onload?.()
        }
    }

    // URL обязателен: cookie на about:blank jsdom молча отбрасывается
    const dom = new JSDOM('', { url: 'http://localhost/' })

    let originalXHR: typeof XMLHttpRequest
    let originalDocument: Document

    beforeEach(() => {
        originalXHR = globalThis.XMLHttpRequest
        originalDocument = global.document
        global.document = dom.window.document
        FakeXHR.calls = []
        globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest
        dom.window.document.cookie = 'chatty_csrf=token-1'
    })

    afterEach(() => {
        globalThis.XMLHttpRequest = originalXHR
        global.document = originalDocument
        dom.window.document.cookie = 'chatty_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    })

    it('rejoins over POST /chats/{id}/rejoin with the csrf header', async () => {
        await ownChatsPort.rejoinChat(7)

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('POST')
        expect(call.url).to.contain('/chats/7/rejoin')
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
    })
})

// Контактный шов (consumer-side): до связывания — noop (обёртки не падают),
// после инъекции addContact/refreshContacts делегируются объекту целиком
describe('chats controller contacts seam', () => {
    afterEach(() => {
        setContactsIntegration({ addContact: () => {}, refreshContacts: () => {} })
    })

    it('defaults to noop: wrapper calls neither throw nor reach any feature', () => {
        const controller = new ChatsFeatureController(makePort(), makeMessages())

        expect(() => controller.addContact(42)).to.not.throw()
        expect(() => controller.refreshContacts()).to.not.throw()
    })

    it('delegates addContact and refreshContacts to the injected integration', () => {
        const addContact = sinon.spy()
        const refreshContacts = sinon.spy()

        setContactsIntegration({ addContact, refreshContacts })

        const controller = new ChatsFeatureController(makePort(), makeMessages())

        controller.addContact(42)
        controller.refreshContacts()

        expect(addContact.calledOnceWith(42)).to.be.true
        expect(refreshContacts.calledOnceWith()).to.be.true
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

// Прогон бота в is_ai-чате (2026-11-02): путь отправки в стор не пишет —
// своё сообщение доезжает эхом WS. Контроллер ждёт эхо (иначе плейсхолдер
// «Ассистент печатает…» встаёт выше вопроса, а прогон уходит по
// предыдущему message_id), хвостит ленту пульсирующим плейсхолдером на
// всё время POST /bot/runs, снимает его по завершении и показывает сбой
// системным сообщением — по статусу failed, по транспортному reject
// (таймаут/сеть) и по любому непредвиденному выбросу: консоль пользователь
// не смотрит, молчание выглядит как игнор
describe('chats controller bot run', () => {
    afterEach(() => {
        store.set('messages', undefined)
        store.set('user', undefined)
        store.set('chats', [])
        resetBusyOverlayForTests()
    })

    function setupAiChat(): void {
        store.set('user', { id: 7, login: 'a@example.com' } as never)
        store.set('chats', [{ id: 38, title: 'AI ассистент', avatar: '', unread_count: 0, is_ai: true } as never])
        storeSetMessages(38, [{ chat_id: 38, time: 't100', type: 'message', user_id: 7, content: 'старый вопрос', id: 100 }])
    }

    // контроллер поллит стор на setTimeout-тиках — ждём реальным временем
    async function until(condition: () => boolean): Promise<void> {
        const deadline = Date.now() + 2_000

        while (!condition() && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 10))
        }
    }

    // серверное эхо нового сообщения (то, что делает WS-листенер)
    function echoOwnMessage(): void {
        storeSetMessages(38, [
            ...(store.getState().messages?.[38] ?? []).filter(item => item.isPending !== true),
            { chat_id: 38, time: 't101', type: 'message', user_id: 7, content: 'вопрос', id: 101 },
        ])
    }

    const hasPending = () => (store.getState().messages?.[38] ?? []).some(item => item.isPending === true)
    const errorMessage = () => (store.getState().messages?.[38] ?? []).find(item => item.isError === true)

    it('waits for the echo, runs the bot on the NEW message id and tails pending below it', async () => {
        setupAiChat()
        let resolveRun!: (value: { id: number, status: string, error_kind: string | null }) => void
        const runBot = sinon.stub().returns(new Promise<{ id: number, status: string, error_kind: string | null }>(resolve => {
            resolveRun = resolve
        }))
        const controller = new ChatsFeatureController(makePort({ runBot }), makeMessages())

        const sent = controller.sendMessage(38, 'вопрос')

        // до эха ни плейсхолдера, ни прогона
        expect(hasPending()).to.be.false
        expect(runBot.called).to.be.false

        echoOwnMessage()
        await sent
        await until(() => hasPending())

        // прогон ушёл по НОВОМУ id эха, не по предыдущему сообщению
        expect(runBot.calledOnceWith(38, 101)).to.be.true

        // плейсхолдер стоит НИЖЕ вопроса пользователя
        const list = store.getState().messages?.[38] ?? []
        const questionAt = list.findIndex(item => item.id === 101)
        const pendingAt = list.findIndex(item => item.isPending === true)

        expect(questionAt).to.be.greaterThan(-1)
        expect(pendingAt).to.be.greaterThan(questionAt)

        // pending_for — id вопроса (review F-1, единственный создатель хвоста):
        // по этому полю WS-адаптер вяжет bot_delta стрима к хвосту
        expect((list[pendingAt] as { pending_for?: number }).pending_for).to.equal(101)

        resolveRun({ id: 1, status: 'succeeded', error_kind: null })
        await until(() => !hasPending())

        expect(hasPending()).to.be.false
        expect(errorMessage()).to.be.undefined
    })

    it('shows the failure message for a failed run status', async () => {
        setupAiChat()
        const controller = new ChatsFeatureController(
            makePort({ runBot: sinon.stub().resolves({ id: 1, status: 'failed', error_kind: 'provider_unavailable' }) }),
            makeMessages()
        )

        const sent = controller.sendMessage(38, 'вопрос')

        echoOwnMessage()
        await sent
        await until(() => errorMessage() !== undefined)

        expect(errorMessage()?.content).to.equal('⚠ Ассистент недоступен (provider_unavailable). Попробуйте позже.')
        expect(hasPending()).to.be.false
    })

    it('shows the failure message when the run request itself rejects (timeout/network)', async () => {
        setupAiChat()
        const controller = new ChatsFeatureController(
            makePort({ runBot: sinon.stub().rejects(new Error('Время ожидания запроса истекло')) }),
            makeMessages()
        )

        const sent = controller.sendMessage(38, 'вопрос')

        echoOwnMessage()
        await sent
        await until(() => errorMessage() !== undefined)

        expect(errorMessage()?.content).to.contain('Время ожидания запроса истекло')
        expect(hasPending()).to.be.false
    })

    // Сетевой обрыв POST /bot/runs (2026-11-02): ран на сервере мог
    // выполняться — ретрай идемпотентен и не создаёт второй ответ, ошибка
    // не показывается, пока не исчерпаны попытки
    it('retries a network-failed run request without surfacing an error', async () => {
        setupAiChat()
        const runBot = sinon.stub()
            .onFirstCall().callsFake(() => new Promise((_resolve, reject) => {
                setTimeout(() => reject(new TransportError('Ошибка сети. Запрос не выполнен', 'network')), 20)
            }))
            .onSecondCall().callsFake(() => new Promise(resolve => {
                setTimeout(() => resolve({ id: 1, status: 'succeeded', error_kind: null }), 30)
            }))
        const controller = new ChatsFeatureController(
            makePort({ runBot }),
            makeMessages(),
            { botRunRetryDelaysMs: [10] }
        )

        const sent = controller.sendMessage(38, 'вопрос')

        echoOwnMessage()
        await sent
        await until(() => hasPending())
        await until(() => runBot.calledTwice)
        await until(() => !hasPending())

        // единичный сброс сокета (keep-alive) — ретрай-невидимка: оверлея
        // не было вовсе, живой сервер не пугает лоадером (2026-11-06)
        expect(document.getElementById('busy-overlay')).to.be.null

        expect(runBot.calledTwice).to.be.true
        expect(runBot.secondCall.calledWith(38, 101)).to.be.true
        expect(errorMessage()).to.be.undefined
    })

    // Ран ещё идёт (queued/running) — не терминальный исход (2026-11-06,
    // live: обрыв POST на чтении ответа; ретрай возвращал идущий ран, а
    // контроллер гасил pending — «печатает…» исчезало, UI молчал): плашка
    // живёт весь поллинг, ответ доставляется по завершении рана
    it('keeps the pending tail while the run is in progress and finishes on completion', async () => {
        setupAiChat()
        const runBot = sinon.stub()
            .onFirstCall().resolves({ id: 1, status: 'running', error_kind: null })
            .onSecondCall().resolves({ id: 1, status: 'succeeded', error_kind: null })
        const controller = new ChatsFeatureController(
            makePort({ runBot }),
            makeMessages(),
            { botRunRetryDelaysMs: [10], botRunPollIntervalMs: 10 }
        )

        const sent = controller.sendMessage(38, 'вопрос')

        echoOwnMessage()
        await sent
        await until(() => runBot.calledOnce)

        // ран идёт — «печатает…» на месте, никаких молчаливых уходов
        expect(hasPending()).to.be.true

        await until(() => runBot.calledTwice)
        await until(() => !hasPending())

        expect(errorMessage()).to.be.undefined
    })

    it('surfaces an overdue error when the run never completes', async () => {
        setupAiChat()
        const runBot = sinon.stub().resolves({ id: 1, status: 'running', error_kind: null })
        const controller = new ChatsFeatureController(
            makePort({ runBot }),
            makeMessages(),
            { botRunRetryDelaysMs: [10], botRunPollIntervalMs: 10, botRunPollBudgetMs: 35 }
        )

        const sent = controller.sendMessage(38, 'вопрос')

        echoOwnMessage()
        await sent
        await until(() => errorMessage() !== undefined)

        expect(errorMessage()?.content).to.contain('не получен за отведённое время')
        expect(hasPending()).to.be.false
    })

    // Двойной сетевой фейл — настоящий обрыв: reconnect-оверлей открывается
    // перед попытками с паузой и закрывается на восстановлении
    it('shows the reconnect overlay only after two consecutive network failures', async () => {
        setupAiChat()
        const runBot = sinon.stub()
            .onFirstCall().rejects(new TransportError('Ошибка сети. Запрос не выполнен', 'network'))
            .onSecondCall().rejects(new TransportError('Ошибка сети. Запрос не выполнен', 'network'))
            .onThirdCall().resolves({ id: 1, status: 'succeeded', error_kind: null })
        const controller = new ChatsFeatureController(
            makePort({ runBot }),
            makeMessages(),
            { botRunRetryDelaysMs: [50] }
        )

        const sent = controller.sendMessage(38, 'вопрос')

        echoOwnMessage()
        await sent

        // между второй попыткой и третьей (пауза из бюджета) оверлей открыт
        await until(() => runBot.calledTwice && document.getElementById('busy-overlay') !== null)

        await until(() => runBot.calledThrice)
        await until(() => !hasPending())

        // после восстановления оверлей снят: teardown узла — отложенный
        // macrotask (busyOverlay), мгновенная проверка после микрозадач
        // гоняется с таймером снятия — ждём снятия, а не фиксируем миг
        await until(() => document.getElementById('busy-overlay') === null)
        expect(document.getElementById('busy-overlay')).to.be.null

        expect(runBot.calledThrice).to.be.true
        expect(errorMessage()).to.be.undefined
    })

    it('gives up after the retry budget and surfaces the network error', async () => {
        setupAiChat()
        const runBot = sinon.stub().rejects(new TransportError('Ошибка сети. Запрос не выполнен', 'network'))
        const controller = new ChatsFeatureController(
            makePort({ runBot }),
            makeMessages(),
            { botRunRetryDelaysMs: [10] }
        )

        const sent = controller.sendMessage(38, 'вопрос')

        echoOwnMessage()
        await sent
        await until(() => errorMessage() !== undefined)

        // исходная попытка + мгновенный ретрай + ретрай по бюджету [10]
        expect(runBot.calledThrice).to.be.true
        expect(errorMessage()?.content).to.contain('Ошибка сети')
        expect(hasPending()).to.be.false

        await until(() => document.getElementById('busy-overlay') === null)
    })

    // REST-fallback (2026-11-03): WS-сокет умер на нестабильной сети —
    // broadcast ответа потерян, REST-ран 200; ответ догоняется хвостом
    // истории по REST и не требует перезагрузки страницы
    it('delivers the bot answer over the REST fallback when the WS broadcast was lost', async () => {
        setupAiChat()
        const runBot = sinon.stub().resolves({ id: 9, status: 'succeeded', error_kind: null, response_message_id: 200 })
        const fetchMessages = sinon.stub().resolves([
            { chat_id: 38, time: 't200', type: 'message', user_id: -1, content: 'ответ бота', id: 200 },
        ])
        const controller = new ChatsFeatureController(
            makePort({ runBot, fetchMessages }),
            makeMessages(),
            { botRunRetryDelaysMs: [10] }
        )

        const sent = controller.sendMessage(38, 'вопрос')

        echoOwnMessage()
        await sent
        await until(() => (store.getState().messages?.[38] ?? []).some(item => item.id === 200))

        expect(fetchMessages.calledOnce).to.be.true
        expect(hasPending()).to.be.false
    })

    it('skips the REST fallback when the answer already arrived over WS', async () => {
        setupAiChat()
        let resolveRun!: (value: { id: number, status: string, error_kind: string | null, response_message_id?: number }) => void
        const runBot = sinon.stub().returns(new Promise(resolve => {
            resolveRun = resolve
        }))
        const fetchMessages = sinon.stub().resolves([])
        const controller = new ChatsFeatureController(
            makePort({ runBot, fetchMessages }),
            makeMessages(),
            { botRunRetryDelaysMs: [10] }
        )

        const sent = controller.sendMessage(38, 'вопрос')

        echoOwnMessage()
        await until(() => hasPending())

        // broadcast дошёл до resolve рана — ответ уже в сторе
        storeSetMessages(38, [
            { chat_id: 38, time: 't101', type: 'message', user_id: 7, content: 'вопрос', id: 101 },
            { chat_id: 38, time: 't200', type: 'message', user_id: -1, content: 'ответ бота', id: 200 },
        ])

        resolveRun({ id: 9, status: 'succeeded', error_kind: null, response_message_id: 200 })
        await sent

        expect(fetchMessages.called).to.be.false
    })

    // Документы под ответом бота (2026-11-03): RAG-поиск по тексту вопроса
    // даёт настоящий список файлов — контроллер дописывает attachments
    it('attaches the documents found by the question under the bot answer', async () => {
        setupAiChat()
        const runBot = sinon.stub().resolves({ id: 9, status: 'succeeded', error_kind: null, response_message_id: 200 })
        const fetchMessages = sinon.stub().resolves([
            { chat_id: 38, time: 't200', type: 'message', user_id: -1, content: 'вот документы', id: 200 },
        ])
        const controller = new ChatsFeatureController(
            makePort({ runBot, fetchMessages }),
            makeMessages(),
            { botRunRetryDelaysMs: [10] }
        )
        setDocumentSearch({
            search: async () => [
                { name: 'Заявление на отпуск.pdf', url: '/api/v1/files/5/download' },
                { name: 'Бюджет отдела 2026.xlsx', url: '/api/v1/files/6/download' },
            ],
        })

        try {
            const sent = controller.sendMessage(38, 'какие есть документы на отпуск')

            echoOwnMessage()
            await sent
            await until(() => {
                const answer = (store.getState().messages?.[38] ?? []).find(item => item.id === 200) as { attachments?: { name: string }[] } | undefined

                return answer?.attachments != null && answer.attachments.length === 2
            })

            const answer = (store.getState().messages?.[38] ?? []).find(item => item.id === 200) as { attachments?: { name: string, url: string }[] }

            expect(answer.attachments?.map(item => item.name)).to.deep.equal([
                'Заявление на отпуск.pdf',
                'Бюджет отдела 2026.xlsx',
            ])
            expect(answer.attachments?.[0].url).to.equal('/api/v1/files/5/download')
        } finally {
            setDocumentSearch({ search: async () => [] })
        }
    })

    // Композер блокируется isPending-хвостом (botPending): финальное
    // сообщение + finally контроллера снимают хвост — отправка снова
    // доступна, ответ лежит один раз, текст стрима не задваивается
    it('unblocks the composer once the final answer replaces the pending tail', async () => {
        setupAiChat()
        let resolveRun!: (value: { id: number, status: string, error_kind: string | null, response_message_id?: number }) => void
        const runBot = sinon.stub().returns(new Promise(resolve => {
            resolveRun = resolve
        }))
        const controller = new ChatsFeatureController(makePort({ runBot }), makeMessages())

        const sent = controller.sendMessage(38, 'вопрос')

        echoOwnMessage()
        await sent
        await until(() => hasPending())

        // финальный ответ доставлен WS-broadcast'ом (существующий путь)
        storeSetMessages(38, [
            ...(store.getState().messages?.[38] ?? []),
            { chat_id: 38, time: 't200', type: 'message', user_id: -1, content: 'полный ответ', id: 200 },
        ])

        resolveRun({ id: 9, status: 'succeeded', error_kind: null, response_message_id: 200 })
        await until(() => !hasPending())

        const list = store.getState().messages?.[38] ?? []

        expect(list.filter(item => item.id === 200)).to.have.length(1)
        expect(hasPending()).to.be.false
        expect(list.some(item => item.content === 'Ассистент печатает…')).to.be.false
    })
})

// Эхо-таймаут (2026-11-04-bot-wait-offline): 5с бюджет waitForOwnEcho
// исчерпан — честная пользовательская ошибка через pushError вместо
// молчаливого пропуска прогона; фейковые таймеры прокручивают бюджет
describe('chats controller bot echo timeout', () => {
    let clock: sinon.SinonFakeTimers

    beforeEach(() => {
        clock = sinon.useFakeTimers()
        store.set('user', { id: 7, login: 'a@example.com' } as never)
        store.set('chats', [{ id: 38, title: 'AI ассистент', avatar: '', unread_count: 0, is_ai: true } as never])
        storeSetMessages(38, [{ chat_id: 38, time: 't100', type: 'message', user_id: 7, content: 'старый вопрос', id: 100 }])
    })

    afterEach(() => {
        clock.restore()
        store.set('messages', undefined)
        store.set('user', undefined)
        store.set('chats', [])
        resetBusyOverlayForTests()
    })

    it('surfaces an honest user-visible error when the echo never arrives within the 5s budget', async () => {
        const runBot = sinon.stub()
        const controller = new ChatsFeatureController(makePort({ runBot }), makeMessages())

        const sent = controller.sendMessage(38, 'вопрос')

        await sent

        // эхо не приходит — бюджет выжат полным тиком
        await clock.tickAsync(5_200)

        const list = store.getState().messages?.[38] ?? []
        const error = list.find(item => item.isError === true)

        expect(error?.content).to.contain('эхо сообщения не получено')
        expect(runBot.called).to.be.false
        expect(list.some(item => item.isPending === true)).to.be.false
        expect(controller).to.be.instanceOf(ChatsFeatureController)
    })
})

// Индикатор смерти WS (2026-11-04 offline, review F-3): адаптер нотифицирует
// только немаркированные закрытия — контроллер показывает reconnect-оверлей
// на первом падении и гасит на последнем восстановлении (парность show/hide
// per-эпизод, refcount busyOverlay остаётся сбалансированным)
describe('chats controller ws-death indicator', () => {
    beforeEach(() => {
        resetBusyOverlayForTests()
    })

    afterEach(() => {
        resetBusyOverlayForTests()
        store.set('messages', undefined)
        store.set('user', undefined)
        store.set('chats', [])
    })

    it('shows the reconnect overlay on unexpected closes and hides it when every dead chat recovers', async () => {
        const controller = new ChatsFeatureController(makePort(), makeMessages())

        notifyWsUnexpectedClose(3)

        expect(document.getElementById('busy-overlay')).to.be.not.null

        // второй мёртвый чат: оверлей уже стоит, refcount не растёт зря
        notifyWsUnexpectedClose(4)

        // первый ожил — второй ещё мёртв, оверлей держится
        notifyWsConnected(3)

        expect(document.getElementById('busy-overlay')).to.be.not.null

        notifyWsConnected(4)

        await new Promise(resolve => setTimeout(resolve, 1))

        expect(document.getElementById('busy-overlay')).to.be.null
        expect(controller).to.be.instanceOf(ChatsFeatureController)
    })

    it('a first-time Connected is a no-op: no overlay, no stray hide', async () => {
        new ChatsFeatureController(makePort(), makeMessages())

        notifyWsConnected(3)

        expect(document.getElementById('busy-overlay')).to.be.null
    })
})


// 2026-11-05-messenger-ux-pack: inline-переименование, «Пометить всё
// прочитанными» и WS chat_renamed — контроллерские пути
describe('chats controller rename and read-all', () => {
    const seedChats = () => {
        store.set('chats', [
            { id: 3, title: 'Старое имя', avatar: '', unread_count: 2 },
            { id: 4, title: 'Другой', avatar: '', unread_count: 0 },
        ] as never)
    }

    beforeEach(() => {
        seedChats()
    })

    afterEach(() => {
        store.set('chats', [])
    })

    it('renameChat patches the title optimistically and calls the port', async () => {
        const renameChat = sinon.stub().resolves()
        const controller = new ChatsFeatureController(makePort({ renameChat }), makeMessages())

        await controller.renameChat(3, 'Новое имя')

        // оптимистичный патч применён ДО ответа порта (вызов был единственный)
        const chats = store.getState().chats as { id: number, title: string }[]

        expect(chats.find(chat => chat.id === 3)?.title).to.eq('Новое имя')
        expect(chats.find(chat => chat.id === 4)?.title).to.eq('Другой')
        expect(renameChat.calledOnceWith(3, 'Новое имя')).to.be.true
    })

    it('renameChat reverts the title when the port fails', async () => {
        const error = sinon.stub(console, 'error')
        const renameChat = sinon.stub().rejects(new Error('network'))
        const controller = new ChatsFeatureController(makePort({ renameChat }), makeMessages())

        try {
            await controller.renameChat(3, 'Неудачное имя')

            const chats = store.getState().chats as { id: number, title: string }[]

            expect(chats.find(chat => chat.id === 3)?.title).to.eq('Старое имя')
            expect(error.called).to.be.true
        } finally {
            error.restore()
        }
    })

    it('renameChat skips the port for an identical title', async () => {
        const renameChat = sinon.stub().resolves()
        const controller = new ChatsFeatureController(makePort({ renameChat }), makeMessages())

        await controller.renameChat(3, 'Старое имя')

        expect(renameChat.called).to.be.false
    })

    // 2026-11-06 (review F-3): ручной rename гасит auto_titled тем же
    // оптимистичным патчем — адаптер PUT-ответ discard-ит, а WS chat_renamed
    // не различает ручное переименование и серверное автодополнение
    it('renameChat clears auto_titled optimistically and restores it on failure', async () => {
        store.set('chats', [
            { id: 3, title: 'Чат с', avatar: '', unread_count: 0, auto_titled: true },
        ] as never)
        const error = sinon.stub(console, 'error')
        const okRename = sinon.stub().resolves()
        const failRename = sinon.stub().rejects(new Error('network'))
        const okController = new ChatsFeatureController(makePort({ renameChat: okRename }), makeMessages())
        const failController = new ChatsFeatureController(makePort({ renameChat: failRename }), makeMessages())

        try {
            await okController.renameChat(3, 'Моё название')

            let row = (store.getState().chats as { id: number, title: string, auto_titled?: boolean }[]).find(chat => chat.id === 3)

            expect(row?.auto_titled).to.eq(undefined)

            await failController.renameChat(3, 'Ещё одно')

            row = (store.getState().chats as { id: number, title: string, auto_titled?: boolean }[]).find(chat => chat.id === 3)

            expect(row?.title).to.eq('Моё название')
            expect(row?.auto_titled).to.eq(undefined)
        } finally {
            error.restore()
        }
    })

    // 2026-11-06 (review F-7): смена чата сбрасывает chatUsers до ответа
    // getChatUsers — устаревшие соучастники прошлого чата не флипают гейт
    // подсказки пустого чата
    it('selectChat clears the stale chatUsers slice', () => {
        store.set('chatUsers', [{ id: 9, first_name: 'Боб' } as never])
        const controller = new ChatsFeatureController(makePort(), makeMessages())

        controller.selectChat(3)

        expect(store.getState().selectedChat).to.eq(3)
        expect(store.getState().chatUsers ?? []).to.deep.eq([])
    })

    it('markAllRead zeroes every unread pill after a successful port call', async () => {
        const readAll = sinon.stub().resolves({ updated: 2 })
        const controller = new ChatsFeatureController(makePort({ readAll }), makeMessages())

        await controller.markAllRead()

        const chats = store.getState().chats as { id: number, unread_count: number }[]

        expect(chats.every(chat => chat.unread_count === 0)).to.be.true
        expect(readAll.calledOnce).to.be.true
    })

    it('markAllRead keeps the pills when the port fails', async () => {
        const error = sinon.stub(console, 'error')
        const controller = new ChatsFeatureController(makePort({ readAll: sinon.stub().rejects(new Error('x')) }), makeMessages())

        try {
            await controller.markAllRead()

            const chats = store.getState().chats as { id: number, unread_count: number }[]

            expect(chats.find(chat => chat.id === 3)?.unread_count).to.eq(2)
        } finally {
            error.restore()
        }
    })

    it('notifyChatRenamed patches a foreign rename and skips identical titles', () => {
        new ChatsFeatureController(makePort(), makeMessages())

        notifyChatRenamed({ chat_id: 4, title: 'Переименовали извне' })

        let chats = store.getState().chats as { id: number, title: string }[]

        expect(chats.find(chat => chat.id === 4)?.title).to.eq('Переименовали извне')

        // идемпотентный noop: чужое событие с тем же title не дёргает стор
        notifyChatRenamed({ chat_id: 4, title: 'Переименовали извне' })

        chats = store.getState().chats as { id: number, title: string }[]

        expect(chats.find(chat => chat.id === 4)?.title).to.eq('Переименовали извне')
    })

    // 2026-11-06-llm-chat-autotitle: ЛЮБОЙ chat_renamed финализирует
    // авто-название — сервер гасит auto_titled той же транзакцией (LLM-титул
    // или чужой ручной rename), identical-title пропускается только для
    // чатов с уже погашенным флагом (LLM могла вернуть текущий заголовок)
    it('notifyChatRenamed finalizes an auto-titled chat even on an identical title', () => {
        store.set('chats', [
            { id: 5, title: 'Чат с', avatar: '', unread_count: 0, auto_titled: true },
        ] as never)
        new ChatsFeatureController(makePort(), makeMessages())

        // LLM вернула текущий сид — title не изменился, но флаг сервер погасил
        notifyChatRenamed({ chat_id: 5, title: 'Чат с' })

        let row = (store.getState().chats as { id: number, title: string, auto_titled?: boolean }[]).find(chat => chat.id === 5)

        expect(row?.title).to.eq('Чат с')
        expect(row?.auto_titled).to.eq(undefined)

        // LLM-титул с реальным переименованием: и title, и гашение флага
        notifyChatRenamed({ chat_id: 5, title: 'Webpack CDN' })

        row = (store.getState().chats as { id: number, title: string, auto_titled?: boolean }[]).find(chat => chat.id === 5)

        expect(row?.title).to.eq('Webpack CDN')
        expect(row?.auto_titled).to.eq(undefined)
    })
})
