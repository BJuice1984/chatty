// Реестр слушателя stories-сокета: ws-модуль не импортирует контроллер
// напрямую (цикл controller → ws → controller), ровно как chats/ws/gateway.
// Слушатель один — StoriesController; own-адаптер зовёт notify-* из своего
// Message-обработчика. chat_added (2026-11-10) живёт ОТДЕЛЬНЫМ реестром:
// событие не stories-домена (юзера добавили в чат — карточка должна
// приехать в список без F5), его слушатель — ChatsFeatureController,
// отдельное поле не растягивает union stories-событий.

import type { OwnStoryResponse } from '../api/own.ts'

export type StoriesSocketEvent =
    | { kind: 'story_created', content: OwnStoryResponse }
    | { kind: 'story_deleted', content: { story_id: number } }

// eslint-disable-next-line no-unused-vars
type StoriesSocketListener = (event: StoriesSocketEvent) => void

// Юзера добавили в чат (2026-11-10): {chat_id}
// eslint-disable-next-line no-unused-vars
type ChatAddedListener = (chatId: number) => void

let listener: StoriesSocketListener | null = null

let chatAddedListener: ChatAddedListener | null = null

export function setStoriesSocketListener(newListener: StoriesSocketListener): void {
    listener = newListener
}

export function notifyStoriesSocketEvent(event: StoriesSocketEvent): void {
    listener?.(event)
}

export function setChatAddedListener(newListener: ChatAddedListener): void {
    chatAddedListener = newListener
}

export function notifyChatAdded(chatId: number): void {
    chatAddedListener?.(chatId)
}
