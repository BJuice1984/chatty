import { expect } from 'chai'
import { AiAssistantController } from './controller.ts'
import { AiBotRunError, type AiAssistantPort, type AiBotRun } from './ports.ts'
import { aiAssistantSlice } from './store.ts'

function successfulRun(overrides: Partial<AiBotRun> = {}): AiBotRun {
    return {
        id: 1,
        chat_id: 3,
        message_id: 10,
        status: 'succeeded',
        attempt: 1,
        error_kind: null,
        response_message_id: 11,
        attachment_file_id: 77,
        ...overrides,
    }
}

function port(overrides: Partial<AiAssistantPort> = {}): AiAssistantPort {
    return {
        fetchChats: async () => [
            { id: 3, title: 'AI chat', is_ai: true },
            { id: 4, title: 'Plain chat', is_ai: false },
        ],
        searchDocuments: async () => [
            { document_id: 1, file_id: 7, ordinal: 0, content: 'chunk text', score: 0.9 },
        ],
        askBot: async () => ({ run: successfulRun(), answerText: 'ответ ассистента' }),
        ...overrides,
    }
}

describe('ai assistant controller state machine', () => {
    let controller: AiAssistantController

    beforeEach(() => {
        aiAssistantSlice.reset()
        controller = new AiAssistantController(port())
    })

    it('loads only is_ai chats', async () => {
        const chats = await controller.loadChats()

        expect(chats.map(chat => chat.id)).to.deep.eq([3])
        expect(aiAssistantSlice.getChats()).to.have.length(1)
    })

    it('renders an explicit error state when chats are unavailable', async () => {
        controller = new AiAssistantController(port({ fetchChats: async () => {
            throw new Error('Операция fetchChats недоступна в practicum-режиме')
        } }))

        const chats = await controller.loadChats()

        expect(chats).to.deep.eq([])
        expect(aiAssistantSlice.getAssistant().status).to.eq('error')
        expect(aiAssistantSlice.getAssistant().error).to.contain('practicum')
    })

    it('search goes searching -> success with documents', async () => {
        await controller.search(3, 'запрос')

        expect(aiAssistantSlice.getAssistant().status).to.eq('success')
        expect(aiAssistantSlice.getAssistant().documents).to.have.length(1)
        expect(aiAssistantSlice.getAssistant().query).to.eq('запрос')
    })

    it('search without results lands in the empty state', async () => {
        controller = new AiAssistantController(port({ searchDocuments: async () => [] }))

        await controller.search(3, 'запрос')

        expect(aiAssistantSlice.getAssistant().status).to.eq('empty')
    })

    it('search failures land in the error state', async () => {
        controller = new AiAssistantController(port({ searchDocuments: async () => {
            throw new Error('сеть недоступна')
        } }))

        await controller.search(3, 'запрос')

        expect(aiAssistantSlice.getAssistant().status).to.eq('error')
        expect(aiAssistantSlice.getAssistant().error).to.contain('сеть недоступна')
    })

    it('blank queries are ignored', async () => {
        await controller.search(3, '   ')

        expect(aiAssistantSlice.getAssistant().status).to.eq('idle')
    })

    it('ask goes typing -> success with answer and attachment', async () => {
        await controller.ask(3, 'вопрос')

        expect(aiAssistantSlice.getAssistant().status).to.eq('success')
        expect(aiAssistantSlice.getAssistant().answer).to.eq('ответ ассистента')
        expect(aiAssistantSlice.getAssistant().attachedFileId).to.eq(77)
    })

    it('failed bot runs surface their error kind as text', async () => {
        controller = new AiAssistantController(port({ askBot: async () => {
            throw new AiBotRunError('provider_timeout')
        } }))

        await controller.ask(3, 'вопрос')

        expect(aiAssistantSlice.getAssistant().status).to.eq('error')
        expect(aiAssistantSlice.getAssistant().error).to.contain('provider_timeout')
        expect(aiAssistantSlice.getAssistant().answer).to.eq('')
    })

    it('reset returns the slice to idle', async () => {
        await controller.search(3, 'запрос')
        controller.reset()

        expect(aiAssistantSlice.getAssistant().status).to.eq('idle')
        expect(aiAssistantSlice.getChats()).to.deep.eq([])
    })

    it('keeps the typed query so re-renders preserve the input (RV2)', async () => {
        await controller.search(3, 'запрос про отпуск')

        expect(aiAssistantSlice.getAssistant().query).to.eq('запрос про отпуск')
        expect(aiAssistantSlice.getAssistant().status).to.eq('success')
    })

    it('error paths clear stale documents and answers (RV3)', async () => {
        await controller.search(3, 'запрос')
        expect(aiAssistantSlice.getAssistant().documents).to.have.length(1)

        controller = new AiAssistantController(port({ askBot: async () => {
            throw new AiBotRunError('provider_timeout')
        } }))
        await controller.ask(3, 'вопрос')

        expect(aiAssistantSlice.getAssistant().status).to.eq('error')
        expect(aiAssistantSlice.getAssistant().documents).to.deep.eq([])
        expect(aiAssistantSlice.getAssistant().answer).to.eq('')

        controller = new AiAssistantController(port({ searchDocuments: async () => {
            throw new Error('сеть недоступна')
        } }))
        await controller.search(3, 'ещё запрос')

        expect(aiAssistantSlice.getAssistant().status).to.eq('error')
        expect(aiAssistantSlice.getAssistant().documents).to.deep.eq([])
    })

    it('switching the chat clears the previous chat content (RV4)', async () => {
        await controller.search(3, 'запрос')
        expect(aiAssistantSlice.getAssistant().documents).to.have.length(1)

        controller.selectChat(4)

        expect(aiAssistantSlice.getAssistant().chatId).to.eq(4)
        expect(aiAssistantSlice.getAssistant().documents).to.deep.eq([])
        expect(aiAssistantSlice.getAssistant().answer).to.eq('')
    })
})
