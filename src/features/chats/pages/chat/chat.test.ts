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
import Handlebars from 'handlebars'
import type Block from '../../../../core/Block.ts'
import { registerComponent } from '../../../../core/registerComponent.ts'
import * as Components from '../../../../components/components.ts'
import { SearchBar } from '../../../../components/searchBar/searchBar.ts'

// Живой поиск: юнит-рендер страницы требует настоящих хелперов SearchBar
// и User (chat.hbs вызывает их компонент-хелпами). Регистрация — как в
// прод-сборке main.ts через components.ts; гвард от повторной загрузки
// модуля — прецедент login/messenger-тестов
Object.entries(Components).forEach(([name, component]) => {
    if (!(name in Handlebars.helpers)) {
        registerComponent(name, component as typeof Block)
    }
})

interface ChatPageCallbacks {
    onSelectChat: (id: number) => void
    onBack: () => void
    chatPaneOpen: boolean
    onSearchUsers?: (login: string) => Promise<unknown[]>
    // живой поиск по чатам: страница прокидывает запрос контроллеру
    onSearchChats?: (query: string) => void
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
    // CDM открывает глобальный stories-сокет; WebSocket-глобала в юнит-
    // окружении нет (на Node ≥ 22 нативный клиент реально ходил бы в сеть)
    // — стабим на каждый тест, как fetchChats; логика сокета покрыта
    // своим модулем (stories/ws/own.test.ts)
    let storiesSocket: sinon.SinonStub

    beforeEach(() => {
        storiesSocket = sinon.stub(StoriesController, 'connectStoriesSocket')
    })

    afterEach(() => {
        storiesSocket.restore()
    })

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

