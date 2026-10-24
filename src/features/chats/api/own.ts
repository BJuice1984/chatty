// Own-адаптер порта chats (stage 7; stage chats-social добавил поиск
// пользователей, удаление чата и реакции; 2026-10-25-chats-list-members —
// составы участников в списке): контракт собственного бэкенда —
// POST /chats (создание), GET /chats (список с краткими составами
// участников), POST /chats/{id}/members
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
import { avatarPoolUrl } from '../../../utils/avatarPool.ts'
import type { ChatInfo, ReactionSummary } from '../../../utils/types.ts'
import type { ChatsPort, ChatsUserSearchResult, ReactionToggleResult } from '../ports.ts'

export interface OwnChatMemberResponse {
    id: number
    login: string
    display_name: string
    // файловый путь аватара участника ("{file_id}/download") или null
    avatar_url?: string | null
}

export interface OwnChatResponse {
    id: number
    title: string
    owner_id: number
    is_ai: boolean
    created_at: string
    unread_count?: number
    // файловый путь аватара чата ("{file_id}/download") или null
    avatar_url?: string | null
    // краткие составы участников из GET /chats; на старом ответе их нет —
    // собеседник тогда не вычисляется
    members?: OwnChatMemberResponse[]
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

// Аватар чата: свой avatar_url с бэкенда, иначе — реальный аватар
// единственного собеседника (не я) с pool-фолбэком; без meId или без
// составов в ответе собеседник не вычисляется; групповые чаты (не ровно
// один не-я участник) остаются без аватара
function companionAvatar(
    members: OwnChatMemberResponse[] | undefined,
    meId: number | undefined
): string {
    if (members === undefined || meId === undefined) {
        return ''
    }

    const companion = members.filter(member => member.id !== meId)

    if (companion.length !== 1) {
        return ''
    }

    return companion[0].avatar_url ?? avatarPoolUrl(companion[0].id)
}

export function toChatInfo(response: OwnChatResponse, meId?: number): ChatInfo {
    return {
        id: response.id,
        title: response.title,
        avatar: response.avatar_url ?? companionAvatar(response.members, meId),
        unread_count: response.unread_count ?? 0,
        // ИИ-чат: бейдж и акцент в списке чатов
        is_ai: response.is_ai,
    }
}

export const ownChatsPort: ChatsPort = {
    async fetchChats(meId?: number) {
        const chats = await (http.get('') as unknown as Promise<OwnChatResponse[]>)

        return chats.map(chat => toChatInfo(chat, meId))
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
            { id: number; login: string; display_name: string; avatar_url?: string | null }[]
        >)

        return members.map(member => ({
            id: member.id,
            login: member.login,
            display_name: member.display_name,
            email: member.login,
            first_name: member.display_name,
            second_name: '',
            phone: '',
            // реальный аватар участника, иначе pool-фолбэк
            avatar: member.avatar_url ?? avatarPoolUrl(member.id),
        }))
    },
    async changeChatAvatar(data: FormData) {
        // id чата UI кладёт в FormData полем chatId (кликнутая плитка —
        // не обязательно selectedChat); файловое поле называется avatar
        const chatId = data.get('chatId')
        const file = data.get('avatar')

        if (typeof chatId !== 'string' || chatId === '' || !(file instanceof File)) {
            throw new Error('Операция changeChatAvatar недоступна в own-режиме: форма не содержит chatId/avatar')
        }

        const payload = new FormData()

        payload.append('uploaded', file)
        payload.append('kind', 'chat')
        payload.append('chat_id', chatId)

        const response = await (new HTTPTransport('/files/avatars').post('', {
            data: payload,
            csrfToken: readCsrfToken(),
        }) as unknown as Promise<{ avatar_url: string | null }>)

        return { avatar: response.avatar_url ?? '' }
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