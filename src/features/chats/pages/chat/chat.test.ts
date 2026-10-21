// Регрессия LIVE-3: страница чатов запрашивает список чатов при каждом
// заходе — SPA-вход после логина не повторяет bootstrap из main.ts.
// Фетч живёт в componentDidMount: Router диспатчит CDM при монтировании,
// уход с маршрута уничтожает инстанс, возврат монтирует свежий.
// chat-ui-polish: мобильное переключение chatPaneOpen — выбор чата (включая
// повторный) открывает панель, onBack возвращает список.
// chats-social: chat_deleted очищает selectedChat в сторе — панель обязана
// вернуться к списку; страница пробрасывает колбэки @-поиска/реакций в
// мессенджер через контроллер фичи.

import { expect } from 'chai'
import sinon from 'sinon'
import '../../../ai-assistant/hbs-test-loader.ts'
import store from '../../../../utils/Store.ts'
import ChatsController from '../../controller.ts'
import { ChatPage } from './chat.ts'

interface ChatPageCallbacks {
    onSelectChat: (id: number) => void
    onBack: () => void
    chatPaneOpen: boolean
    onSearchUsers?: (login: string) => Promise<unknown[]>
    onAddUser?: (userId: number, chatId: number) => Promise<void>
    onSetReaction?: (chatId: number, messageId: number, emoji: string) => void
    onSendMessage?: (chatId: number, message: string, replyToId?: number) => void
    // stories (мок-стадия)
    onSelectStory?: (id?: string) => void
    onCloseViewer?: () => void
    viewerStory?: { owner: string, src: string, alt: string } | null
    stories?: {
        id: string
        owner: string
        src: string
        alt: string
        isUnread?: boolean
        type?: string
    }[]
}

function callbacksOf(page: unknown): ChatPageCallbacks {
    return (page as unknown as { props: ChatPageCallbacks }).props
}

describe('chat page mobile pane switch', () => {
    it('starts with the pane closed', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)

            expect(callbacksOf(page).chatPaneOpen).to.be.false

            page.destroy()
        } finally {
            fetchChats.restore()
        }
    })

    it('opens the pane on chat selection and closes it on back', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const selectChat = sinon.stub(ChatsController, 'selectChat')
        const getChatUsers = sinon.stub(ChatsController, 'getChatUsers').resolves()

        try {
            const page = new ChatPage({} as never)
            const props = callbacksOf(page)

            props.onSelectChat(3)

            expect(props.chatPaneOpen).to.be.true
            expect(selectChat.calledOnceWith(3)).to.be.true
            expect(getChatUsers.calledOnceWith(3)).to.be.true

            props.onBack()

            expect(props.chatPaneOpen).to.be.false

            page.destroy()
        } finally {
            getChatUsers.restore()
            selectChat.restore()
            fetchChats.restore()
        }
    })

    it('re-opens the pane on a repeated click on the same chat', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const selectChat = sinon.stub(ChatsController, 'selectChat')
        const getChatUsers = sinon.stub(ChatsController, 'getChatUsers').resolves()

        try {
            const page = new ChatPage({} as never)
            const props = callbacksOf(page)

            // chatListUser стреляет onSelect всегда — в том числе по уже
            // выбранному чату
            props.onSelectChat(5)
            props.onBack()
            props.onSelectChat(5)

            expect(props.chatPaneOpen).to.be.true
            expect(selectChat.calledTwice).to.be.true

            page.destroy()
        } finally {
            getChatUsers.restore()
            selectChat.restore()
            fetchChats.restore()
        }
    })
})

describe('chat page bootstrap', () => {
    it('fetches chats on componentDidMount, not on construction (LIVE-3)', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)

            // Конструктор не фетчит: список приходит только через CDM.
            expect(fetchChats.called).to.be.false

            page.dispatchComponentDidMount()
            expect(fetchChats.calledOnce).to.be.true

            page.destroy()
        } finally {
            fetchChats.restore()
        }
    })

    it('re-fetches chats when the page re-enters with a fresh instance (LIVE-3)', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const first = new ChatPage({} as never)
            first.dispatchComponentDidMount()
            first.destroy()

            // Повторный заход: Router уничтожил прежний инстанс (leave) и
            // смонтировал новый — фетч повторяется.
            const second = new ChatPage({} as never)
            second.dispatchComponentDidMount()

            expect(fetchChats.callCount).to.eq(2)

            second.destroy()
        } finally {
            fetchChats.restore()
        }
    })
})

