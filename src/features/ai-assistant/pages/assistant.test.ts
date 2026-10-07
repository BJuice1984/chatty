import { expect } from 'chai'
import '../hbs-test-loader.ts'
import { AssistantPage } from './assistant.ts'
import { aiAssistantSlice } from '../store.ts'

async function flushAsync(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0))
}

function render() {
    return new AssistantPage({} as never)
}

describe('ai assistant page states', () => {
    beforeEach(() => {
        aiAssistantSlice.reset()
    })

    it('renders the explicit error state when chats are unavailable (practicum/own backend down)', async () => {
        const page = render()

        // componentDidMount вызывает Router при монтировании — в тесте
        // повторяем его вручную, чтобы запустился loadChats.
        page.dispatchComponentDidMount()
        await flushAsync()

        const error = page.element?.querySelector('[data-testid="ai-error"]')

        expect(error).to.exist
        expect(error?.textContent).to.contain('недоступна')
        expect(page.element?.querySelector('[data-testid="ai-no-chats"]')).to.exist
    })

    it('renders ai chats and controls once chats are loaded', () => {
        aiAssistantSlice.setChats([{ id: 3, title: 'AI chat', is_ai: true }])

        const page = render()

        const select = page.element?.querySelector<HTMLSelectElement>('#ai-chat-select')

        expect(select).to.exist
        expect(select?.querySelectorAll('option')).to.have.length(1)
        expect(page.element?.querySelector('[data-testid="ai-no-chats"]')).to.not.exist
    })

    it('shows the typing indicator while searching or typing', () => {
        aiAssistantSlice.setChats([{ id: 3, title: 'AI chat', is_ai: true }])
        const page = render()

        aiAssistantSlice.setAssistant({ status: 'searching' })
        expect(page.element?.querySelector('[data-testid="ai-typing"]')).to.exist

        aiAssistantSlice.setAssistant({ status: 'typing' })
        expect(page.element?.querySelector('[data-testid="ai-typing"]')).to.exist

        aiAssistantSlice.setAssistant({ status: 'success' })
        expect(page.element?.querySelector('[data-testid="ai-typing"]')).to.not.exist
    })

    it('renders the empty state', () => {
        aiAssistantSlice.setChats([{ id: 3, title: 'AI chat', is_ai: true }])
        const page = render()

        aiAssistantSlice.setAssistant({ status: 'empty' })

        expect(page.element?.querySelector('[data-testid="ai-empty"]')).to.exist
    })

    it('renders the bot answer as text with its attachment card', () => {
        aiAssistantSlice.setChats([{ id: 3, title: 'AI chat', is_ai: true }])
        const page = render()

        aiAssistantSlice.setAssistant({
            status: 'success',
            answer: '<script>alert(1)</script>Готовый ответ',
            attachedFileId: 7,
        })

        const answer = page.element?.querySelector('[data-testid="ai-answer"]')

        expect(answer?.querySelector('script')).to.not.exist
        expect(answer?.innerHTML).to.contain('&lt;script&gt;')
        expect(answer?.textContent).to.contain('Готовый ответ')
        expect(page.element?.querySelector('[data-testid="ai-document"]')).to.exist
        expect(page.element?.querySelector('.ai-assistant__document-link')?.getAttribute('href')).to.match(
            /\/files\/7\/download$/
        )
    })

    it('renders found document cards from the search results', () => {
        aiAssistantSlice.setChats([{ id: 3, title: 'AI chat', is_ai: true }])
        const page = render()

        aiAssistantSlice.setAssistant({
            status: 'success',
            documents: [
                { document_id: 1, file_id: 7, ordinal: 0, content: 'текст <b>фрагмента</b>', score: 0.9 },
                { document_id: 2, file_id: 8, ordinal: 1, content: 'второй', score: 0.8 },
            ],
        })

        const cards = page.element?.querySelectorAll('[data-testid="ai-document"]')

        expect(cards).to.have.length(2)
        expect(page.element?.innerHTML).to.contain('&lt;b&gt;')
        expect(page.element?.querySelectorAll('.ai-assistant__document-link')).to.have.length(2)
    })

    it('preserves the typed query through store-driven re-renders (RV2)', () => {
        aiAssistantSlice.setChats([{ id: 3, title: 'AI chat', is_ai: true }])
        const page = render()

        aiAssistantSlice.setAssistant({ status: 'searching', query: 'запрос про отпуск' })

        const input = page.element?.querySelector<HTMLInputElement>('input[name="query"]')

        expect(input?.getAttribute('value')).to.eq('запрос про отпуск')
    })

    it('clears stale document cards when a later ask fails (RV3)', () => {
        aiAssistantSlice.setChats([{ id: 3, title: 'AI chat', is_ai: true }])
        const page = render()

        aiAssistantSlice.setAssistant({
            status: 'success',
            documents: [{ document_id: 1, file_id: 7, ordinal: 0, content: 'текст', score: 0.9 }],
        })
        expect(page.element?.querySelectorAll('[data-testid="ai-document"]')).to.have.length(1)

        aiAssistantSlice.setAssistant({
            status: 'error',
            error: 'Бот не смог ответить: provider_timeout',
            documents: [],
            answer: '',
        })

        expect(page.element?.querySelectorAll('[data-testid="ai-document"]')).to.have.length(0)
        expect(page.element?.querySelector('[data-testid="ai-error"]')?.textContent).to.contain(
            'provider_timeout'
        )
    })
})
