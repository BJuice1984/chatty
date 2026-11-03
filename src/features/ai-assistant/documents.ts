// Публичный RAG-поиск фичи для внешних потребителей через шов (2026-11-03):
// chats-контроллер дополняет ответ бота списком найденных документов.
// Живёт в фиче (порт и безопасность URL — её контракты), внешняя связь —
// только через features/index.ts

import { aiAssistantPort } from './api/index.ts'
import type { AiDocumentChunk } from './ports.ts'
import { documentDownloadUrl } from './safety.ts'

export interface DocumentHit {
    name: string
    url: string
}

// Топ-файлы по вопросу с настоящими original_name (дедуп по file_id —
// один файл несколькими чанками попадает в топ; список по score, первое
// вхождение файла — его лучший чанк) и безопасными ссылками скачивания
export async function searchChatDocumentHits(chatId: number, query: string, topK: number): Promise<DocumentHit[]> {
    const chunks: AiDocumentChunk[] = await aiAssistantPort.searchDocuments(chatId, query, topK)
    const seen = new Set<number>()
    const hits: DocumentHit[] = []

    for (const chunk of chunks) {
        if (seen.has(chunk.file_id)) {
            continue
        }

        seen.add(chunk.file_id)
        hits.push({
            name: chunk.file_name !== '' ? chunk.file_name : `Документ #${chunk.document_id}`,
            url: documentDownloadUrl(chunk.file_id),
        })
    }

    return hits
}
