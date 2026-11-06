import { expect } from 'chai'
import sinon from 'sinon'
import '../hbs-test-loader.ts'
import { AssistantPage } from './assistant.ts'
import { aiAssistantPort } from '../api/index.ts'
import AiAssistantController from '../controller.ts'
import { aiAssistantSlice } from '../store.ts'
import { AI_CHAT_TITLE } from '../../../utils/constants.ts'

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

    it('loads chats on componentDidMount, not on construction', () => {
        const loadChats = sinon.stub(AiAssistantController, 'loadChats').resolves()

        try {
            const page = render()

            // Конструктор не ходит за чатами: loadChats стартует только CDM,
            // который диспатчит Router при монтировании (в тесте — вручную).
            expect(loadChats.called).to.be.false

            page.dispatchComponentDidMount()
            expect(loadChats.calledOnce).to.be.true

            page.destroy()
        } finally {
            loadChats.restore()
        }
    })

    it('renders the explicit error state when chats are unavailable (own backend down)', async () => {
        // Порт единственный (own) и ходит в сеть — детерминированно подменяем
        // fetchChats отказом бэкенда: error-путь контроллера пишет в слайс
        const fetchChats = sinon.stub(aiAssistantPort, 'fetchChats').rejects(
            new Error('Список AI-чатов недоступен: бэкенд не отвечает')
        )

        try {
            const page = render()

            // componentDidMount вызывает Router при монтировании — в тесте
            // повторяем его вручную, чтобы запустился loadChats.
            page.dispatchComponentDidMount()
            await flushAsync()

            const error = page.element?.querySelector('[data-testid="ai-error"]')

            expect(error).to.exist
            expect(error?.textContent).to.contain('недоступен')
            expect(page.element?.querySelector('[data-testid="ai-no-chats"]')).to.exist
        } finally {
            fetchChats.restore()
        }
    })

    it('renders ai chats and controls once chats are loaded', () => {
        aiAssistantSlice.setChats([{ id: 3, title: 'AI chat', is_ai: true }])

        const page = render()

        const select = page.element?.querySelector<HTMLSelectElement>('#ai-chat-select')

        expect(select).to.exist
        expect(select?.querySelectorAll('option')).to.have.length(1)
        expect(page.element?.querySelector('[data-testid="ai-no-chats"]')).to.not.exist
    })

    // 2026-10-27-ai-chat-creation (C): пустое состояние получает кнопку
    // создания ИИ-чата; непустая страница отрисовывается как раньше
    it('renders the create-chat button in the empty state and wires it to createAiChat', () => {
        const createAiChat = sinon.stub(AiAssistantController, 'createAiChat').resolves()

        try {
            const page = render()

            const button = page.element?.querySelector<HTMLButtonElement>('[data-testid="ai-create-chat"]')

            expect(button).to.exist
            expect(button?.textContent?.trim()).to.eq('Создать чат с ассистентом')

            // сырой button, обработанный делегированным click страницы
            button?.click()

            expect(createAiChat.calledOnce).to.be.true
            // 2026-11-06-llm-chat-autotitle: чат ассистента рождается
            // auto_titled — LLM назовёт его по контексту диалога
            expect(createAiChat.firstCall.args[0]).to.deep.eq({
                title: AI_CHAT_TITLE,
                is_ai: true,
                auto_titled: true,
            })
            expect(AI_CHAT_TITLE).to.eq('AI ассистент')

            page.destroy()
        } finally {
            createAiChat.restore()
        }
    })

    it('keeps the non-empty page unchanged: no create button with existing AI chats', () => {
        aiAssistantSlice.setChats([{ id: 3, title: 'AI chat', is_ai: true }])

        const page = render()

        expect(page.element?.querySelector('#ai-chat-select')).to.exist
        expect(page.element?.querySelector('[data-testid="ai-create-chat"]')).to.not.exist

        page.destroy()
    })

    it('refreshes the list through loadChats after createAiChat', async () => {
        const createChat = sinon.stub(aiAssistantPort, 'createChat').resolves()
        const loadChats = sinon.stub(AiAssistantController, 'loadChats').resolves([])

        try {
            await AiAssistantController.createAiChat({ title: AI_CHAT_TITLE, is_ai: true })

            expect(createChat.calledOnceWith({ title: AI_CHAT_TITLE, is_ai: true })).to.be.true
            expect(loadChats.calledOnce).to.be.true
        } finally {
            loadChats.restore()
            createChat.restore()
        }
    })

    it('reports a create failure as the error state without refreshing', async () => {
        const createChat = sinon.stub(aiAssistantPort, 'createChat').rejects(new Error('Создание не удалось'))
        const loadChats = sinon.stub(AiAssistantController, 'loadChats').resolves([])

        try {
            await AiAssistantController.createAiChat({ title: AI_CHAT_TITLE, is_ai: true })

            expect(aiAssistantSlice.getAssistant().status).to.eq('error')
            expect(aiAssistantSlice.getAssistant().error).to.contain('Создание не удалось')
            expect(loadChats.called).to.be.false
        } finally {
            loadChats.restore()
            createChat.restore()
        }
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
                { document_id: 1, file_id: 7, file_name: 'otpusk.docx', ordinal: 0, content: 'текст <b>фрагмента</b>', score: 0.9 },
                { document_id: 2, file_id: 8, file_name: 'prikaz.pdf', ordinal: 1, content: 'второй', score: 0.8 },
            ],
        })

        const cards = page.element?.querySelectorAll('[data-testid="ai-document"]')

        expect(cards).to.have.length(2)
        expect(page.element?.innerHTML).to.contain('&lt;b&gt;')
        expect(page.element?.innerHTML).to.contain('otpusk.docx')
        expect(page.element?.querySelectorAll('.ai-assistant__document-link')).to.have.length(2)
    })

    // Один файл в топ-к попадает несколькими чанками — карточка одна на
    // файл, с именем файла в заголовке и сниппетом лучшего чанка
    it('deduplicates cards by file and titles them with the file name', () => {
        aiAssistantSlice.setChats([{ id: 3, title: 'AI chat', is_ai: true }])
        const page = render()

        aiAssistantSlice.setAssistant({
            status: 'success',
            documents: [
                { document_id: 1, file_id: 7, file_name: 'otpusk.docx', ordinal: 0, content: 'лучший чанк', score: 0.9 },
                { document_id: 1, file_id: 7, file_name: 'otpusk.docx', ordinal: 1, content: 'второй чанк того же файла', score: 0.7 },
                { document_id: 2, file_id: 8, file_name: '', ordinal: 0, content: 'без имени', score: 0.6 },
            ],
        })

        const cards = page.element?.querySelectorAll('[data-testid="ai-document"]')

        expect(cards).to.have.length(2)
        expect(page.element?.innerHTML).to.contain('otpusk.docx')
        expect(page.element?.innerHTML).to.contain('лучший чанк')
        expect(page.element?.innerHTML).to.not.contain('второй чанк того же файла')
        expect(page.element?.innerHTML).to.contain('Документ #2')
    })

    it('preserves the typed query through store-driven re-renders (RV2)', () => {
        aiAssistantSlice.setChats([{ id: 3, title: 'AI chat', is_ai: true }])
        const page = render()

        aiAssistantSlice.setAssistant({ status: 'searching', query: 'запрос про отпуск' })

        const input = page.element?.querySelector<HTMLInputElement>('input[name="query"]')

        expect(input?.getAttribute('value')).to.eq('запрос про отпуск')
    })

    it('preserves the typed question through store-driven re-renders (NEW-3)', () => {
        aiAssistantSlice.setChats([{ id: 3, title: 'AI chat', is_ai: true }])
        const page = render()

        aiAssistantSlice.setAssistant({ status: 'typing', question: 'вопрос про заявление' })

        const input = page.element?.querySelector<HTMLInputElement>('input[name="question"]')

        expect(input?.getAttribute('value')).to.eq('вопрос про заявление')
    })

    it('clears stale document cards when a later ask fails (RV3)', () => {
        aiAssistantSlice.setChats([{ id: 3, title: 'AI chat', is_ai: true }])
        const page = render()

        aiAssistantSlice.setAssistant({
            status: 'success',
            documents: [{ document_id: 1, file_id: 7, file_name: 'sample.docx', ordinal: 0, content: 'текст', score: 0.9 }],
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
