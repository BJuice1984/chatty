import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import { AiBotRunError } from '../ports.ts'
import { ownAiAssistantPort, ensureSuccessfulRun, findAnswerText, toAiBotRun, toAiChatSummary, toAiDocumentChunk } from './own.ts'
import { aiAssistantPort } from './index.ts'

// URL обязателен: cookie на about:blank jsdom молча отбрасывается (CSRF)
const dom = new JSDOM('', { url: 'http://localhost/' })
global.document = dom.window.document

const ownChat = {
    id: 3,
    title: 'own ai chat',
    owner_id: 7,
    is_ai: true,
    created_at: '2026-10-06T00:00:00Z',
}

const ownChunk = {
    document_id: 12,
    file_id: 34,
    file_name: 'sample.docx',
    ordinal: 2,
    content: 'фрагмент документа',
    score: 0.75,
}

const ownRun = {
    id: 5,
    chat_id: 3,
    message_id: 10,
    status: 'succeeded',
    attempt: 1,
    error_kind: null,
    response_message_id: 11,
    attachment_file_id: 34,
} as const

describe('ai assistant api adapter', () => {
    it('should expose the own adapter as the port', () => {
        expect(aiAssistantPort).to.eq(ownAiAssistantPort)

        for (const method of ['fetchChats', 'createChat', 'searchDocuments', 'askBot'] as const) {
            expect(aiAssistantPort, `own ${method}`).to.have.property(method)
        }
    })

    it('maps own chat responses onto the port contract', () => {
        expect(toAiChatSummary(ownChat)).to.deep.eq({
            id: 3,
            title: 'own ai chat',
            is_ai: true,
        })
    })

    it('maps own document chunks onto the port contract', () => {
        expect(toAiDocumentChunk(ownChunk)).to.deep.eq({
            document_id: 12,
            file_id: 34,
            file_name: 'sample.docx',
            ordinal: 2,
            content: 'фрагмент документа',
            score: 0.75,
        })
    })

    it('maps own bot runs onto the port contract', () => {
        expect(toAiBotRun(ownRun)).to.deep.eq({
            id: 5,
            chat_id: 3,
            message_id: 10,
            status: 'succeeded',
            attempt: 1,
            error_kind: null,
            response_message_id: 11,
            attachment_file_id: 34,
        })
    })

    it('accepts only succeeded runs with a response message', () => {
        expect(ensureSuccessfulRun(toAiBotRun(ownRun)).id).to.eq(5)

        const failed = toAiBotRun({ ...ownRun, status: 'failed', error_kind: 'provider_timeout' })

        expect(() => ensureSuccessfulRun(failed)).to.throw(AiBotRunError)

        const noAnswer = toAiBotRun({ ...ownRun, response_message_id: null })

        expect(() => ensureSuccessfulRun(noAnswer)).to.throw(AiBotRunError)
    })

    it('finds the bot answer text by response_message_id', () => {
        const messages = [
            { id: 11, chat_id: 3, user_id: 2, content: 'ответ', file_id: 34, client_message_id: null, created_at: '2026-10-06T00:00:02Z' },
            { id: 10, chat_id: 3, user_id: 1, content: 'вопрос', file_id: null, client_message_id: null, created_at: '2026-10-06T00:00:01Z' },
        ]

        expect(findAnswerText(messages, 11)).to.eq('ответ')
        expect(findAnswerText(messages, 999)).to.eq('')
    })
})

// createChat (2026-10-27-ai-chat-creation): собственный POST /chats — фича
// не тянет chats-порт (guard: cross-feature), поэтому форму запроса пиннуем
// здесь той же подменой XMLHttpRequest, что и chats/api/api.test.ts
describe('ai assistant api createChat (fake XHR)', () => {
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

    // createChat опционален в контракте порта (см. ports.ts) — эти
    // тесты проверяют HTTP-поведение own-адаптера, который метод реализует
    function adapterCreateChat(data: { title: string, is_ai?: boolean, auto_titled?: boolean }): Promise<void> {
        if (ownAiAssistantPort.createChat === undefined) {
            throw new Error('own-адаптер не реализует createChat')
        }
        return ownAiAssistantPort.createChat(data)
    }
    it('posts {title, is_ai} to /chats with the csrf header when is_ai is set', async () => {
        FakeXHR.responses.push({ status: 201, response: { id: 9 } })

        await adapterCreateChat({ title: 'AI ассистент', is_ai: true })

        const call = FakeXHR.calls[0]

        expect(call.method).to.eq('POST')
        expect(call.url).to.contain('/chats')
        expect(call.body).to.eq(JSON.stringify({ title: 'AI ассистент', is_ai: true }))
        expect(call.headers['X-CSRF-Token']).to.eq('token-1')
    })

    it('omits is_ai from the payload for a title-only create', async () => {
        FakeXHR.responses.push({ status: 201, response: { id: 9 } })

        await adapterCreateChat({ title: 'обычный чат' })

        const call = FakeXHR.calls[0]

        expect(call.body).to.eq(JSON.stringify({ title: 'обычный чат' }))
    })

    // 2026-11-06-llm-chat-autotitle: чат ассистента рождается auto_titled —
    // флаг уезжает только выставленным (зеркало is_ai)
    it('carries auto_titled in the payload only when explicitly set', async () => {
        FakeXHR.responses.push({ status: 201, response: { id: 10 } })

        await adapterCreateChat({ title: 'AI ассистент', is_ai: true, auto_titled: true })

        expect(FakeXHR.calls[0].body).to.eq(
            JSON.stringify({ title: 'AI ассистент', is_ai: true, auto_titled: true })
        )

        FakeXHR.responses.push({ status: 201, response: { id: 11 } })

        await adapterCreateChat({ title: 'AI ассистент', is_ai: true })

        expect(FakeXHR.calls[1].body).to.eq(JSON.stringify({ title: 'AI ассистент', is_ai: true }))
    })
})
