// Регрессия LIVE-3: страница чатов запрашивает список чатов при каждом
// заходе — SPA-вход после логина не повторяет bootstrap из main.ts.
// Фетч живёт в componentDidMount: Router диспатчит CDM при монтировании,
// уход с маршрута уничтожает инстанс, возврат монтирует свежий.
// chat-ui-polish: мобильное переключение chatPaneOpen — выбор чата (включая
// повторный) открывает панель, onBack возвращает список.
// 2026-11-04-mobile-back-deselect: onBack сбрасывает selectedChat в сторе
// через ChatsController.closeChatFeed() — свежий монтаж даёт список.
// chats-social: chat_deleted очищает selectedChat в сторе — панель обязана
// вернуться к списку; страница пробрасывает колбэки @-поиска/реакций в
// мессенджер через контроллер фичи.
// 2026-11-01-chat-leave: меню участника — CDM бутстрапит контакты, мэппер
// даёт contactIds/meId/ownerId, колбэки ведут в контроллер фичи.

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
import { getFeedScroll, resetFeedScrollForTests, setFeedScroll } from '../../../../components/messenger/feed-scroll.ts'

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
    // меню участника (2026-11-01-chat-leave): матрица видимости + колбэки
    contactIds?: number[]
    meId?: number
    ownerId?: number
    onAddContact?: (userId: number) => void
    onKickUser?: (userId: number, chatId: number) => void
    onLeaveChat?: (chatId: number) => void
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

    // 2026-11-07-messenger-ux-pack-2: пустой список на первичной загрузке
    // показывает лоадер-точки вместо мёртвой пустоты; ПРЕДЗАГРУЗОЧНОЕ
    // состояние (chats undefined до первого ответа) — тоже лоадер (иначе
    // пустота мигает даже на быстром хосте); после загрузки (даже пустой)
    // и при живом списке лоадера нет
    it('shows the chats-list loader while the initial fetch runs on an empty list', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            store.set('chats', undefined)
            store.set('chatsLoading', false)

            const page = new ChatPage({} as never)

            // предзагрузочное окно: chats ещё не приезжали — лоадер сразу
            expect(page.element?.querySelector('[data-testid="chats-loading"]')).to.be.not.null

            // панель сообщений в это окно пуста: гейт chatsLoading не даёт
            // дисклеймеру «Выберите чат» мигать до первого ответа /chats
            expect(page.element?.querySelector('.chat__disclaimer')).to.eq(null)
            expect(page.element?.querySelector('[data-testid="disclaimer-empty"]')).to.eq(null)

            store.set('chats', [])
            store.set('chatsLoading', true)

            const loader = page.element?.querySelector('[data-testid="chats-loading"]')

            expect(loader).to.be.not.null
            expect(loader?.getAttribute('role')).to.eq('status')

            store.set('chatsLoading', false)

            expect(page.element?.querySelector('[data-testid="chats-loading"]')).to.eq(null)

            // refresh с непустым списком: лоадер не мигает поверх карточек
            store.set('chats', [{ id: 1, title: 'Чат', avatar: '', unread_count: 0 } as never])
            store.set('chatsLoading', true)

            expect(page.element?.querySelector('[data-testid="chats-loading"]')).to.eq(null)

            page.destroy()
        } finally {
            fetchChats.restore()
            store.set('chatsLoading', undefined)
            store.set('chats', [])
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

            // onBack сбрасывает selectedChat через контроллер: selectChat
            // здесь замокан и стор пуст — праймим живым выбором (паттерн
            // chat_deleted-пина), иначе undefined поверх undefined не
            // эмитит и гвард не стреляет
            store.set('selectedChat', 3)

            props.onBack()

            expect(props.chatPaneOpen).to.be.false

            page.destroy()
        } finally {
            getChatUsers.restore()
            selectChat.restore()
            fetchChats.restore()
            store.set('selectedChat', undefined)
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

    // 2026-11-04-mobile-back-deselect: «назад» обязан сбрасывать выбор в
    // сторе — свежий монтаж страницы (bottom-bar «Чаты») ре-дедуцирует
    // chatPaneOpen из selectedChat и без сброса открывает прежний чат
    it('back clears the selected chat in the store; a fresh mount shows the list', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const selectChat = sinon.stub(ChatsController, 'selectChat')
        const getChatUsers = sinon.stub(ChatsController, 'getChatUsers').resolves()

        try {
            const page = new ChatPage({} as never)
            const props = callbacksOf(page)

            props.onSelectChat(7)

            // реальный selectChat пишет выбор в стор — здесь он замокан,
            // праймим руками тем же id, что ушёл в колбэк
            store.set('selectedChat', 7)
            expect(callbacksOf(page).chatPaneOpen).to.be.true

            props.onBack()

            expect(store.getState().selectedChat).to.be.undefined
            expect(callbacksOf(page).chatPaneOpen).to.be.false

            page.destroy()

            // повторный заход: свежий инстанс ре-дедуцирует панель из
            // стора — список, а не прежний чат
            const revisit = new ChatPage({} as never)

            expect(callbacksOf(revisit).chatPaneOpen).to.be.false

            revisit.destroy()
        } finally {
            getChatUsers.restore()
            selectChat.restore()
            fetchChats.restore()
            store.set('selectedChat', undefined)
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

// Меню участника (2026-11-01-chat-leave): CDM бутстрапит слайс контактов
// (холодный вход в /messenger), мэппер снабжает матрицу видимости
// (contactIds/meId/ownerId), колбэки ведут в контроллер, карточка
// архивного чата гаснет модификатором от leftAt прямо в списке страницы
describe('chat page member menu wiring', () => {
    let storiesSocket: sinon.SinonStub
    let fetchChats: sinon.SinonStub

    beforeEach(() => {
        storiesSocket = sinon.stub(StoriesController, 'connectStoriesSocket')
        fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
    })

    afterEach(() => {
        fetchChats.restore()
        storiesSocket.restore()
        store.set('chats', undefined)
        store.set('contacts', undefined)
        store.set('user', undefined)
        store.set('selectedChat', undefined)
    })

    it('refreshes the contacts slice on componentDidMount, not on construction', () => {
        const refreshContacts = sinon.stub(ChatsController, 'refreshContacts')

        try {
            const page = new ChatPage({} as never)

            expect(refreshContacts.called).to.be.false

            page.dispatchComponentDidMount()

            expect(refreshContacts.calledOnce).to.be.true

            page.destroy()
        } finally {
            refreshContacts.restore()
        }
    })

    it('maps contactIds, meId and ownerId into the page props', () => {
        store.set('user', {
            id: 7,
            display_name: 'Я',
            first_name: '',
            second_name: '',
            email: 'me@chatty.local',
            login: 'me@chatty.local',
            phone: '',
            avatar: '',
        })
        store.set('contacts', [
            { id: 3, login: 'a@example.com', display_name: 'a', avatar: '' },
            { id: 9, login: 'b@example.com', display_name: 'b', avatar: '' },
        ])
        store.set('chats', [{ id: 5, title: 'чат', avatar: '', unread_count: 0, owner_id: 42 }])
        store.set('selectedChat', 5)

        const page = new ChatPage({} as never)

        try {
            const props = callbacksOf(page)

            expect(props.contactIds).to.deep.eq([3, 9])
            expect(props.meId).to.eq(7)
            expect(props.ownerId).to.eq(42)
        } finally {
            page.destroy()
        }
    })

    it('wires the member-menu callbacks into the controller', () => {
        const addContact = sinon.stub(ChatsController, 'addContact')
        const removeUsersFromChat = sinon.stub(ChatsController, 'removeUsersFromChat').resolves()
        const leaveChat = sinon.stub(ChatsController, 'leaveChat').resolves()

        try {
            const page = new ChatPage({} as never)
            const props = callbacksOf(page)

            props.onAddContact?.(9)
            expect(addContact.calledOnceWith(9)).to.be.true

            props.onKickUser?.(9, 5)
            expect(removeUsersFromChat.calledOnceWith([9], 5)).to.be.true

            props.onLeaveChat?.(5)
            expect(leaveChat.calledOnceWith(5)).to.be.true

            page.destroy()
        } finally {
            leaveChat.restore()
            removeUsersFromChat.restore()
            addContact.restore()
        }
    })

    it('renders the dimmed archived card from leftAt in the chat list', () => {
        store.set('chats', [
            { id: 5, title: 'покинутый', avatar: '', unread_count: 0, leftAt: '2026-11-01T09:00:00Z' },
            { id: 6, title: 'активный', avatar: '', unread_count: 0 },
        ])

        const page = new ChatPage({} as never)

        try {
            const rows = Array.from(page.element?.querySelectorAll('.chat-list-user') ?? [])
            const archivedRow = rows.find(row => row.textContent?.includes('покинутый'))
            const activeRow = rows.find(row => row.textContent?.includes('активный'))

            expect(archivedRow?.classList.contains('chat-list-user_archived')).to.be.true
            expect(activeRow?.classList.contains('chat-list-user_archived')).to.be.false
        } finally {
            page.destroy()
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
            // непустой список чатов + выбранный чат: карточки списка БОЛЬШЕ
            // не несут аватарных инпутов (2026-11-05 — аффорданс переехал в
            // шапку мессенджера), скрытый инпут ровно один — в шапке
            store.set('chats', [
                { id: 1, title: 'Chat 1', unread_count: 0, owner_id: 7 },
                { id: 2, title: 'Chat 2', unread_count: 0 },
            ])
            store.set('messages', { 1: [] })
            store.set('selectedChat', 1)
            store.set('user', { id: 7 })

            const page = new ChatPage({} as never)
            const avatarInputs = page.element?.querySelectorAll(
                'input[type="file"]:not(.chat-story-file-input)'
            )

            expect(avatarInputs?.length, 'exactly one header avatar input').to.equal(1)

            const avatarInput = avatarInputs?.[0] as HTMLInputElement
            const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })

            Object.defineProperty(avatarInput, 'files', { value: [file], configurable: true })
            avatarInput.dispatchEvent(new window.Event('change', { bubbles: true }))

            // смена аватара чата — не история: сторизный контроллер не позван
            expect(uploadStory.called).to.be.false

            page.destroy()
        } finally {
            store.set('selectedChat', undefined)
            store.set('messages', {})
            store.set('user', undefined)
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


// 2026-10-27-ai-chat-creation: обе формы явного создания ИИ-чата сходятся
// на ChatsController.create — (A) чекбокс сосед Form читается по
// refs.create в момент сабмита (сериализация до страницы не доходит),
// (B) плитка «Чат с AI» шлёт дефолтный заголовок из utils/constants
describe('chat page one-click creation (2026-11-06-chat-create-flow)', () => {
    let storiesSocket: sinon.SinonStub

    beforeEach(() => {
        storiesSocket = sinon.stub(StoriesController, 'connectStoriesSocket')
    })

    afterEach(() => {
        storiesSocket.restore()
    })

    it('the header button click goes straight to createAndSelect', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const createAndSelect = sinon.stub(ChatsController, 'createAndSelect').resolves()

        try {
            const page = new ChatPage({} as never)

            ;(callbacksOf(page) as { onClick?: () => void }).onClick?.()

            expect(createAndSelect.calledOnce).to.be.true

            page.destroy()
        } finally {
            createAndSelect.restore()
            fetchChats.restore()
        }
    })

    it('no ChatListCreate card, form or is_ai checkbox mounts', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)

            expect(page.element?.querySelector('.chat-list-create')).to.eq(null)
            expect(page.element?.querySelector('input[name="is_ai"]')).to.eq(null)
            expect(page.element?.querySelector('input[name="title"]')).to.eq(null)

            page.destroy()
        } finally {
            fetchChats.restore()
        }
    })

    it('an external selectedChat change opens the mobile pane, undefined collapses it', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()

        try {
            const page = new ChatPage({} as never)
            const pane = () => (page.element as HTMLElement).className.includes('chat_pane-open')

            expect(pane()).to.be.false

            // программный селект (createAndSelect): стор-эмит приносит новый
            // selectedChat — CDU-гвард открывает панель
            store.set('selectedChat', 41)

            expect(pane()).to.be.true

            store.set('selectedChat', undefined)

            expect(pane()).to.be.false

            page.destroy()
        } finally {
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


    // 2026-11-05-messenger-ux-pack: created_at-fallback — свежесозданный чат
    // без сообщений больше не тонет: сортируется датой создания между
    // датированными, ниже новее-сообщений, выше старее
    it('lifts a freshly created message-less chat above older dated chats (created_at fallback)', () => {
        store.set('chats', [
            { id: 1, title: 'давний диалог', avatar: '', unread_count: 0, last_message: { time: '2026-01-01T00:00:00Z', content: 'a' }, created_at: '2025-12-31T00:00:00Z' },
            { id: 2, title: 'живой чат', avatar: '', unread_count: 0, last_message: { time: '2026-11-05T09:00:00Z', content: 'b' }, created_at: '2026-01-01T00:00:00Z' },
            { id: 3, title: 'только что созданный', avatar: '', unread_count: 0, created_at: '2026-11-05T10:00:00Z' },
        ])

        const page = new ChatPage({} as never)

        // созданный в 10:00 выше чата с последним сообщением в 09:00 —
        // «новый чат в верху списка»; давний диалог ниже всех
        expect(titlesOf(page)).to.deep.equal(['только что созданный', 'живой чат', 'давний диалог'])

        page.destroy()
    })

    it('falls back to id DESC among equally dated new chats', () => {
        store.set('chats', [
            { id: 7, title: 'старший id', avatar: '', unread_count: 0, created_at: '2026-11-05T10:00:00Z' },
            { id: 8, title: 'младший id', avatar: '', unread_count: 0, created_at: '2026-11-05T10:00:00Z' },
        ])

        const page = new ChatPage({} as never)

        expect(titlesOf(page)).to.deep.equal(['младший id', 'старший id'])

        page.destroy()
    })

    // '@'-режим: member-совпадение рисуется подсвеченным сниппетом (имя
    // совпавшего участника), заголовок без mark (review F-3 — пин живёт в
    // этой волне, владеющей chat.test.ts)
    it('renders a member match with the highlighted snippet and no title mark', () => {
        store.set('chats', [
            { id: 4, title: 'Общий чат', avatar: '', unread_count: 0, last_message: { time: '2026-03-05T00:00:00Z', content: 'привет' } },
        ])
        store.set('chatSearch', {
            query: '@bob',
            results: [
                { chat_id: 4, matched_in: 'member', snippet: { before: '', match: 'bob@example.com', after: '' }, last_match_at: null },
            ],
        })

        const page = new ChatPage({} as never)

        const row = page.element?.querySelector('.chat-list-user')

        expect(row?.querySelector('.chat-list-user__title mark')).to.not.exist
        expect(row?.querySelector('.chat-list-user__snippet mark')?.textContent).to.equal('bob@example.com')

        page.destroy()
    })

    it('shows only the matching chats in the server order while searching', () => {
        store.set('chats', [
            { id: 1, title: 'Almond', avatar: '', unread_count: 0, last_message: { time: '2026-01-05T07:08:00', content: 'заголовок' } },
            { id: 2, title: 'Beta', avatar: '', unread_count: 0, last_message: { time: '2026-02-05T00:00:00Z', content: 'мимо' } },
            { id: 3, title: 'Gamma', avatar: '', unread_count: 0, last_message: { time: '2026-03-05T00:00:00Z', content: 'calm sea' } },
        ])
        store.set('chatSearch', {
            query: 'lm',
            results: [
                { chat_id: 3, matched_in: 'message', snippet: { before: 'ca', match: 'lm', after: ' sea' }, last_match_at: '2026-10-20T10:00:00' },
                { chat_id: 1, matched_in: 'title', snippet: null, last_match_at: null },
            ],
        })

        const page = new ChatPage({} as never)

        expect(titlesOf(page)).to.deep.equal(['Gamma', 'Almond'])

        const rows = Array.from(page.element?.querySelectorAll('.chat-list-user') ?? [])
        // Gamma: message-совпадение — mark в сниппете, время — last_match_at
        // (карточка рендерит ЧЧ:ММ; локальная ISO-фикстура без Z стабильна
        // в любой таймзоне прогона)
        expect(rows[0]?.querySelector('.chat-list-user__snippet mark')?.textContent).to.equal('lm')
        expect(rows[0]?.querySelector('.chat-list-user__time')?.textContent?.trim()).to.equal('10:00')
        // Almond: title-совпадение — mark в заголовке; сниппета нет (R-F2) —
        // обычная реплика, время — last_message.time
        expect(rows[1]?.querySelector('.chat-list-user__title mark')?.textContent).to.equal('lm')
        expect(rows[1]?.querySelector('.chat-list-user__snippet')?.textContent?.trim()).to.equal('заголовок')
        expect(rows[1]?.querySelector('.chat-list-user__time')?.textContent?.trim()).to.equal('07:08')

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

// Автоскролл ленты (2026-11-02-ui-ux): стор-управляемые решения принимает
// страница (стабильный инстанс) на общей памяти feed-scroll — смена чата
// чистит память и едет в низ; рост ХВОСТА при прижатом низе (или с
// pending-плейсхолдером бота) докручивает; рост ГОЛОВЫ («загрузить ещё»)
// и чтение выше низа возвращают сохранённую позицию. jsdom без layout:
// scrollHeight/clientHeight подменяются дескрипторами на ЖИВОЙ узел после
// синхронного ре-рендера (нода пересоздаётся), проверяются РЕШЕНИЯ
// (планируемый bottom против сохранённого top), не пиксели.
describe('chat page feed autoscroll decisions', () => {
    const message = (id: number, isPending?: boolean) =>
        ({ chat_id: 5, time: `t${id}`, type: 'message', user_id: 7, content: `m${id}`, id, ...(isPending ? { isPending: true } : {}) })

    const withGeometry = (page: { element?: Element | null }, scrollHeight: number, clientHeight: number) => {
        const container = page.element?.querySelector('.messenger__container')

        expect(container, 'messenger container mounted').to.exist

        Object.defineProperty(container, 'scrollHeight', { value: scrollHeight, configurable: true })
        Object.defineProperty(container, 'clientHeight', { value: clientHeight, configurable: true })

        return container as { scrollTop: number }
    }

    const settle = () => new Promise(resolve => setTimeout(resolve, 20))

    beforeEach(() => {
        resetFeedScrollForTests()
        store.set('chats', [{ id: 5, title: 'чат', avatar: '', unread_count: 0 }, { id: 6, title: 'второй', avatar: '', unread_count: 0 }])
        store.set('messages', { 5: [message(1), message(2), message(3)] })
        store.set('selectedChat', 5)
    })

    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
        store.set('chats', undefined)
        resetFeedScrollForTests()
    })

    it('a chat change scrolls to the bottom and clears that chat memory', async () => {
        const page = new ChatPage({} as never)

        try {
            withGeometry(page, 1000, 400)
            await settle()

            store.set('messages', { 5: [message(1), message(2), message(3)], 6: [message(1), message(2), message(3)] })
            store.set('selectedChat', 6)
            withGeometry(page, 1000, 400)
            await settle()

            expect(getFeedScroll(6)?.pinned).to.be.true

            const container = page.element?.querySelector('.messenger__container') as { scrollTop: number }

            expect(container.scrollTop).to.equal(1000)
        } finally {
            page.destroy()
        }
    })

    it('a tail append while pinned scrolls to the bottom', async () => {
        const page = new ChatPage({} as never)

        try {
            withGeometry(page, 1000, 400)
            await settle()

            store.set('messages', { 5: [message(1), message(2), message(3), message(4)] })
            withGeometry(page, 1200, 400)
            await settle()

            const container = page.element?.querySelector('.messenger__container') as { scrollTop: number }

            expect(container.scrollTop).to.equal(1200)
        } finally {
            page.destroy()
        }
    })

    it('a tail append while reading history keeps the saved top', async () => {
        const page = new ChatPage({} as never)

        try {
            const container = withGeometry(page, 1000, 400)

            await settle()

            // читатель не у низа: документ-синк модуля записал позицию
            container.scrollTop = 100
            setFeedScroll(5, { top: 100, pinned: false })

            store.set('messages', { 5: [message(1), message(2), message(3), message(4)] })
            withGeometry(page, 1200, 400)
            await settle()

            const after = page.element?.querySelector('.messenger__container') as { scrollTop: number }

            expect(after.scrollTop).to.equal(100)
        } finally {
            page.destroy()
        }
    })

    it('a head growth (load older) restores the saved top, never the bottom', async () => {
        const page = new ChatPage({} as never)

        try {
            const container = withGeometry(page, 1000, 400)

            await settle()

            container.scrollTop = 100
            setFeedScroll(5, { top: 100, pinned: false })

            store.set('messages', { 5: [message(0), message(1), message(2), message(3)] })
            withGeometry(page, 2000, 400)
            await settle()

            const after = page.element?.querySelector('.messenger__container') as { scrollTop: number }

            expect(after.scrollTop).to.equal(100)
        } finally {
            page.destroy()
        }
    })

    it('a pending typing tail pins the bottom even while reading history', async () => {
        const page = new ChatPage({} as never)

        try {
            const container = withGeometry(page, 1000, 400)

            await settle()

            container.scrollTop = 100
            setFeedScroll(5, { top: 100, pinned: false })

            store.set('messages', { 5: [message(1), message(2), message(3), message(4, true)] })
            withGeometry(page, 1300, 400)
            await settle()

            const after = page.element?.querySelector('.messenger__container') as { scrollTop: number }

            expect(after.scrollTop).to.equal(1300)
        } finally {
            page.destroy()
        }
    })
})

// 2026-11-08-mobile-messenger-ux: свайп-навигация вьюера историй —
// страница-владелец превращает onSwipe в next/prev/close с маркировкой
// просмотра; плюс scss-пины мобильного layout-зажима (истории больше
// не выпихивают панель за экран) и hover-подложки карандаша
describe('chat page viewer swipe navigation', () => {
    let clock: sinon.SinonFakeTimers
    let storiesSocket: sinon.SinonStub

    const feed = [41, 42, 43].map((id, index) => ({
        id,
        owner: `Owner ${index}`,
        ownerAvatarUrl: '',
        src: `http://localhost:8000/api/v1/files/1${id}/download`,
        alt: `История ${index}`,
        viewed: false,
        createdAt: '2026-10-25T10:00:00Z',
    }))

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

    function openFirst(page: unknown): void {
        callbacksOf(page).onSelectStory?.('41')
    }

    it('swipe left marks the current story viewed and opens the next one', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const fetchStories = sinon.stub(StoriesController, 'fetchStories').resolves()
        const markViewed = sinon.stub(StoriesController, 'markViewed')

        try {
            const page = new ChatPage({} as never)

            openFirst(page)
            ;(callbacksOf(page) as unknown as { onSwipeViewer: (d: 'left' | 'right' | 'down') => void }).onSwipeViewer('left')

            expect(markViewed.calledOnceWith(41)).to.be.true
            expect(callbacksOf(page).viewerStory?.src).to.eq(feed[1].src)

            page.destroy()
        } finally {
            markViewed.restore()
            fetchStories.restore()
            fetchChats.restore()
        }
    })

    it('swipe left past the last story closes the viewer via the close path', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const fetchStories = sinon.stub(StoriesController, 'fetchStories').resolves()
        const markViewed = sinon.stub(StoriesController, 'markViewed')

        try {
            const page = new ChatPage({} as never)

            callbacksOf(page).onSelectStory?.('43')
            ;(callbacksOf(page) as unknown as { onSwipeViewer: (d: 'left' | 'right' | 'down') => void }).onSwipeViewer('left')

            // за последней — close-путь: маркировка ровно один раз, вьюер закрыт
            expect(markViewed.calledOnceWith(43)).to.be.true
            expect(callbacksOf(page).viewerStory).to.be.null

            page.destroy()
        } finally {
            markViewed.restore()
            fetchStories.restore()
            fetchChats.restore()
        }
    })

    it('swipe right opens the previous story; before the first it closes', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const fetchStories = sinon.stub(StoriesController, 'fetchStories').resolves()
        const markViewed = sinon.stub(StoriesController, 'markViewed')

        try {
            const page = new ChatPage({} as never)
            const swipe = (callbacksOf(page) as unknown as { onSwipeViewer: (d: 'left' | 'right' | 'down') => void }).onSwipeViewer

            callbacksOf(page).onSelectStory?.('42')
            swipe('right')
            expect(callbacksOf(page).viewerStory?.src).to.eq(feed[0].src)
            expect(markViewed.called).to.be.false

            swipe('right')
            // перед первой — close-путь с маркировкой текущей
            expect(callbacksOf(page).viewerStory).to.be.null
            expect(markViewed.calledOnceWith(41)).to.be.true

            page.destroy()
        } finally {
            markViewed.restore()
            fetchStories.restore()
            fetchChats.restore()
        }
    })

    it('swipe down runs the plain close path', () => {
        const fetchChats = sinon.stub(ChatsController, 'fetchChats').resolves()
        const fetchStories = sinon.stub(StoriesController, 'fetchStories').resolves()
        const markViewed = sinon.stub(StoriesController, 'markViewed')

        try {
            const page = new ChatPage({} as never)

            openFirst(page)
            ;(callbacksOf(page) as unknown as { onSwipeViewer: (d: 'left' | 'right' | 'down') => void }).onSwipeViewer('down')

            expect(callbacksOf(page).viewerStory).to.be.null
            expect(markViewed.calledOnceWith(41)).to.be.true

            page.destroy()
        } finally {
            markViewed.restore()
            fetchStories.restore()
            fetchChats.restore()
        }
    })
})

describe('chat scss mobile pins', () => {
    it('the mobile branch clamps the grid track so a long stories row cannot push the layout', async () => {
        const { readFileSync } = await import('node:fs')
        const scss = readFileSync('src/scss/components/chat.scss', 'utf-8')
        const mobileStart = scss.indexOf('@media (max-width: ($tablet - 1px))')
        const mobileBlock = scss.slice(mobileStart)

        expect(mobileStart).to.be.greaterThan(-1)
        expect(mobileBlock).to.contain('grid-template-columns: minmax(0, 1fr)')
        expect(mobileBlock).to.contain('min-width: 0')
        expect(mobileBlock).to.contain('max-width: 100%')
    })

    it('the change-profile pencil underlay paints only on hover', async () => {
        const { readFileSync } = await import('node:fs')
        const scss = readFileSync('src/scss/components/chat.scss', 'utf-8')
        const modifierStart = scss.indexOf('&_type_change-profile')
        const modifierBlock = scss.slice(modifierStart, scss.indexOf('&-chat-ava', modifierStart))
        const hoverStart = modifierBlock.indexOf('&:hover')

        expect(modifierStart).to.be.greaterThan(-1)
        expect(hoverStart).to.be.greaterThan(-1)

        // подложка (radial-gradient + карандаш) живёт ВНУТРИ hover-скуп,
        // в базовом состоянии блока её нет
        expect(modifierBlock.slice(hoverStart)).to.contain('background-image')
        expect(modifierBlock.slice(0, hoverStart)).to.not.contain('background-image')
    })
})

describe('chat page composer state across rerenders', () => {
    // NEXT п.3 (2026-11-09): mapStateToProps страницы строит новый список
    // чатов на каждый стор-эмит — страница перерисовывается и chat.hbs
    // ПЕРЕСОЗДАЁТ Messenger-инстанс (registerComponent без cacheKey);
    // черновик и фокус обязаны жить в общем модуле композера (узор
    // feed-scroll), а не в полях инстанса. Каскад пинится именно через
    // реальную страницу — юнит-пин Messenger напрямую каскад не видит.
    const setup = async (): Promise<{ page: InstanceType<typeof ChatPage>, input: () => HTMLInputElement | null | undefined }> => {
        store.set('chats', [{ id: 5, title: 'Чат', avatar: '', unread_count: 0 } as never])
        store.set('messages', { 5: [] })
        store.set('selectedChat', 5)

        const page = new ChatPage({} as never)

        document.body.appendChild(page.element as Node)
        const input = () => page.element?.querySelector<HTMLInputElement>('input[name="message"]')

        return { page, input }
    }

    const teardown = (page: InstanceType<typeof ChatPage>) => {
        page.element?.remove()
        page.destroy()
        store.set('selectedChat', undefined)
        store.set('messages', undefined)
        store.set('chats', undefined)
    }

    it('keeps the composer draft and focus when an incoming message rerenders the page', async () => {
        const { page, input } = await setup()

        try {
            input()?.focus()
            if (input() != null) {
                input()!.value = 'набираю ответ'
                input()!.setSelectionRange(3, 3)
            }
            expect(document.activeElement).to.equal(input())

            // входящее сообщение: страница перерисовалась, Messenger-инстанс
            // пересоздан — черновик, фокус и каретка обязаны вернуться
            store.set('messages', {
                5: [{ id: 101, chat_id: 5, user_id: 2, content: 'входящее' } as never],
            })

            await new Promise(resolve => setTimeout(resolve, 10))

            expect(input()?.value).to.eq('набираю ответ')
            expect(document.activeElement).to.equal(input())
            expect([input()?.selectionStart, input()?.selectionEnd]).to.deep.eq([3, 3])
        } finally {
            teardown(page)
        }
    })

    it('does not move the composer state into another chat', async () => {
        const { page, input } = await setup()

        try {
            if (input() != null) {
                input()!.value = 'черновик чата 5'
            }

            store.set('chats', [
                { id: 5, title: 'Чат', avatar: '', unread_count: 0 } as never,
                { id: 6, title: 'Другой', avatar: '', unread_count: 0 } as never,
            ])
            store.set('messages', { 5: [], 6: [] })
            store.set('selectedChat', 6)

            await new Promise(resolve => setTimeout(resolve, 10))

            expect(input()?.value).to.eq('')
        } finally {
            teardown(page)
        }
    })
})
