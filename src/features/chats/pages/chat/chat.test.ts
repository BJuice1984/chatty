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
import StoriesController from '../../stories/controller.ts'
import { ChatPage } from './chat.ts'

interface ChatPageCallbacks {
    onSelectChat: (id: number) => void
    onBack: () => void
    chatPaneOpen: boolean
    onSearchUsers?: (login: string) => Promise<unknown[]>
    onAddUser?: (userId: number, chatId: number) => Promise<void>
    onSetReaction?: (chatId: number, messageId: number, emoji: string) => void
    onSendMessage?: (chatId: number, message: string, replyToId?: number) => void
    // stories: срез стора (DTO-форма, числовые id); рендер-список
    // (add-плитка + строковые id) страница строит только в render()
    onSelectStory?: (id?: string) => void
    onCloseViewer?: () => void
    viewerStory?: { owner: string, src: string, alt: string } | null
    stories?: {
        id: number
        owner: string
        src: string
        alt: string
        viewed: boolean
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

// stories: лента — срез стора (features/chats/stories), таймер автозакрытия
// принадлежит странице; страница НЕ пишет stories-пропсы: гашение кольца —
// markViewed контроллера (синхронный стор-патч), что и проверяется стабами
describe('chat page stories', () => {
    let clock: sinon.SinonFakeTimers

    const feed = [
        {
            id: 41,
            owner: 'Midala Huininja',
            ownerAvatarUrl: '',
            src: 'http://localhost:8000/api/v1/files/11/download',
            alt: 'История Midala Huininja',
            viewed: false,
        },
        {
            id: 42,
            owner: 'Athalia Putri',
            ownerAvatarUrl: '',
            src: 'http://localhost:8000/api/v1/files/12/download',
            alt: 'История Athalia Putri',
            viewed: false,
        },
        {
            id: 43,
            owner: 'Erlan Sadewa',
            ownerAvatarUrl: '',
            src: 'http://localhost:8000/api/v1/files/13/download',
            alt: 'История Erlan Sadewa',
            viewed: false,
        },
    ]

    beforeEach(() => {
        clock = sinon.useFakeTimers()
        store.set('stories', feed)
    })

    afterEach(() => {
        clock.restore()
        store.set('chats', undefined)
        store.set('stories', undefined)
    })

    it('opens the viewer on a story click and auto-closes at 5000 ms calling markViewed', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const fetchStories = sinon.stub(StoriesController, 'fetchStories').resolves()
        const markViewed = sinon.stub(StoriesController, 'markViewed')

        try {
            const page = new ChatPage({} as never)

            callbacksOf(page).onSelectStory?.('41')

            expect(callbacksOf(page).viewerStory?.src).to.eq(feed[0].src)

            clock.tick(4999)
            expect(callbacksOf(page).viewerStory).to.not.be.null

            clock.tick(1)
            expect(callbacksOf(page).viewerStory).to.be.null

            // просмотр маркирует контроллер с числовым id — ровно один раз
            expect(markViewed.calledOnceWith(41)).to.be.true

            // страница не трогала срез: props.stories — прежний объект
            expect(callbacksOf(page).stories).to.equal(feed)

            page.destroy()
        } finally {
            markViewed.restore()
            fetchStories.restore()
            fetchChats.restore()
        }
    })

    it('manual close clears the timer: no late fire after the viewer is closed', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const fetchStories = sinon.stub(StoriesController, 'fetchStories').resolves()
        const markViewed = sinon.stub(StoriesController, 'markViewed')

        try {
            const page = new ChatPage({} as never)

            callbacksOf(page).onSelectStory?.('41')
            callbacksOf(page).onCloseViewer?.()

            expect(callbacksOf(page).viewerStory).to.be.null
            expect(markViewed.calledOnceWith(41)).to.be.true

            const storiesAfterClose = callbacksOf(page).stories

            clock.tick(5000)

            // повторного close и markViewed не было: срез не менялся
            expect(markViewed.calledOnce).to.be.true
            expect(callbacksOf(page).stories).to.equal(storiesAfterClose)
            expect(callbacksOf(page).viewerStory).to.be.null

            page.destroy()
        } finally {
            markViewed.restore()
            fetchStories.restore()
            fetchChats.restore()
        }
    })

    it('keeps the viewer open through an unrelated re-render (store update)', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const fetchStories = sinon.stub(StoriesController, 'fetchStories').resolves()
        const markViewed = sinon.stub(StoriesController, 'markViewed')

        try {
            const page = new ChatPage({} as never)

            callbacksOf(page).onSelectStory?.('42')

            // посторонняя перерисовка: withStore принёс новые chats
            store.set('chats', [])

            expect(callbacksOf(page).viewerStory?.src).to.eq(feed[1].src)

            // исходный таймер продолжает жить и закрывает один раз
            clock.tick(5000)

            expect(callbacksOf(page).viewerStory).to.be.null
            expect(markViewed.calledOnceWith(42)).to.be.true

            page.destroy()
        } finally {
            markViewed.restore()
            fetchStories.restore()
            fetchChats.restore()
        }
    })

