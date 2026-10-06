// Own-адаптер порта chats (stage 7): контракт собственного бэкенда —
// POST /chats (создание), GET /chats (список), POST /chats/{id}/members
// (добавление участника, по одному user_id на вызов). Остальные операции
// (удаление чата, список/удаление участников, аватар чата, поиск пользователей)
// бэкендом не предоставлены и явно отвергаются.
//
// getToken возвращает пустой токен-сентинел: WS own-режима аутентифицируется
// cookie, а не токеном в URL (см. ws/own.ts) — контроллерный цикл
// fetchChats → getToken → connect остаётся нетронутым.

import HTTPTransport from '../../../utils/HTTPTransport.ts'
import { readCsrfToken } from '../../../utils/csrf.ts'
import type { ChatInfo } from '../../../utils/types.ts'
import type { ChatsPort } from '../ports.ts'

export interface OwnChatResponse {
    id: number
    title: string
    owner_id: number
    is_ai: boolean
    created_at: string
}

const http = new HTTPTransport('/chats')

function unsupported(method: string): never {
    throw new Error(`Операция ${method} недоступна в own-режиме: контракт бэкенда её не предоставляет`)
}

export function toChatInfo(response: OwnChatResponse): ChatInfo {
    return {
        id: response.id,
        title: response.title,
        avatar: '',
        unread_count: 0,
    }
}

export const ownChatsPort: ChatsPort = {
    async fetchChats() {
        const chats = await (http.get('') as unknown as Promise<OwnChatResponse[]>)

        return chats.map(toChatInfo)
    },
    async createChat(data) {
        await http.post('', { data: { title: data.title }, csrfToken: readCsrfToken() })
    },
    deleteChat() {
        unsupported('deleteChat')
    },
    getToken() {
        return Promise.resolve({ token: '' })
    },
    async addUsers(data) {
        // бэкенд принимает одного участника за вызов
        await Promise.all(
            data.users.map(user_id =>
                http.post(`/${data.chatId}/members`, { data: { user_id }, csrfToken: readCsrfToken() })
            )
        )
    },
    removeUsers() {
        unsupported('removeUsers')
    },
    getChatUsers() {
        unsupported('getChatUsers')
    },
    changeChatAvatar() {
        unsupported('changeChatAvatar')
    },
    searchUsers() {
        unsupported('searchUsers')
    },
}
