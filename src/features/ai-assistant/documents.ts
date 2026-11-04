// Публичный RAG-поиск фичи для внешних потребителей через шов (2026-11-03):
// chats-контроллер дополняет ответ бота списком найденных документов.
// Живёт в фичи (порт и безопасность URL — её контракты), внешняя связь —
// только через features/index.ts

import { aiAssistantPort } from './api/index.ts'
import type { AiDocumentChunk } from './ports.ts'
import { documentDownloadUrl } from './safety.ts'

export interface DocumentHit {
    name: string
    url: string
}

// Порог релевантности (cosine, bge-m3) — зеркало бэкенд-настройки
// CHATTY_BOT_RAG_MIN_SCORE (backend/app/bot/config.py, default 0.5):
// чанки ниже порога не показываются под ответом бота (live-замер
// 2026-11-03: релевантные запросы дают top-1 0.62-0.69, нерелевантные
// 0.38-0.41 — порог режет чисто с запасом в обе стороны)
export const RAG_RELEVANT_MIN_SCORE = 0.5

// Чистое отображение топ-чанков в список файлов: фильтр по порогу,
// дедуп по file_id (один файл несколькими чанками; список по score —
// первое вхождение файла и есть его лучший чанк), настоящее имя
// (original_name, фолбэк «Документ #id») и безопасный URL скачивания
export function toDocumentHits(chunks: AiDocumentChunk[], minScore: number = RAG_RELEVANT_MIN_SCORE): DocumentHit[] {
    const seen = new Set<number>()
    const hits: DocumentHit[] = []

    for (const chunk of chunks) {
        if (chunk.score < minScore || seen.has(chunk.file_id)) {
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

export async function searchChatDocumentHits(chatId: number, query: string, topK: number): Promise<DocumentHit[]> {
    const chunks: AiDocumentChunk[] = await aiAssistantPort.searchDocuments(chatId, query, topK)

    return toDocumentHits(chunks)
}
