// Own-адаптер порта AI-ассистента (stage 10): контракты stages 8/9 —
// GET /chats (список, поле is_ai), POST /chats/{id}/documents/search
// (chat-scoped top-k), POST /chats/{id}/messages + POST /chats/{id}/bot/runs
// (синхронный ограниченный ран), ответ читается из истории
// GET /chats/{id}/messages по response_message_id (ран синхронный — ответ
// самый свежий и попадает на первую страницу).

import HTTPTransport from '../../../utils/HTTPTransport.ts'
import { readCsrfToken } from '../../../utils/csrf.ts'
import {
    type AiAssistantPort,
    type AiBotRun,
    AiBotRunError,
    type AiChatSummary,
    type AiDocumentChunk,
} from '../ports.ts'

interface OwnChatResponse {
    id: number
    title: string
    owner_id: number
    is_ai: boolean
    created_at: string
}

interface OwnDocumentChunkResponse {
    document_id: number
    file_id: number
    ordinal: number
    content: string
    score: number
}

interface OwnBotRunResponse {
    id: number
    chat_id: number
    message_id: number
    status: AiBotRun['status']
    attempt: number
    error_kind: string | null
    response_message_id: number | null
    attachment_file_id: number | null
}

interface OwnMessageResponse {
    id: number
    chat_id: number
    user_id: number
    content: string | null
    file_id: number | null
    client_message_id: string | null
    created_at: string
}

const http = new HTTPTransport('/chats')

export function toAiChatSummary(response: OwnChatResponse): AiChatSummary {
    return {
        id: response.id,
        title: response.title,
        is_ai: response.is_ai,
    }
}

export function toAiDocumentChunk(response: OwnDocumentChunkResponse): AiDocumentChunk {
    return {
        document_id: response.document_id,
        file_id: response.file_id,
        ordinal: response.ordinal,
        content: response.content,
        score: response.score,
    }
}

export function toAiBotRun(response: OwnBotRunResponse): AiBotRun {
    return {
        id: response.id,
        chat_id: response.chat_id,
        message_id: response.message_id,
        status: response.status,
        attempt: response.attempt,
        error_kind: response.error_kind,
        response_message_id: response.response_message_id,
        attachment_file_id: response.attachment_file_id,
    }
}

export function ensureSuccessfulRun(run: AiBotRun): AiBotRun {
    if (run.status !== 'succeeded' || run.response_message_id === null) {
        throw new AiBotRunError(run.error_kind ?? run.status)
    }

    return run
}

export function findAnswerText(messages: OwnMessageResponse[], responseMessageId: number): string {
    const answer = messages.find(message => message.id === responseMessageId)

    return answer?.content?.trim() ?? ''
}

export const ownAiAssistantPort: AiAssistantPort = {
    async fetchChats() {
        const chats = await (http.get('') as unknown as Promise<OwnChatResponse[]>)

        return chats.map(toAiChatSummary)
    },

    async searchDocuments(chatId, query, topK) {
        const chunks = await (http.post(`/${chatId}/documents/search`, {
            data: { query, top_k: topK },
        }) as unknown as Promise<OwnDocumentChunkResponse[]>)

        return chunks.map(toAiDocumentChunk)
    },

    async askBot(chatId, question) {
        const message = await (http.post(`/${chatId}/messages`, {
            data: { content: question },
            csrfToken: readCsrfToken(),
        }) as unknown as Promise<OwnMessageResponse>)

        const rawRun = await (http.post(`/${chatId}/bot/runs`, {
            data: { message_id: message.id },
            csrfToken: readCsrfToken(),
        }) as unknown as Promise<OwnBotRunResponse>)

        const run = ensureSuccessfulRun(toAiBotRun(rawRun))

        const page = await (http.get(`/${chatId}/messages`) as unknown as Promise<{ messages: OwnMessageResponse[] }>)

        return {
            run,
            answerText: findAnswerText(page.messages, run.response_message_id as number),
        }
    },
}
