// Контроллер AI-ассистента (stage 10): единственное место бизнес-логики
// фичи. Все внешние вызовы идут через порт; любое исключение становится
// текстовым error-состоянием, никогда — исполняемым DOM.

import { aiAssistantPort } from './api/index.ts'
import { type AiAssistantPort, AiBotRunError, type AiChatSummary } from './ports.ts'
import { aiAssistantSlice } from './store.ts'

export const AI_SEARCH_TOP_K = 5

function errorText(error: unknown): string {
    if (error instanceof Error) {
        return error.message
    }

    return String(error)
}

export class AiAssistantController {
    private readonly port: AiAssistantPort
    // RV6: повторный ask не стартует, пока идёт первый (re-entrancy guard).
    private askInFlight = false

    constructor(port: AiAssistantPort = aiAssistantPort) {
        this.port = port
    }

    async loadChats(): Promise<AiChatSummary[]> {
        try {
            const chats = await this.port.fetchChats()
            const aiChats = chats.filter(chat => chat.is_ai)

            aiAssistantSlice.setChats(aiChats)

            return aiChats
        } catch (error) {
            // Список чатов недоступен (бэкенд недоступен/ответил ошибкой) —
            // явное error-состояние вместо тихого пустого списка.
            aiAssistantSlice.setChats([])
            aiAssistantSlice.setAssistant({ status: 'error', error: errorText(error) })

            return []
        }
    }

    selectChat(chatId: number): void {
        // Смена чата обнуляет результаты чужого контекста (RV4): под новым
        // чатом не должны оставаться документы/вопрос/ответ предыдущего.
        // NEW-1: статус тоже сбрасывается в idle — раньше под новым чатом
        // оставался чужой searching/typing/error.
        aiAssistantSlice.setAssistant({
            status: 'idle',
            chatId,
            documents: [],
            answer: '',
            question: '',
            attachedFileId: null,
            error: '',
        })
    }

    // NEW-2: после await чат мог смениться — результат чужого контекста не
    // пишется (иначе ответ/ошибка первого чата всплывали под вторым).
    private isStaleChat(chatId: number): boolean {
        return aiAssistantSlice.getAssistant().chatId !== chatId
    }

    async search(chatId: number, query: string): Promise<void> {
        const trimmed = query.trim()

        if (trimmed === '') {
            return
        }

        // Старты и ошибки обнуляют весь контент соседних состояний (RV3):
        // под ошибкой не должны висеть карточки/ответ предыдущего шага.
        aiAssistantSlice.setAssistant({
            status: 'searching',
            chatId,
            query: trimmed,
            documents: [],
            answer: '',
            attachedFileId: null,
            error: '',
        })

        try {
            const documents = await this.port.searchDocuments(chatId, trimmed, AI_SEARCH_TOP_K)

            if (this.isStaleChat(chatId)) {
                return
            }

            aiAssistantSlice.setAssistant(
                documents.length === 0
                    ? { status: 'empty', documents }
                    : { status: 'success', documents }
            )
        } catch (error) {
            if (this.isStaleChat(chatId)) {
                return
            }

            aiAssistantSlice.setAssistant({
                status: 'error',
                error: errorText(error),
                documents: [],
                answer: '',
                attachedFileId: null,
            })
        }
    }

    async ask(chatId: number, question: string): Promise<void> {
        const trimmed = question.trim()

        // RV6: пока идёт первый ask, второй не запускается — иначе два ответа
        // бота перезаписывали друг друга и состояния гонялись.
        if (trimmed === '' || this.askInFlight) {
            return
        }

        this.askInFlight = true

        try {
            // NEW-3: введённый вопрос сохраняется в слайс — пере-рендер
            // страницы не очищает инпут (идиома RV2 у search-инпута).
            aiAssistantSlice.setAssistant({
                status: 'typing',
                chatId,
                query: trimmed,
                question: trimmed,
                documents: [],
                answer: '',
                attachedFileId: null,
                error: '',
            })

            const { run, answerText } = await this.port.askBot(chatId, trimmed)

            if (this.isStaleChat(chatId)) {
                return
            }

            aiAssistantSlice.setAssistant({
                status: 'success',
                answer: answerText,
                attachedFileId: run.attachment_file_id,
            })
        } catch (error) {
            if (this.isStaleChat(chatId)) {
                return
            }

            const message = error instanceof AiBotRunError ? error.message : errorText(error)

            aiAssistantSlice.setAssistant({
                status: 'error',
                error: message,
                documents: [],
                answer: '',
                attachedFileId: null,
            })
        } finally {
            this.askInFlight = false
        }
    }

    reset(): void {
        aiAssistantSlice.reset()
    }
}

export default new AiAssistantController()
