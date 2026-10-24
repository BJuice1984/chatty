// Порты фичи AI-ассистента (stage 10): фича самодостаточна — импортирует
// только utils/core, чужие фичи не трогает (guard: cross-feature = blocker).
// Контракты consumed endpoints приняты в stages 8/9.

export interface AiChatSummary {
    id: number
    title: string
    is_ai: boolean
}

export interface AiDocumentChunk {
    document_id: number
    file_id: number
    ordinal: number
    content: string
    score: number
}

export type AiBotRunStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface AiBotRun {
    id: number
    chat_id: number
    message_id: number
    status: AiBotRunStatus
    attempt: number
    error_kind: string | null
    response_message_id: number | null
    attachment_file_id: number | null
}

export interface AiAnswer {
    run: AiBotRun
    answerText: string
}

export interface AiAssistantPort {
    fetchChats(): Promise<AiChatSummary[]>
    // eslint-disable-next-line no-unused-vars
    searchDocuments(chatId: number, query: string, topK: number): Promise<AiDocumentChunk[]>
    // eslint-disable-next-line no-unused-vars
    askBot(chatId: number, question: string): Promise<AiAnswer>
}

// Явная ошибка незавершённого/упавшего bot-рана: контроллер переводит её в
// текстовое error-состояние, никогда — в исполняемый DOM.
export class AiBotRunError extends Error {
    readonly code = 'AI_BOT_RUN_FAILED'

    readonly errorKind: string

    constructor(errorKind: string) {
        super(`Бот не смог ответить: ${errorKind}`)
        this.name = 'AiBotRunError'
        this.errorKind = errorKind
    }
}