    // 2026-11-01-contacts: вход на страницу с живым выбором (навигация из
    // /contacts после openDm) открывает панель чата, а не список
    it('starts with the pane open when a chat is already selected', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            store.set('selectedChat', 4)

            const page = new ChatPage({} as never)

            expect(callbacksOf(page).chatPaneOpen).to.be.true

            page.destroy()
        } finally {
            fetchChats.restore()
            store.set('selectedChat', undefined)
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
    let storiesSocket: sinon.SinonStub

    beforeEach(() => {
        storiesSocket = sinon.stub(StoriesController, 'connectStoriesSocket')
    })

    afterEach(() => {
        storiesSocket.restore()
    })

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

    it('opens the stories socket on componentDidMount alongside the feed fetch', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)

            // stories-ws-push: конструктор молчит — сокет открывается из CDM
            expect(storiesSocket.called).to.be.false

            page.dispatchComponentDidMount()

            expect(storiesSocket.calledOnce).to.be.true

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
    let storiesSocket: sinon.SinonStub

    beforeEach(() => {
        storiesSocket = sinon.stub(StoriesController, 'connectStoriesSocket')
    })

    afterEach(() => {
        storiesSocket.restore()
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
    let storiesSocket: sinon.SinonStub

    beforeEach(() => {
        storiesSocket = sinon.stub(StoriesController, 'connectStoriesSocket')
    })

    afterEach(() => {
        storiesSocket.restore()
    })

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
    let storiesSocket: sinon.SinonStub

    const feed = [
        {
            id: 41,
            owner: 'Midala Huininja',
            ownerAvatarUrl: '',
            src: 'http://localhost:8000/api/v1/files/11/download',
            alt: 'История Midala Huininja',
            viewed: false,
            createdAt: '2026-10-25T10:00:00Z',
        },
        {
            id: 42,
            owner: 'Athalia Putri',
            ownerAvatarUrl: '',
            src: 'http://localhost:8000/api/v1/files/12/download',
            alt: 'История Athalia Putri',
            viewed: false,
            createdAt: '2026-10-25T10:00:00Z',
        },
        {
            id: 43,
            owner: 'Erlan Sadewa',
            ownerAvatarUrl: '',
            src: 'http://localhost:8000/api/v1/files/13/download',
            alt: 'История Erlan Sadewa',
            viewed: false,
            createdAt: '2026-10-25T10:00:00Z',
        },
    ]

    beforeEach(() => {
        clock = sinon.useFakeTimers()
        store.set('stories', feed)
        storiesSocket = sinon.stub(StoriesController, 'connectStoriesSocket')
    })

    afterEach(() => {
        storiesSocket.restore()
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

    it('deleting an own story closes the viewer without marking it viewed', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const fetchStories = sinon.stub(StoriesController, 'fetchStories').resolves()
        const markViewed = sinon.stub(StoriesController, 'markViewed')
        const deleteStory = sinon.stub(StoriesController, 'deleteStory').resolves()

        try {
            // собственная история (isOwn) — в рендер-листе она с зелёным
            // кольцом, вьюер получает кнопку удаления
            store.set('stories', [{
                id: 51,
                owner: 'me',
                ownerAvatarUrl: '',
                src: 'http://localhost:8000/api/v1/files/21/download',
                alt: 'История me',
                viewed: false,
                isOwn: true,
                createdAt: '2026-10-25T10:00:00Z',
            }])

            const page = new ChatPage({} as never)

            callbacksOf(page).onSelectStory?.('51')

            const props = callbacksOf(page) as { onDeleteViewer?: () => void, viewerStory?: { isOwn?: boolean } | null }

            expect(props.viewerStory?.isOwn).to.be.true

            props.onDeleteViewer?.()

            // вьюер закрыт, удаление уехало контроллеру с числовым id,
            // просмотр НЕ маркируется — история исчезнет после рефетча
            expect(callbacksOf(page).viewerStory).to.be.null
            expect(deleteStory.calledOnceWith(51)).to.be.true
            expect(markViewed.called).to.be.false

            page.destroy()
        } finally {
            deleteStory.restore()
            markViewed.restore()
            fetchStories.restore()
            fetchChats.restore()
        }
    })

    it('hides rings past the server TTL on render: a stale story does not open', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const fetchStories = sinon.stub(StoriesController, 'fetchStories').resolves()
        const markViewed = sinon.stub(StoriesController, 'markViewed')

        try {
            // фейковые таймеры стартуют с «ноль»: двигаем системное время на
            // фикс-точку, где feed (10:00 сегодня) жив, а история двухдневной
            // давности — истекла по серверному TTL 24ч
            clock.setSystemTime(Date.parse('2026-10-25T12:00:00Z'))
            store.set('stories', [
                ...feed,
                {
                    id: 99,
                    owner: 'Stale Ring',
                    ownerAvatarUrl: '',
                    src: 'http://localhost:8000/api/v1/files/99/download',
                    alt: 'История Stale Ring',
                    viewed: false,
                    createdAt: '2026-10-23T00:00:00Z',
                },
            ])

            const page = new ChatPage({} as never)
            const select = callbacksOf(page).onSelectStory

            // истёкшее кольцо не открывается — рендер-фильтр убрал его
            // из списка; свежее — открывается
            select?.('99')
            expect((callbacksOf(page) as { viewerStory?: unknown }).viewerStory).to.not.exist

            select?.('41')
            expect((callbacksOf(page) as { viewerStory?: unknown }).viewerStory).to.exist
            expect(markViewed.called).to.be.false

            page.destroy()
        } finally {
            markViewed.restore()
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


// Живой поиск по чатам (2026-10-26-chat-search): пустой запрос — порядок
// по активности (новые сверху, без last_message — вниз, ничья id DESC);
// активный запрос — только найденные чаты в порядке сервера; фокус и
// незакоммиченный текст поиска переживают стор-эмит посреди набора.
describe('chat page search list', () => {
    let storiesSocket: sinon.SinonStub
    let fetchChats: sinon.SinonStub

    beforeEach(() => {
        storiesSocket = sinon.stub(StoriesController, 'connectStoriesSocket')
        fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
    })

    afterEach(() => {
        store.set('chatSearch', undefined)
        store.set('chats', undefined)
        resetSearchBarMemory()
        fetchChats.restore()
        storiesSocket.restore()
    })

    const titlesOf = (page: { element?: Element | null }): string[] =>
        Array.from(page.element?.querySelectorAll('.chat-list-user__title') ?? [])
            .map(node => (node.textContent ?? '').trim())

    // Модульная память бара глобальна: мид-тайпинг-тест пачкает её,
    // возвращаем к чистому листу теми же событиями (идиома resetMemory
    // в searchBar.test.ts — отдельного сеттера сознательно нет)
    const resetSearchBarMemory = (): void => {
        const bar = new SearchBar()
        const input = bar.element?.querySelector<HTMLInputElement>('input[name="chat_search"]')

        if (input == null) {
            throw new Error('инпут поиска не отрендерился')
        }

        input.value = ''
        input.dispatchEvent(new MouseEvent('input', { bubbles: true }))
        input.dispatchEvent(new MouseEvent('focusout', { bubbles: true }))
        bar.destroy()
    }

    it('orders the empty-query list by last message time, sinking undated chats', () => {
        store.set('chats', [
            { id: 1, title: 'старый', avatar: '', unread_count: 0, last_message: { time: '2026-01-01T00:00:00Z', content: 'a' } },
            { id: 3, title: 'равный времени', avatar: '', unread_count: 0, last_message: { time: '2026-06-01T00:00:00Z', content: 'd' } },
            { id: 5, title: 'новый', avatar: '', unread_count: 0, last_message: { time: '2026-06-01T00:00:00Z', content: 'b' } },
            { id: 9, title: 'без сообщений', avatar: '', unread_count: 0 },
            { id: 2, title: 'битая дата', avatar: '', unread_count: 0, last_message: { time: 'не-дата', content: 'c' } },
        ])

        const page = new ChatPage({} as never)

        // датированные по убыванию (ничья 06-01 — id DESC: 5 раньше 3),
        // недатированные тонут (id DESC: 9 раньше 2)
        expect(titlesOf(page)).to.deep.equal(['новый', 'равный времени', 'старый', 'без сообщений', 'битая дата'])

        page.destroy()
    })

    it('shows only the matching chats in the server order while searching', () => {
        store.set('chats', [
            { id: 1, title: 'Almond', avatar: '', unread_count: 0, last_message: { time: '2026-01-05T00:00:00Z', content: 'заголовок' } },
            { id: 2, title: 'Beta', avatar: '', unread_count: 0, last_message: { time: '2026-02-05T00:00:00Z', content: 'мимо' } },
            { id: 3, title: 'Gamma', avatar: '', unread_count: 0, last_message: { time: '2026-03-05T00:00:00Z', content: 'calm sea' } },
        ])
        store.set('chatSearch', {
            query: 'lm',
            results: [
                { chat_id: 3, matched_in: 'message', snippet: { before: 'ca', match: 'lm', after: ' sea' }, last_match_at: '2026-10-20T10:00:00Z' },
                { chat_id: 1, matched_in: 'title', snippet: null, last_match_at: null },
            ],
        })

        const page = new ChatPage({} as never)

        expect(titlesOf(page)).to.deep.equal(['Gamma', 'Almond'])

        const rows = Array.from(page.element?.querySelectorAll('.chat-list-user') ?? [])
        // Gamma: message-совпадение — mark в сниппете, время — last_match_at
        expect(rows[0]?.querySelector('.chat-list-user__snippet mark')?.textContent).to.equal('lm')
        expect(rows[0]?.querySelector('.chat-list-user__time')?.textContent).to.equal('2026-10-20T10:00:00Z')
        // Almond: title-совпадение — mark в заголовке; сниппета нет (R-F2) —
        // обычная реплика, время — last_message.time
        expect(rows[1]?.querySelector('.chat-list-user__title mark')?.textContent).to.equal('lm')
        expect(rows[1]?.querySelector('.chat-list-user__snippet')?.textContent?.trim()).to.equal('заголовок')
        expect(rows[1]?.querySelector('.chat-list-user__time')?.textContent).to.equal('2026-01-05T00:00:00Z')

        page.destroy()
    })

    it('wires the search bar query to the controller', () => {
        const searchChats = sinon.stub(ChatsController, 'searchChats').resolves()

        try {
            const page = new ChatPage({} as never)
            callbacksOf(page).onSearchChats?.('query')
            expect(searchChats.calledOnceWith('query')).to.be.true
            page.destroy()
        } finally {
            searchChats.restore()
        }
    })

    it('preserves the typed text and focus across a store emit mid-typing', async () => {
        const page = new ChatPage({} as never)

        // фокус работает только у узлов в документе
        document.body.appendChild(page.element as HTMLElement)

        const input = page.element?.querySelector<HTMLInputElement>('input[name="chat_search"]')
        expect(input).to.exist

        input!.value = 'ab'
        input!.setSelectionRange(1, 1)
        input!.dispatchEvent(new MouseEvent('input', { bubbles: true }))

        // стор-эмит посреди набора (например, WS-сообщение): hbs-дети
        // пересоздаются, текст ещё не закоммичен дебаунсом
        store.set('chats', [
            { id: 1, title: 'Almond', avatar: '', unread_count: 0 },
        ])

        // восстановление — в кадре (rAF или setTimeout-фолбэк окружения)
        await new Promise(resolve => setTimeout(resolve, 20))

        const revived = page.element?.querySelector<HTMLInputElement>('input[name="chat_search"]')
        expect(revived).to.exist
        expect(revived!.value).to.equal('ab')
        expect(revived).to.equal(document.activeElement)
        expect(revived!.selectionStart).to.equal(1)
        expect(revived!.selectionEnd).to.equal(1)

        page.destroy()
    })
})