    it('routes a picked photo to the controller upload through the delegated change, surviving re-renders', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const fetchStories = sinon.stub(StoriesController, 'fetchStories').resolves()
        const uploadStory = sinon.stub(StoriesController, 'uploadStory').resolves()
        // setup-фаза открывает/закрывает вьюер: просмотр не предмет теста,
        // реальный markViewed патчил бы срез (identity-ассерты ниже)
        const markViewed = sinon.stub(StoriesController, 'markViewed')

        try {
            const page = new ChatPage({} as never)

            // посторонние ре-рендеры до выбора: открытие/автозакрытие
            // вьюера перерисовало страницу (события обязаны навеситься заново)
            callbacksOf(page).onSelectStory?.('41')
            clock.tick(5000)
            expect(callbacksOf(page).viewerStory).to.be.null

            // end-to-end через делегированный change: files подменяем —
            // настоящий FileList в jsdom не собрать
            const input = page.element?.querySelector('input[type="file"]') as HTMLInputElement
            const file = new File(['photo'], 'photo.png', { type: 'image/png' })

            Object.defineProperty(input, 'files', { value: [file], configurable: true })
            input.dispatchEvent(new window.Event('change', { bubbles: true }))

            // файл ушёл контроллеру ровно один раз; никакой оптимистичной
            // вставки — срез тот же (ленту рефетчит контроллер)
            expect(uploadStory.calledOnce).to.be.true
            expect((uploadStory.firstCall.args[0] as File).name).to.eq('photo.png')
            expect(callbacksOf(page).stories).to.equal(feed)

            // вьюер при добавлении не открывался
            expect(callbacksOf(page).viewerStory).to.be.null

            // DOM-порядок: add-плитка первой в ряду историй
            const tiles = page.element?.querySelectorAll('.chat-story .chat-story__container')

            expect(tiles?.[0]?.classList.contains('chat-story__container_type_add-story')).to.be.true

            page.destroy()
        } finally {
            markViewed.restore()
            uploadStory.restore()
            fetchStories.restore()
            fetchChats.restore()
        }
    })

    it('ignores chat-avatar file inputs: an avatar change never uploads a story', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const fetchStories = sinon.stub(StoriesController, 'fetchStories').resolves()
        const uploadStory = sinon.stub(StoriesController, 'uploadStory').resolves()
        const changeChatAvatar = sinon.stub(ChatsController, 'changeChatAvatar').resolves()

        try {
            // непустой список чатов: в users-list рендерятся скрытые
            // аватарные инпуты (InputFile name=avatar id=<chatId>)
            store.set('chats', [
                { id: 1, title: 'Chat 1', unread_count: 0 },
                { id: 2, title: 'Chat 2', unread_count: 0 },
            ])

            const page = new ChatPage({} as never)
            const avatarInput = page.element?.querySelector(
                'input[type="file"]:not(.chat-story-file-input)'
            ) as HTMLInputElement

            expect(avatarInput, 'chat avatar inputs rendered').to.not.be.null

            const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })

            Object.defineProperty(avatarInput, 'files', { value: [file], configurable: true })
            avatarInput.dispatchEvent(new window.Event('change', { bubbles: true }))

            // смена аватара чата — не история: сторизный контроллер не позван
            expect(uploadStory.called).to.be.false

            page.destroy()
        } finally {
            changeChatAvatar.restore()
            uploadStory.restore()
            fetchStories.restore()
            fetchChats.restore()
        }
    })

    it('the add tile opens the story picker, not the first chat avatar input', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const fetchStories = sinon.stub(StoriesController, 'fetchStories').resolves()
        const clicked: HTMLElement[] = []
        // HTMLElement нет в node-глобалах mochaSetup, а глобальный window
        // может быть из другого jsdom (тест-файлы перезаписывают document) —
        // окно берём у текущего document, в котором рендерит Block
        const elementCtor = (document.defaultView ?? window) as typeof window
        const click = sinon.stub(elementCtor.HTMLElement.prototype, 'click').callsFake(function (this: HTMLElement) {
            clicked.push(this)
        })

        try {
            store.set('chats', [
                { id: 1, title: 'Chat 1', unread_count: 0 },
                { id: 2, title: 'Chat 2', unread_count: 0 },
            ])

            const page = new ChatPage({} as never)

            callbacksOf(page).onSelectStory?.('add-story')

            // пикер открылся на сторизном инпуте: аватарные инпуты чатов
            // идут в DOM раньше и обязаны быть пропущены
            expect(clicked).to.have.lengthOf(1)
            expect(clicked[0]?.className).to.contain('chat-story-file-input')

            page.destroy()
        } finally {
            click.restore()
            fetchStories.restore()
            fetchChats.restore()
        }
    })

    it('marks only the viewed story; delegated change without a file is a no-op', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const fetchStories = sinon.stub(StoriesController, 'fetchStories').resolves()
        const markViewed = sinon.stub(StoriesController, 'markViewed')
        const uploadStory = sinon.stub(StoriesController, 'uploadStory').resolves()

        try {
            const page = new ChatPage({} as never)

            callbacksOf(page).onSelectStory?.('43')
            callbacksOf(page).onCloseViewer?.()

            // markViewed — только закрытая история, срез страница не меняла
            expect(markViewed.calledOnceWith(43)).to.be.true
            expect(callbacksOf(page).stories).to.equal(feed)

            // делегированный change: input без файла игнорируется
            const input = page.element?.querySelector('input[type="file"]') as HTMLInputElement | null
            const change = new window.Event('change', { bubbles: true })

            input?.dispatchEvent(change)

            expect(uploadStory.called).to.be.false
            expect(callbacksOf(page).stories).to.equal(feed)

            page.destroy()
        } finally {
            uploadStory.restore()
            markViewed.restore()
            fetchStories.restore()
            fetchChats.restore()
        }
    })
})
