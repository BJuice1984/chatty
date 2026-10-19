// Регрессия LIVE-3: страница чатов запрашивает список чатов при каждом
// заходе — SPA-вход после логина не повторяет bootstrap из main.ts.
// Фетч живёт в componentDidMount: Router диспатчит CDM при монтировании,
// уход с маршрута уничтожает инстанс, возврат монтирует свежий.

import { expect } from 'chai'
import sinon from 'sinon'
import '../../../ai-assistant/hbs-test-loader.ts'
import ChatsController from '../../controller.ts'
import { ChatPage } from './chat.ts'

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
