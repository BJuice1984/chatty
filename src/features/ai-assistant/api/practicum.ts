// Practicum-адаптер порта AI-ассистента (stage 10): AI-эндпоинты
// (документы, бот) существуют только в собственном бэкенде — здесь каждая
// операция явно отвергается.

import type { AiAssistantPort } from '../ports.ts'

function unsupported(method: string): never {
    throw new Error(`Операция ${method} недоступна в practicum-режиме: AI-эндпоинты существуют только в own-режиме`)
}

export const practicumAiAssistantPort: AiAssistantPort = {
    fetchChats() {
        unsupported('fetchChats')
    },
    searchDocuments() {
        unsupported('searchDocuments')
    },
    askBot() {
        unsupported('askBot')
    },
}
