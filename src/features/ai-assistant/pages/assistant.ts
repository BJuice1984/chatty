// Feature-страница AI-ассистента (stage 10): состояние приходит из слайса
// через withStore; компоненты фичи регистрируются здесь же (первый модуль
// «нового образца» — собственные компоненты фичи, а не общие).

import Block from '../../../core/Block.ts'
import { registerComponent } from '../../../core/registerComponent.ts'
import store, { AppState, ComponentProps, withStore } from '../../../utils/Store.ts'
import { TypingIndicator } from '../components/typing-indicator.ts'
import { DocumentCard } from '../components/document-card.ts'
import AiAssistantController from '../controller.ts'
import { type AiAssistantState, aiAssistantSlice } from '../store.ts'
import type { AiChatSummary } from '../ports.ts'
import template from './assistant.hbs'

// Стили фичи (../styles/ai-assistant.scss) подключаются импортом в
// композиционном корне main.ts: mocha/tsx не умеет грузить .scss, а страница
// входит в граф тестов. Файл стилей остаётся собственностью фичи.

registerComponent('AiTypingIndicator', TypingIndicator as typeof Block)
registerComponent('AiDocumentCard', DocumentCard as typeof Block)

interface AssistantPageProps {
    aiChats: AiChatSummary[]
    hasChats: boolean
    isSearching: boolean
    isTyping: boolean
    isEmpty: boolean
    isError: boolean
    hasAnswer: boolean
    answer: string
    attachedFileId: number | null
    hasAttachment: boolean
    documentCards: { file_id: number; title: string; snippet: string }[]
    error: string
    [key: string]: unknown
}

type AiAssistantStoreState = AppState & { aiAssistant?: AiAssistantState; aiChats?: AiChatSummary[] }

function currentChats(state: AppState): AiChatSummary[] {
    return (state as AiAssistantStoreState).aiChats ?? []
}

function currentAssistant(state: AppState): AiAssistantState {
    return (state as AiAssistantStoreState).aiAssistant ?? aiAssistantSlice.getAssistant()
}

class AssistantPageBase extends Block {
    constructor(props: AssistantPageProps) {
        // Выбор чата до super(): локальная функция без this (slice/store).
        const currentChatId = (): number => {
            const state = aiAssistantSlice.getAssistant()

            if (state.chatId !== null) {
                return state.chatId
            }

            const chats = currentChats(store.getState())

            return chats.length > 0 ? chats[0].id : 0
        }

        // Блок типизирует events как безаргументные () => void, а DOM
        // передаёт событие — один каст на карту обработчиков.
        const events = {
            submit: (event: Event) => {
                const form = event.target as HTMLFormElement | null
                const kind = form?.dataset?.form

                if (form !== null && kind === 'search') {
                    event.preventDefault()

                    const input = form.querySelector<HTMLInputElement>('input[name="query"]')

                    void AiAssistantController.search(currentChatId(), input?.value ?? '')
                }

                if (form !== null && kind === 'ask') {
                    event.preventDefault()

                    const input = form.querySelector<HTMLInputElement>('input[name="question"]')

                    void AiAssistantController.ask(currentChatId(), input?.value ?? '')
                }
            },
            change: (event: Event) => {
                const target = event.target as HTMLSelectElement | null

                if (target?.id === 'ai-chat-select') {
                    const chatId = Number.parseInt(target.value, 10)

                    if (Number.isInteger(chatId)) {
                        AiAssistantController.selectChat(chatId)
                    }
                }
            },
        } as unknown as Record<string, () => void>

        super({
            ...props,
            events,
        })
    }

    componentDidMount() {
        void AiAssistantController.loadChats()
    }

    render() {
        return this.compile(template, this.props)
    }
}

const mapAssistantState = (state: AppState) => {
    const assistant = currentAssistant(state)
    const aiChats = currentChats(state)

    return {
        aiChats,
        hasChats: aiChats.length > 0,
        query: assistant.query,
        isSearching: assistant.status === 'searching',
        isTyping: assistant.status === 'typing',
        isEmpty: assistant.status === 'empty',
        isError: assistant.status === 'error',
        hasAnswer: assistant.answer !== '',
        answer: assistant.answer,
        attachedFileId: assistant.attachedFileId,
        hasAttachment: assistant.attachedFileId !== null,
        documentCards: assistant.documents.map(chunk => ({
            file_id: chunk.file_id,
            title: `Документ #${chunk.document_id}, фрагмент ${chunk.ordinal}`,
            snippet: chunk.content,
        })),
        error: assistant.error,
    }
}

// Касты те же, что у ChatPage (прецедент stage 4): AppState закрыт, а
// ComponentProps не знает ключей фичи.
export const AssistantPage = withStore(
    // eslint-disable-next-line no-unused-vars
    mapAssistantState as unknown as (state: AppState) => ComponentProps
)(AssistantPageBase as typeof Block)
