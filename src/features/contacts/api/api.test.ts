// Own-адаптер contacts (2026-11-01-contacts): адресная книга живёт на
// контракте бэкенда — проверяем реальные запросы через подмену
// XMLHttpRequest (адрес/метод/тело/CSRF) и маппинг DTO, включая единственную
// точку фолбэка аватара avatar_url ?? avatarPoolUrl(id).

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import { avatarPoolUrl } from '../../../utils/avatarPool.ts'
import { ownContactsPort, toContactInfo } from './own.ts'
import { contactsPort } from './index.ts'

// URL обязателен: cookie на about:blank jsdom молча отбрасывается
const dom = new JSDOM('', { url: 'http://localhost/' })
global.document = dom.window.document

const ownContact = {
    id: 9,
    login: 'bob@example.com',
    display_name: 'bob',
    avatar_url: null as string | null,
    created_at: '2026-11-01T00:00:00Z',
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

describe('contacts api adapter', () => {
    it('should expose the own adapter as the port', () => {
        expect(contactsPort).to.eq(ownContactsPort)

        for (const method of [
            'fetchContacts',
            'addContact',
            'removeContact',
            'searchUsers',
            'createDm',
        ] as const) {
            expect(contactsPort, `own ${method}`).to.have.property(method)
        }
    })

    it('maps the contact DTO onto ContactInfo', () => {
        const contact = toContactInfo({ ...ownContact, avatar_url: '15/download' })

        expect(contact.id).to.eq(9)
        expect(contact.login).to.eq('bob@example.com')
        expect(contact.display_name).to.eq('bob')
        expect(contact.avatar).to.eq('15/download')
    })

    it('falls back to the pool avatar when avatar_url is null at the single mapping point', () => {
        // null (пользователь без аватара) и отсутствующее поле — один и тот
        // же детерминированный pool-фолбэк по id контакта
        expect(toContactInfo({ ...ownContact, avatar_url: null }).avatar).to.eq(avatarPoolUrl(9))
        expect(toContactInfo({ id: 12, login: 'ada@example.com', display_name: 'ada', created_at: '2026-11-01T00:00:00Z' }).avatar)
            .to.eq(avatarPoolUrl(12))
    })
})

describe('contacts api operations (fake XHR)', () => {
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

    it('fetches the list over GET /contacts and maps every row', async () => {
        FakeXHR.responses.push({
            status: 200,
            response: [
                { ...ownContact, avatar_url: '15/download' },
                { id: 12, login: 'ada@example.com', display_name: 'ada', avatar_url: null, created_at: '2026-11-01T00:00:00Z' },
            ],
        })

        const contacts = await ownContactsPort.fetchContacts()

        expect(contacts).to.deep.eq([
            { id: 9, login: 'bob@example.com', display_name: 'bob', avatar: '15/download' },
            { id: 12, login: 'ada@example.com', display_name: 'ada', avatar: avatarPoolUrl(12) },
        ])

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('GET')
        expect(call.url).to.contain('/contacts')
        expect(call.url).to.not.contain('?')
    })

    it('adds a contact over POST /contacts with the user_id body and csrf', async () => {
        FakeXHR.responses.push({ status: 201, response: { ...ownContact } })

        await ownContactsPort.addContact(9)

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('POST')
        expect(call.url).to.contain('/contacts')
        expect(call.body).to.eq(JSON.stringify({ user_id: 9 }))
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
    })

    it('removes a contact over DELETE /contacts/{id} with the csrf header', async () => {
        FakeXHR.responses.push({ status: 204, response: null })

        await ownContactsPort.removeContact(9)

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('DELETE')
        expect(call.url).to.contain('/contacts/9')
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
    })

    it('searches users by the login prefix over GET /users', async () => {
        FakeXHR.responses.push({
            status: 200,
            response: [{ id: 9, login: 'bob@example.com', display_name: 'bob' }],
        })

        const results = await ownContactsPort.searchUsers('bob')

        expect(results).to.deep.eq([{ id: 9, login: 'bob@example.com', display_name: 'bob' }])

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('GET')
        expect(call.url).to.contain('/users')
        expect(call.url).to.contain('login=bob')
        expect(call.headers['X-CSRF-Token']).to.eq(undefined)
    })

    it('creates or opens the DM over POST /chats/dm returning only {chatId}', async () => {
        FakeXHR.responses.push({
            status: 201,
            response: {
                id: 3,
                title: 'bob',
                owner_id: 7,
                is_ai: false,
                is_dm: true,
                created_at: '2026-11-01T00:00:00Z',
            },
        })

        const result = await ownContactsPort.createDm(9)

        expect(result).to.deep.eq({ chatId: 3 })

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('POST')
        expect(call.url).to.contain('/chats/dm')
        expect(call.body).to.eq(JSON.stringify({ user_id: 9 }))
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
    })
})
