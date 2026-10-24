import { expect } from 'chai'
import { AI_ASSISTANT_INITIAL_STATE, aiAssistantSlice } from './store.ts'

describe('ai assistant store slice', () => {
    beforeEach(() => {
        aiAssistantSlice.reset()
    })

    it('returns the initial state after reset', () => {
        expect(aiAssistantSlice.getAssistant()).to.deep.eq(AI_ASSISTANT_INITIAL_STATE)
        expect(aiAssistantSlice.getChats()).to.deep.eq([])
    })

    it('merges patches without losing untouched fields', () => {
        aiAssistantSlice.setAssistant({ status: 'searching', chatId: 3 })

        expect(aiAssistantSlice.getAssistant().status).to.eq('searching')
        expect(aiAssistantSlice.getAssistant().chatId).to.eq(3)
        expect(aiAssistantSlice.getAssistant().documents).to.deep.eq([])

        aiAssistantSlice.setAssistant({ status: 'empty' })

        expect(aiAssistantSlice.getAssistant().chatId).to.eq(3)
        expect(aiAssistantSlice.getAssistant().status).to.eq('empty')
    })

    it('stores the chat list independently of the assistant state', () => {
        aiAssistantSlice.setChats([{ id: 1, title: 'AI', is_ai: true }])

        expect(aiAssistantSlice.getChats()).to.have.length(1)
        expect(aiAssistantSlice.getAssistant().status).to.eq('idle')
    })
})