// chats-social: chat_deleted сбрасывает selectedChat в сторе — панель чата
// возвращается к списку без ручного onBack
describe('chat page chat_deleted pane reset', () => {
    afterEach(() => {
        store.set('selectedChat', undefined)
    })

    it('closes the open pane when selectedChat is cleared from the store', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)
            const props = callbacksOf(page)

            props.onSelectChat(3)
            expect(props.chatPaneOpen).to.be.true

            // WS chat_deleted: контроллер очистил выбор — withStore принёс
            // undefined, componentDidUpdate вернул панель к списку
            store.set('selectedChat', undefined)

            expect(callbacksOf(page).chatPaneOpen).to.be.false

            page.destroy()
        } finally {
            fetchChats.restore()
        }
    })

    it('keeps the pane closed logic idempotent while no chat is selected', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)

            store.set('selectedChat', undefined)
            store.set('chats', [])

            expect(callbacksOf(page).chatPaneOpen).to.be.false

            page.destroy()
        } finally {
            fetchChats.restore()
            store.set('chats', undefined)
        }
    })
})

// chats-social: страница пробрасывает новые колбэки мессенджера в контроллер
describe('chat page social callbacks', () => {
    it('wires the typed user search through the controller', async () => {
        const searchUsers = sinon.stub(ChatsController, 'searchUsers').resolves([{ id: 9, login: 'b@example.com', display_name: 'b' }])
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)
            const results = await callbacksOf(page).onSearchUsers?.('b')

            expect(searchUsers.calledOnceWith('b')).to.be.true
            expect(results).to.deep.eq([{ id: 9, login: 'b@example.com', display_name: 'b' }])

            page.destroy()
        } finally {
            searchUsers.restore()
            fetchChats.restore()
        }
    })

    it('wires the picked-user add, reactions and reply sends', async () => {
        const addUsersToChat = sinon.stub(ChatsController, 'addUsersToChat').resolves()
        const setReaction = sinon.stub(ChatsController, 'setReaction').resolves()
        const sendMessage = sinon.stub(ChatsController, 'sendMessage').resolves()
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)
            const props = callbacksOf(page)

            await props.onAddUser?.(101, 7)
            expect(addUsersToChat.calledOnceWith([101], 7)).to.be.true

            props.onSetReaction?.(7, 11, '👍')
            expect(setReaction.calledOnceWith(7, 11, '👍')).to.be.true

            props.onSendMessage?.(7, 'ответ', 11)
            expect(sendMessage.calledOnceWith(7, 'ответ', 11)).to.be.true

            page.destroy()
        } finally {
            sendMessage.restore()
            setReaction.restore()
            addUsersToChat.restore()
            fetchChats.restore()
        }
    })
})

