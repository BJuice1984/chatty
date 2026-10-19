// Регрессия LIVE-3: страница чатов запрашивает список чатов при каждом
// заходе — SPA-вход после логина не повторяет bootstrap из main.ts.
// Фетч живёт в componentDidMount: Router диспатчит CDM при монтировании,
// уход с маршрута уничтожает инстанс, возврат монтирует свежий.
// chat-ui-polish: мобильное переключение chatPaneOpen — выбор чата (включая
// повторный) открывает панель, onBack возвращает список.

import { expect } from 'chai'
import sinon from 'sinon'
import '../../../ai-assistant/hbs-test-loader.ts'
import ChatsController from '../../controller.ts'
import { ChatPage } from './chat.ts'

interface ChatPageCallbacks {
    onSelectChat: (id: number) => void
    onBack: () => void
    chatPaneOpen: boolean
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
