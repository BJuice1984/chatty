// Own-адаптер stories: маппинг ленты (viewed, fileUrl-резолв абсолютных
// URL картинок и аватаров владельца, синтез alt), FormData загрузки и
// markViewed-запрос — через подмену XMLHttpRequest (узор chats/api).

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import { ownStoriesPort } from './own.ts'

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

const dom = new JSDOM('', { url: 'http://localhost/' })

describe('stories api adapter (fake XHR)', () => {
    let originalXHR: typeof XMLHttpRequest
    let originalDocument: Document

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

    it('maps the feed: absolute src via fileUrl, alt from owner, viewed passthrough', async () => {
        FakeXHR.responses.push({
            status: 200,
            response: [
                {
                    id: 5,
                    owner_id: 7,
                    owner_display_name: 'ada',
                    owner_avatar_url: '3/download',
                    image_url: '9/download',
                    created_at: '2026-10-22T00:00:00Z',
                    viewed: false,
                },
                {
                    id: 6,
                    owner_id: 8,
                    owner_display_name: 'bob',
                    owner_avatar_url: null,
                    image_url: '10/download',
                    created_at: '2026-10-22T00:00:01Z',
                    viewed: true,
                },
            ],
        })

        const stories = await ownStoriesPort.fetchStories()

        // файловые пути резолвятся в абсолютные URL files-базы
        expect(stories[0]?.src).to.contain('/api/v1/files/9/download')
        expect(stories[0]?.ownerAvatarUrl).to.contain('/api/v1/files/3/download')
        // alt в контракте бэкенда нет — синтез из имени владельца
        expect(stories[0]?.alt).to.eq('История ada')
        expect(stories[0]?.viewed).to.be.false

        // у владельца без аватара — pool-фолбэк по его id
        expect(stories[1]?.ownerAvatarUrl).to.eq('/images/avatars/1.svg')
        expect(stories[1]?.viewed).to.be.true

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('GET')
        expect(call.url).to.contain('/stories')
    })

    it('uploads a story photo as multipart uploaded with the csrf header', async () => {
        FakeXHR.responses.push({ status: 201, response: {} })

        const file = new File(['photo'], 'story.png', { type: 'image/png' })

        await ownStoriesPort.uploadStory(file)

        const call = FakeXHR.calls[0]
        const body = call.body as FormData

        expect(call.method).to.eq('POST')
        expect(call.url).to.contain('/stories')
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
        expect((body.get('uploaded') as File).name).to.eq('story.png')
    })

    it('marks a story viewed over POST /stories/{id}/view with the csrf header', async () => {
        FakeXHR.responses.push({ status: 204, response: null })

        await ownStoriesPort.markViewed(12)

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('POST')
        expect(call.url).to.contain('/stories/12/view')
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
    })
})