// stories (мок-стадия): таймер автозакрытия принадлежит странице —
// авто-закрытие, ручные close-пути и устойчивость к посторонним
// перерисовкам проверяются здесь, у владельца таймера
describe('chat page stories', () => {
    let clock: sinon.SinonFakeTimers

    // Node-глобал URL не даёт createObjectURL (это браузерный/jsdom API) —
    // минимальный тестовый полифилл, прод-код зовёт настоящий API
    if (typeof URL.createObjectURL !== 'function') {
        ;(URL as unknown as { createObjectURL: (file: File) => string }).createObjectURL =
            (file: File) => `blob:mock-${file.name}`
    }

    beforeEach(() => {
        clock = sinon.useFakeTimers()
    })

    afterEach(() => {
        clock.restore()
        store.set('chats', undefined)
    })

    it('opens the viewer on a story click and auto-closes at 5000 ms marking it viewed', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)

            callbacksOf(page).onSelectStory?.('story-mock-1')

            expect(callbacksOf(page).viewerStory?.src).to.eq('/images/ava-1.jpg')

            clock.tick(4999)
            expect(callbacksOf(page).viewerStory).to.not.be.null

            clock.tick(1)
            expect(callbacksOf(page).viewerStory).to.be.null

            const viewed = callbacksOf(page).stories?.find(story => story.id === 'story-mock-1')
            const other = callbacksOf(page).stories?.find(story => story.id === 'story-mock-2')

            expect(viewed?.isUnread).to.be.false
            expect(other?.isUnread).to.be.true

            page.destroy()
        } finally {
            fetchChats.restore()
        }
    })

    it('manual close clears the timer: no late fire after the viewer is closed', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)

            callbacksOf(page).onSelectStory?.('story-mock-1')
            callbacksOf(page).onCloseViewer?.()

            expect(callbacksOf(page).viewerStory).to.be.null

            const storiesAfterClose = callbacksOf(page).stories

            clock.tick(5000)

            // повторного close не было: массив историй тот же объект
            expect(callbacksOf(page).stories).to.equal(storiesAfterClose)
            expect(callbacksOf(page).viewerStory).to.be.null

            page.destroy()
        } finally {
            fetchChats.restore()
        }
    })

    it('keeps the viewer open through an unrelated re-render (store update)', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)

            callbacksOf(page).onSelectStory?.('story-mock-2')

            // посторонняя перерисовка: withStore принёс новые chats
            store.set('chats', [])

            expect(callbacksOf(page).viewerStory?.src).to.eq('/images/ava-2.jpg')

            // исходный таймер продолжает жить и закрывает один раз
            clock.tick(5000)

            expect(callbacksOf(page).viewerStory).to.be.null
            expect(callbacksOf(page).stories?.find(story => story.id === 'story-mock-2')?.isUnread).to.be.false

            page.destroy()
        } finally {
            fetchChats.restore()
        }
    })

    it('prepends a picked photo as an unread story through the delegated change, surviving re-renders', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)
            const before = callbacksOf(page).stories ?? []

            // посторонние ре-рендеры до выбора: открытие/автозакрытие
            // вьюера перерисовало страницу (события обязаны навеситься заново)
            callbacksOf(page).onSelectStory?.('story-mock-1')
            clock.tick(5000)
            expect(callbacksOf(page).viewerStory).to.be.null

            // end-to-end через делегированный change: files подменяем —
            // настоящий FileList в jsdom не собрать
            const input = page.element?.querySelector('input[type="file"]') as HTMLInputElement
            const file = new File(['photo'], 'photo.png', { type: 'image/png' })

            Object.defineProperty(input, 'files', { value: [file], configurable: true })
            input.dispatchEvent(new window.Event('change', { bubbles: true }))

            const after = callbacksOf(page).stories ?? []

            expect(after.length).to.eq(before.length + 1)
            expect(after[0]?.type).to.eq('add')
            expect(after[1]?.owner).to.eq('You story')
            expect(after[1]?.isUnread).to.be.true
            expect(after[1]?.src.startsWith('blob:')).to.be.true

            // вьюер при добавлении не открывался
            expect(callbacksOf(page).viewerStory).to.be.null

            // DOM-порядок: add-плитка осталась первой в ряду историй
            const tiles = page.element?.querySelectorAll('.chat-story .chat-story__container')

            expect(tiles?.length).to.eq(after.length)
            expect(tiles?.[0]?.classList.contains('chat-story__container_type_add-story')).to.be.true

            page.destroy()
        } finally {
            fetchChats.restore()
        }
    })

    it('marks only the viewed story; delegated change without a file is a no-op', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)

            callbacksOf(page).onSelectStory?.('story-mock-3')
            callbacksOf(page).onCloseViewer?.()

            const stories = callbacksOf(page).stories ?? []
            const viewed = stories.filter(story => story.isUnread === false)

            expect(viewed.map(story => story.id)).to.deep.eq(['story-mock-3'])

            // делегированный change: input без файла игнорируется, value сброшен
            const input = page.element?.querySelector('input[type="file"]') as HTMLInputElement | null
            const change = new window.Event('change', { bubbles: true })

            input?.dispatchEvent(change)

            expect((callbacksOf(page).stories ?? []).length).to.eq(stories.length)

            page.destroy()
        } finally {
            fetchChats.restore()
        }
    })
})
