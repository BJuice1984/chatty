// Own-адаптер chats (chats-social): searchUsers/deleteChat/setReaction
// реализованы на контракте бэкенда — проверяем реальные запросы через
// подмену XMLHttpRequest (адрес/метод/тело/CSRF), а не только наличие
// методов. Остальные операции по-прежнему явно отвергаются.

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import { ownChatsPort, toChatInfo } from './own.ts'
import { chatsPort } from './index.ts'

// URL обязателен: cookie на about:blank jsdom молча отбрасывает
const dom = new JSDOM('', { url: 'http://localhost/' })
global.document = dom.window.document

const ownChat = {
    id: 3,
    title: 'own chat',
    owner_id: 7,
    is_ai: false,
    created_at: '2026-10-06T00:00:00Z',
}

// Минимальный XHR: транспорт создаёт его в момент запроса, поэтому подмена
// глобального класса перехватывает и экземпляр, созданный при импорте модуля
interface CapturedCall {
    method: string
    url: string
    body: string | undefined
    headers: Record<string, string>
}

class FakeXHR {
    static calls: CapturedCall[] = []
    static responses: { status: number; response: unknown }[] = []

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

    send(body?: string): void {
        FakeXHR.calls.push({ method: this.method, url: this.url, body, headers: { ...this.headers } })

        const queued = FakeXHR.responses.shift() ?? { status: 200, response: null }

        this.status = queued.status
        this.response = queued.response
        this.onload?.()
    }
}

const unsupportedMethods = [
    'removeUsers',
    'changeChatAvatar',
] as const

async function captureError(action: () => unknown): Promise<unknown> {
    try {
        await action()
    } catch (e) {
        return e
    }

    return undefined
}

describe('chats api adapter', () => {
    it('should expose the own adapter as the port', () => {
        expect(chatsPort).to.eq(ownChatsPort)

        for (const method of [
            'fetchChats',
            'createChat',
            'deleteChat',
            'getToken',
            'addUsers',
            'removeUsers',
            'getChatUsers',
            'changeChatAvatar',
            'searchUsers',
            'setReaction',
        ] as const) {
            expect(chatsPort, `own ${method}`).to.have.property(method)
        }
    })

    it('should map own ChatResponse onto ChatInfo with defaults', () => {
        const chat = toChatInfo(ownChat)

        expect(chat.id).to.eq(3)
        expect(chat.title).to.eq('own chat')
        // аватар — детерминированный из локального пула (id 3 -> 4.svg)
        expect(chat.avatar).to.eq('/images/avatars/4.svg')
        expect(chat.unread_count).to.eq(0)
    })

    it('should carry is_ai through toChatInfo both ways', () => {
        expect(toChatInfo(ownChat).is_ai).to.be.false
        expect(toChatInfo({ ...ownChat, is_ai: true }).is_ai).to.be.true
    })

    it('should return an empty token sentinel for the cookie-auth WS flow', async () => {
        const token = await ownChatsPort.getToken(3)

        expect(token.token).to.eq('')
    })

    it('should reject unsupported own-mode operations explicitly', async () => {
        for (const method of unsupportedMethods) {
            const error = await captureError(
                () => (ownChatsPort[method] as unknown as () => unknown)()
            )

            expect(error, `own ${method}`).to.be.instanceOf(Error)
            expect((error as Error).message, `own ${method}`).to.match(/недоступна в own-режиме/)
        }
    })
})

describe('chats api social operations (fake XHR)', () => {
    let originalXHR: typeof XMLHttpRequest
    let originalDocument: Document

    beforeEach(() => {
        originalXHR = globalThis.XMLHttpRequest
        originalDocument = global.document
        // свой документ с URL: глобальный мог достаться от файлов с about:blank,
        // где cookie (а с ним CSRF) молча отбрасывается
        global.document = dom.window.document
        FakeXHR.calls = []
        FakeXHR.responses = []
        globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest
        dom.window.document.cookie = 'chatty_csrf=token-1'
    })

    afterEach(() => {
        globalThis.XMLHttpRequest = originalXHR
        global.document = originalDocument
        dom.window.document.cookie = 'chatty_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    })

    it('searches users by the login prefix over GET /users', async () => {
        FakeXHR.responses.push({
            status: 200,
            response: [{ id: 9, login: 'bob@example.com', display_name: 'bob' }],
        })

        const results = await ownChatsPort.searchUsers({ login: 'bob' })

        expect(results).to.deep.eq([{ id: 9, login: 'bob@example.com', display_name: 'bob' }])

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('GET')
        expect(call.url).to.contain('/users')
        expect(call.url).to.contain('login=bob')
    })

    it('deletes a chat over DELETE /chats/{id} with the csrf header', async () => {
        FakeXHR.responses.push({ status: 204, response: null })

        await ownChatsPort.deleteChat({ chatId: 7 })

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('DELETE')
        expect(call.url).to.contain('/chats/7')
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
    })

    it('toggles a reaction over POST reactions with the emoji body', async () => {
        FakeXHR.responses.push({
            status: 200,
            response: {
                message_id: 11,
                active: true,
                reactions: [{ emoji: '👍', count: 1, mine: true }],
            },
        })

        const result = await ownChatsPort.setReaction({ chatId: 3, messageId: 11, emoji: '👍' })

        expect(result).to.deep.eq({
            message_id: 11,
            active: true,
            reactions: [{ emoji: '👍', count: 1, mine: true }],
        })

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('POST')
        expect(call.url).to.contain('/chats/3/messages/11/reactions')
        expect(call.body).to.eq(JSON.stringify({ emoji: '👍' }))
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
    })
})
