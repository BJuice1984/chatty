// Own-адаптер порта contacts (2026-11-01-contacts): контракт собственного
// бэкенда — GET /contacts (список, порядок серверный: created_at DESC),
// POST /contacts {user_id} (идемпотентное добавление, csrf), DELETE
// /contacts/{user_id} (csrf), GET /users?login= (префиксный поиск — тот же
// эндпоинт, что у chats, на собственном транспорте), POST /chats/dm
// {user_id} (get-or-create диалога, csrf).
//
// createDm маппит ответ в {chatId: id} и НИЧЕГО больше: HTTPTransport
// резолвит один xhr.response (utils/HTTPTransport.ts), success-статус
// (200-существовал против 201-создан) никому не виден и в контракт не
// входит (план, review F-1).

import HTTPTransport from '../../../utils/HTTPTransport.ts'
import { readCsrfToken } from '../../../utils/csrf.ts'
import { avatarPoolUrl } from '../../../utils/avatarPool.ts'
import type { ContactInfo } from '../../../utils/types.ts'
import type { ContactSearchResult, ContactsPort, DmChatResult } from '../ports.ts'

// Элемент ответа GET /contacts: id — id ПОЛЬЗОВАТЕЛЯ-контакта; login —
// полный нижнерегистровый email, display_name — его локальная часть (то же
// правило, что у поиска пользователей); avatar_url — файловый путь
// ("{file_id}/download") или null
export interface OwnContactResponse {
    id: number
    login: string
    display_name: string
    avatar_url?: string | null
    created_at: string
}

// Ответ GET /users?login= : id, полный (нижнерегистровый) email и выводимое
// имя (локальная часть email) — выводит сервер
export type OwnUserSearchResponse = ContactSearchResult[]

// Ответ POST /chats/dm — ChatResponse; адаптеру из него нужен только id
interface OwnDmChatResponse {
    id: number
}

const http = new HTTPTransport('/contacts')
// поиск пользователей живёт вне префикса /contacts (GET /users)
const usersHttp = new HTTPTransport('/users')
// get-or-create DM живёт в домене chats (POST /chats/dm)
const chatsHttp = new HTTPTransport('/chats')

// Единственная точка маппинга контакта: аватар — свой файловый avatar_url,
// иначе детерминированный pool-фолбэк по id пользователя
export function toContactInfo(response: OwnContactResponse): ContactInfo {
    return {
        id: response.id,
        login: response.login,
        display_name: response.display_name,
        avatar: response.avatar_url ?? avatarPoolUrl(response.id),
    }
}

export const ownContactsPort: ContactsPort = {
    async fetchContacts() {
        const contacts = await (http.get('') as unknown as Promise<OwnContactResponse[]>)

        return contacts.map(toContactInfo)
    },
    async addContact(userId) {
        await http.post('', { data: { user_id: userId }, csrfToken: readCsrfToken() })
    },
    async removeContact(userId) {
        await http.delete(`/${userId}`, { csrfToken: readCsrfToken() })
    },
    async searchUsers(login) {
        const users = await (usersHttp.get('', { data: { login } }) as unknown as Promise<OwnUserSearchResponse>)

        return users
    },
    async createDm(userId) {
        const response = await (chatsHttp.post('/dm', {
            data: { user_id: userId },
            csrfToken: readCsrfToken(),
        }) as unknown as Promise<OwnDmChatResponse>)

        // контракт — только идентификатор чата (review F-1)
        const result: DmChatResult = { chatId: response.id }

        return result
    },
}
