// Слайс состояния AI-ассистента (stage 10): типы живут во фиче, ядро от них
// не зависит. Store.ts писать нельзя (AppState закрыт) — чтение через тот же
// каст-идиом, что и chatsSlice.

import store, { AppState } from '../../utils/Store.ts'
import type { AiChatSummary, AiDocumentChunk } from './ports.ts'

export type AiAssistantStatus = 'idle' | 'searching' | 'typing' | 'success' | 'empty' | 'error'

export interface AiAssistantState {
    status: AiAssistantStatus
    chatId: number | null
    query: string
    documents: AiDocumentChunk[]
    answer: string
    attachedFileId: number | null
    error: string
}

type AiAssistantStoreState = AppState & { aiAssistant?: AiAssistantState; aiChats?: AiChatSummary[] }

const INITIAL_STATE: AiAssistantState = {
    status: 'idle',
    chatId: null,
    query: '',
    documents: [],
    answer: '',
    attachedFileId: null,
    error: '',
}

export const AI_ASSISTANT_INITIAL_STATE: AiAssistantState = INITIAL_STATE

export interface AiAssistantSlice {
    getAssistant(): AiAssistantState
    // eslint-disable-next-line no-unused-vars
    setAssistant(patch: Partial<AiAssistantState>): void
    getChats(): AiChatSummary[]
    // eslint-disable-next-line no-unused-vars
    setChats(chats: AiChatSummary[]): void
    reset(): void
}

export const aiAssistantSlice: AiAssistantSlice = {
    getAssistant() {
        return (store.getState() as AiAssistantStoreState).aiAssistant ?? INITIAL_STATE
    },

    setAssistant(patch) {
        store.set('aiAssistant', { ...aiAssistantSlice.getAssistant(), ...patch })
    },

    getChats() {
        return (store.getState() as AiAssistantStoreState).aiChats ?? []
    },

    setChats(chats) {
        store.set('aiChats', chats)
    },

    reset() {
        store.set('aiAssistant', { ...INITIAL_STATE })
        store.set('aiChats', [])
    },
}
