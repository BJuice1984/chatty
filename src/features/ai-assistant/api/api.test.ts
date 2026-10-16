import { expect } from 'chai'
import { AiBotRunError } from '../ports.ts'
import { ownAiAssistantPort, ensureSuccessfulRun, findAnswerText, toAiBotRun, toAiChatSummary, toAiDocumentChunk } from './own.ts'
import { aiAssistantPort } from './index.ts'

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

        for (const method of ['fetchChats', 'searchDocuments', 'askBot'] as const) {
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
