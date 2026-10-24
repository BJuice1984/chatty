// Own-адаптер chats (chats-social): searchUsers/deleteChat/setReaction
// реализованы на контракте бэкенда — проверяем реальные запросы через
// подмену XMLHttpRequest (адрес/метод/тело/CSRF), а не только наличие
// методов. Остальные операции по-прежнему явно отвергаются.

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import { avatarPoolUrl } from '../../../utils/avatarPool.ts'
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
        const chat = toChatInfo(ownChat, 7)

        expect(chat.id).to.eq(3)
        expect(chat.title).to.eq('own chat')
        // аватара по умолчанию нет: без members в ответе собеседник
        // не вычисляется
        expect(chat.avatar).to.eq('')
        expect(chat.unread_count).to.eq(0)
    })

    it('should carry is_ai through toChatInfo both ways', () => {
        expect(toChatInfo(ownChat, 7).is_ai).to.be.false
        expect(toChatInfo({ ...ownChat, is_ai: true }, 7).is_ai).to.be.true
    })

    it('maps the chat avatar_url file path onto ChatInfo', () => {
        // свой аватар чата с бэкенда приходит файловым путём и главнее собеседника
        expect(toChatInfo({ ...ownChat, avatar_url: '9/download' }, 7).avatar).to.eq('9/download')
        // без аватара — пусто: собеседника подставит лестница members
        expect(toChatInfo({ ...ownChat, avatar_url: null }, 7).avatar).to.eq('')
    })

    // Лестница аватара списка: свой avatar_url чата → реальный avatar_url
    // единственного собеседника → pool-фолбэк → пусто; групповые чаты и
    // ответы без members/без meId остаются без аватара
    const member = (id: number, avatarUrl: string | null = null) => ({
        id,
        login: `u${id}@example.com`,
        display_name: `u${id}`,
        avatar_url: avatarUrl,
    })

    it('resolves the lone companion real avatar from the list members', () => {
        const chat = toChatInfo({ ...ownChat, members: [member(7), member(42, '15/download')] }, 7)

        expect(chat.avatar).to.eq('15/download')
    })

    it('falls back to the companion pool avatar when the member has none', () => {
        const chat = toChatInfo({ ...ownChat, members: [member(7), member(42)] }, 7)

        expect(chat.avatar).to.eq(avatarPoolUrl(42))
    })

    it('keeps group chats and chat-own avatars above the companion ladder', () => {
        // два не-я участника — не диалог, аватара нет
        const group = toChatInfo({ ...ownChat, members: [member(7), member(1), member(2)] }, 7)

        expect(group.avatar).to.eq('')
        // свой аватар чата главнее собеседника
        const withOwn = toChatInfo(
            { ...ownChat, avatar_url: '9/download', members: [member(7), member(42, '15/download')] },
            7
        )

        expect(withOwn.avatar).to.eq('9/download')
    })

    it('does not compute a companion without meId or without members', () => {
        expect(toChatInfo({ ...ownChat, members: [member(7), member(42, '15/download')] }).avatar).to.eq('')
        expect(toChatInfo(ownChat, 7).avatar).to.eq('')
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

    it('uploads a chat avatar over POST /files/avatars rebuilding the UI FormData', async () => {
        FakeXHR.responses.push({ status: 201, response: { avatar_url: '9/download' } })

        // UI-форма: файловое поле avatar + chatId кликнутой плитки
        const data = new FormData()
        const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })

        data.append('avatar', file)
        data.append('chatId', '3')

        const result = await ownChatsPort.changeChatAvatar(data)

        const call = FakeXHR.calls[0]
        const body = call.body as unknown as FormData

        expect(call.method).to.eq('POST')
        expect(call.url).to.contain('/files/avatars')
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
        expect(body.get('kind')).to.eq('chat')
        expect(body.get('chat_id')).to.eq('3')
        expect((body.get('uploaded') as File).name).to.eq('avatar.png')
        expect(result).to.deep.eq({ avatar: '9/download' })
    })

    it('rejects a chat avatar upload when the UI form carries no chatId or file', async () => {
        const error = await captureError(() => ownChatsPort.changeChatAvatar(new FormData()))

        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.match(/недоступна в own-режиме/)
    })

    it('maps member avatar_url with the pool fallback in getChatUsers', async () => {
        FakeXHR.responses.push({
            status: 200,
            response: [
                { id: 7, login: 'ada@example.com', display_name: 'ada', avatar_url: '5/download' },
                { id: 8, login: 'bob@example.com', display_name: 'bob', avatar_url: null },
            ],
        })

        const members = await ownChatsPort.getChatUsers(3)

        expect(members[0]?.avatar).to.eq('5/download')
        expect(members[1]?.avatar).to.eq('/images/avatars/1.svg')
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
