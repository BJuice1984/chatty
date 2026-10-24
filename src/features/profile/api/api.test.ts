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

        for (const method of ['searchUsersByLogin', 'changeProfile', 'changeAvatar'] as const) {
            expect(profilePort, `own ${method}`).to.have.property(method)
        }
    })

    it('should reject own-mode profile search and edit explicitly', async () => {
        const errors = await Promise.all([
            captureError(() => ownProfilePort.searchUsersByLogin({ login: 'ada' })),
            captureError(() => ownProfilePort.changeProfile({} as never)),
        ])

        for (const error of errors) {
            expect(error).to.be.instanceOf(Error)
            expect((error as Error).message).to.match(/недоступна в own-режиме/)
        }
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
