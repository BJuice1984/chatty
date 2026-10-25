// Реестр слушателя stories-сокета: ws-модуль не импортирует контроллер
// напрямую (цикл controller → ws → controller), ровно как chats/ws/gateway.
// Слушатель один — StoriesController; own-адаптер зовёт notify-* из своего
// Message-обработчика.

import type { OwnStoryResponse } from '../api/own.ts'

export type StoriesSocketEvent =
    | { kind: 'story_created', content: OwnStoryResponse }
    | { kind: 'story_deleted', content: { story_id: number } }

// eslint-disable-next-line no-unused-vars
type StoriesSocketListener = (event: StoriesSocketEvent) => void

let listener: StoriesSocketListener | null = null

export function setStoriesSocketListener(newListener: StoriesSocketListener): void {
    listener = newListener
}

export function notifyStoriesSocketEvent(event: StoriesSocketEvent): void {
    listener?.(event)
}
