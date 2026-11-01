import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import { ownProfilePort } from './own.ts'
import { profilePort } from './index.ts'

const dom = new JSDOM()
global.document = dom.window.document

async function captureError(action: () => unknown): Promise<unknown> {
    try {
        await action()
    } catch (e) {
        return e
    }

    return undefined
}

describe('profile api adapter', () => {
    it('should expose the own adapter as the port', () => {
        expect(profilePort).to.eq(ownProfilePort)

        for (const method of [
            'searchUsersByLogin',
            'changeProfile',
            'changeAvatar',
            'changePassword',
            'logoutAll',
            'fetchUsage',
        ] as const) {
            expect(profilePort, `own ${method}`).to.have.property(method)
        }
    })

    it('should reject own-mode profile search explicitly', async () => {
        const error = await captureError(() => ownProfilePort.searchUsersByLogin({ login: 'ada' }))

        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.match(/недоступна в own-режиме/)
    })

})

// 2026-11-01-settings: настройки профиля на контракте собственного бэкенда —
// PUT /auth/profile (частичное тело: только определённые поля контракта),
// PUT /auth/password, POST /auth/logout-all (все с CSRF), GET /files/usage
describe('profile settings operations (fake XHR)', () => {
    let originalXHR: typeof XMLHttpRequest
    let originalDocument: Document

    // URL обязателен: cookie на about:blank jsdom молча отбрасывается
    const dom = new JSDOM('', { url: 'http://localhost/' })

    beforeEach(() => {
        originalXHR = globalThis.XMLHttpRequest
        originalDocument = global.document
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

    const profileResponse = {
        id: 7,
        email: 'ada@example.com',
        role: 'user',
        is_active: true,
        created_at: '2026-10-06T00:00:00Z',
        avatar_url: null,
        display_name: 'Ada Lovelace',
        phone: '+7 000',
        send_read_receipts: false,
    }

    it('updates the profile over PUT /auth/profile with csrf, sending only defined fields', async () => {
        FakeXHR.responses.push({ status: 200, response: profileResponse })

        const result = await ownProfilePort.changeProfile({
            display_name: 'Ada Lovelace',
            phone: '+7 000',
            send_read_receipts: false,
            first_name: 'Ada',
            login: 'ada@example.com',
        })

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('PUT')
        expect(call.url).to.contain('/auth/profile')
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
        // legacy-поля формы в запрос не попадают: их бэкенд не поддерживает
        expect(JSON.parse(call.body as string)).to.deep.eq({
            display_name: 'Ada Lovelace',
            phone: '+7 000',
            send_read_receipts: false,
        })
        // ответ маппится на ProfileUser с РЕАЛЬНЫМИ профильными полями
        expect(result).to.deep.eq({
            id: 7,
            login: 'ada@example.com',
            email: 'ada@example.com',
            first_name: '',
            second_name: '',
            display_name: 'Ada Lovelace',
            phone: '+7 000',
            send_read_receipts: false,
            avatar: '/images/avatars/8.svg',
        })
    })

    it('carries a single-field body for the privacy toggle', async () => {
        FakeXHR.responses.push({ status: 200, response: profileResponse })

        await ownProfilePort.changeProfile({ send_read_receipts: true })

        expect(JSON.parse(FakeXHR.calls[0].body as string)).to.deep.eq({ send_read_receipts: true })
    })

    it('falls back display_name null to the email local part in the response mapping', async () => {
        FakeXHR.responses.push({ status: 200, response: { ...profileResponse, display_name: null, phone: null } })

        const result = await ownProfilePort.changeProfile({ display_name: '' })

        expect(result.display_name).to.eq('ada')
        expect(result.phone).to.eq('')
        expect(result.send_read_receipts).to.be.false
    })

    it('changes the password over PUT /auth/password with csrf', async () => {
        FakeXHR.responses.push({ status: 200, response: profileResponse })

        await ownProfilePort.changePassword({ old_password: 'OldPassword12', new_password: 'NewPassword12' })

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('PUT')
        expect(call.url).to.contain('/auth/password')
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
        expect(JSON.parse(call.body as string)).to.deep.eq({
            old_password: 'OldPassword12',
            new_password: 'NewPassword12',
        })
    })

    it('logs out everywhere over POST /auth/logout-all with csrf', async () => {
        FakeXHR.responses.push({ status: 200, response: { message: 'ok' } })

        await ownProfilePort.logoutAll()

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('POST')
        expect(call.url).to.contain('/auth/logout-all')
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
    })

    it('fetches the storage usage over GET /files/usage without csrf', async () => {
        FakeXHR.responses.push({ status: 200, response: { total_bytes: 1024, file_count: 3 } })

        const usage = await ownProfilePort.fetchUsage()

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('GET')
        expect(call.url).to.contain('/files/usage')
        expect(call.headers['X-CSRF-Token']).to.be.undefined
        expect(usage).to.deep.eq({ total_bytes: 1024, file_count: 3 })
    })
})

// Минимальный XHR + cookie-документ (узор chats/api/api.test.ts): подмена
// глобального класса перехватывает запрос own-адаптера
interface CapturedCall {
    method: string
    url: string
    body: unknown
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

    send(body?: unknown): void {
        FakeXHR.calls.push({ method: this.method, url: this.url, body, headers: { ...this.headers } })

        const queued = FakeXHR.responses.shift() ?? { status: 200, response: null }

        this.status = queued.status
        this.response = queued.response
        this.onload?.()
    }
}

describe('profile avatar upload (fake XHR)', () => {
    let originalXHR: typeof XMLHttpRequest
    let originalDocument: Document

    // URL обязателен: cookie на about:blank jsdom молча отбрасывается
    const dom = new JSDOM('', { url: 'http://localhost/' })

    beforeEach(() => {
        originalXHR = globalThis.XMLHttpRequest
        originalDocument = global.document
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

    it('uploads a user avatar over POST /files/avatars (kind=user) and returns the file path', async () => {
        FakeXHR.responses.push({ status: 201, response: { avatar_url: '4/download' } })

        const data = new FormData()
        const file = new File(['avatar'], 'me.png', { type: 'image/png' })

        data.append('avatar', file)

        const result = await ownProfilePort.changeAvatar(data)

        const call = FakeXHR.calls[0]
        const body = call.body as FormData

        expect(call.method).to.eq('POST')
        expect(call.url).to.contain('/files/avatars')
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
        expect(body.get('kind')).to.eq('user')
        expect((body.get('uploaded') as File).name).to.eq('me.png')
        expect(result).to.deep.eq({ avatar: '4/download' })
    })

    it('rejects a user avatar upload when the form carries no file', async () => {
        const error = await captureError(() => ownProfilePort.changeAvatar(new FormData()))

        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.match(/недоступна в own-режиме/)
    })
})
