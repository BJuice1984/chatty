// Own-адаптер порта chats (stage 7; stage chats-social добавил поиск
// пользователей, удаление чата и реакции): контракт собственного бэкенда —
// POST /chats (создание), GET /chats (список), POST /chats/{id}/members
// (добавление участника, по одному user_id на вызов), GET /users?login=
// (префиксный поиск), DELETE /chats/{id} (owner-only, перед удалением бэкенд
// рассылает WS chat_deleted и закрывает сокеты чата), POST
// /chats/{cid}/messages/{mid}/reactions (toggle). Остальные операции
// (список/удаление участников, аватар чата) бэкендом не предоставлены и
// явно отвергаются.
//
// getToken возвращает пустой токен-сентинел: WS own-режима аутентифицируется
// cookie, а не токеном в URL (см. ws/own.ts) — контроллерский цикл
// fetchChats → getToken → connect остаётся нетронутым.

import HTTPTransport from '../../../utils/HTTPTransport.ts'
import { readCsrfToken } from '../../../utils/csrf.ts'
import type { ChatInfo, ReactionSummary } from '../../../utils/types.ts'
import type { ChatsPort, ChatsUserSearchResult, ReactionToggleResult } from '../ports.ts'

export interface OwnChatResponse {
    id: number
    title: string
    owner_id: number
    is_ai: boolean
    created_at: string
    unread_count?: number
}

// Ответ GET /users?login= : id, полный (нижнерегистровый) email и выводимое
// имя (локальная часть email) — выводит сервер
export type OwnUserSearchResponse = ChatsUserSearchResult[]

interface OwnReactionSummaryResponse {
    emoji: string
    count: number
    mine: boolean
}

const http = new HTTPTransport('/chats')
// поиск пользователей живёт вне префикса /chats (GET /users)
const usersHttp = new HTTPTransport('/users')

function unsupported(method: string): never {
    throw new Error(`Операция ${method} недоступна в own-режиме: контракт бэкенда её не предоставляет`)
}

export function toChatInfo(response: OwnChatResponse): ChatInfo {
    return {
        id: response.id,
        title: response.title,
        // контракт не даёт картинок: раздаём локальные аватарки по id чата
        avatar: `/images/avatars/${(response.id % 8) + 1}.svg`,
        unread_count: response.unread_count ?? 0,
        // ИИ-чат: бейдж и акцент в списке чатов
        is_ai: response.is_ai,
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
    async deleteChat(data) {
        // owner-only на бэкенде; перед 204 участникам уходит WS chat_deleted
        await http.delete(`/${data.chatId}`, { csrfToken: readCsrfToken() })
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
    async getChatUsers(chatId: number) {
        const members = await (http.get(`/${chatId}/members`) as unknown as Promise<
            { id: number; login: string; display_name: string }[]
        >)

        return members.map(member => ({
            id: member.id,
            login: member.login,
            display_name: member.display_name,
            email: member.login,
            first_name: member.display_name,
            second_name: '',
            phone: '',
            avatar: `/images/avatars/${(member.id % 8) + 1}.svg`,
        }))
    },
    changeChatAvatar() {
        unsupported('changeChatAvatar')
    },
    async searchUsers(data) {
        const users = await (usersHttp.get('', { data: { login: data.login } }) as unknown as Promise<OwnUserSearchResponse>)

        return users
    },
    async setReaction(data) {
        const response = await (http.post(`/${data.chatId}/messages/${data.messageId}/reactions`, {
            data: { emoji: data.emoji },
            csrfToken: readCsrfToken(),
        }) as unknown as Promise<{ message_id: number; active: boolean; reactions: OwnReactionSummaryResponse[] }>)

        // сводка сервера уже viewer-relative (запросил вьюер) — прокидываем как есть
        const reactions: ReactionSummary[] = response.reactions.map(item => ({
            emoji: item.emoji,
            count: item.count,
            mine: item.mine,
        }))

        return {
            message_id: response.message_id,
            active: response.active,
            reactions,
        } satisfies ReactionToggleResult
    },

    async runBot(chatId: number, messageId: number) {
        return http.post(`/${chatId}/bot/runs`, { data: { message_id: messageId }, csrfToken: readCsrfToken() })
    },
}