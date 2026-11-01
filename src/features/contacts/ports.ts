// Порты фичи contacts (2026-11-01-contacts): контракт адресной книги за
// границей фичи. Реализация — own-адаптер в ./api/{own,index}.ts; порт
// остаётся самодостаточным: без импортов других фич (поиск пользователей —
// тот же серверный эндпоинт GET /users?login=, что у chats, но контракт
// фича объявляет локально).

import type { ContactInfo } from '../../utils/types.ts'

// Результат поиска пользователей: id, полный (нижнерегистровый) email и
// выводимое имя (локальная часть email) — выводит сервер
export interface ContactSearchResult {
    id: number
    login: string
    display_name: string
}

// Результат get-or-create DM: ТОЛЬКО идентификатор чата. Статус создания
// (201 против 200) не входит в контракт: HTTPTransport резолвит один
// xhr.response и никому не отдаёт success-статус, а создавался чат или
// уже существовал, UI не различает (план, review F-1)
export interface DmChatResult {
    chatId: number
}

export interface ContactsPort {
    fetchContacts(): Promise<ContactInfo[]>
    // идемпотентное добавление: повтор по существующему контакту — 201
    // с той же строкой (прецедент add_member)
    // eslint-disable-next-line no-unused-vars
    addContact(userId: number): Promise<void>
    // eslint-disable-next-line no-unused-vars
    removeContact(userId: number): Promise<void>
    // префиксный поиск по логину-email для модалки «Добавить»
    // eslint-disable-next-line no-unused-vars
    searchUsers(login: string): Promise<ContactSearchResult[]>
    // get-or-create диалога 1:1 с контактом (POST /chats/dm)
    // eslint-disable-next-line no-unused-vars
    createDm(userId: number): Promise<DmChatResult>
}
