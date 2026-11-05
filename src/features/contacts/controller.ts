// Фича-контроллер contacts (2026-11-01-contacts): бизнес-логика за портом,
// стиль ошибок — ChatsFeatureController (порт-ошибки логируются, поток не
// роняется). Открытие диалога — чужая фича (chats): связь проводится в
// композиции (src/features/index.ts) через сеттер setChatOpener с
// noop-дефолтом (прецедент setProfileController) — прямой cross-feature
// импорт запрещён guard v2.

import type { ContactInfo } from '../../utils/types.ts'
import { contactsPort } from './api/index.ts'
import type { ContactSearchResult, ContactsPort, DmChatResult } from './ports.ts'
import { contactsSlice } from './store.ts'

// Открытие чата вне фичи: выбор чата + участники + маршрутизация — всё в
// композиции; до связывания стоит noop, openDm не падает
// eslint-disable-next-line no-unused-vars
type ChatOpener = (chatId: number) => void

const noopChatOpener: ChatOpener = () => {}

let chatOpener: ChatOpener = noopChatOpener

// Поиск всех чатов контакта («Найти все чаты», 2026-11-05-messenger-ux-pack):
// та же инъекция композицией. Опенер получает СЫРОЙ login контакта —
// '@'-префикс, сид бара и переход в мессенджер принадлежат features/index.ts
// eslint-disable-next-line no-unused-vars
type ChatSearchOpener = (login: string) => void

const noopChatSearchOpener: ChatSearchOpener = () => {}

let chatSearchOpener: ChatSearchOpener = noopChatSearchOpener

// Композиция (features/index.ts) вызывает это до первого рендера.
export function setChatOpener(opener: ChatOpener): void {
    chatOpener = opener
}

export function setChatSearchOpener(opener: ChatSearchOpener): void {
    chatSearchOpener = opener
}

export class ContactsFeatureController {
    private readonly port: ContactsPort

    constructor(port: ContactsPort = contactsPort) {
        this.port = port
    }

    async fetchContacts(): Promise<void> {
        let contacts: ContactInfo[] = []

        try {
            contacts = await this.port.fetchContacts()
        } catch (e: unknown) {
            console.error('Ошибка при получении списка контактов:', e)
        }

        contactsSlice.setContacts(contacts)
    }

    async addContact(userId: number): Promise<void> {
        try {
            await this.port.addContact(userId)
        } catch (e: unknown) {
            console.error('Ошибка при добавлении контакта:', e)
        }

        void this.fetchContacts()
    }

    async removeContact(userId: number): Promise<void> {
        try {
            await this.port.removeContact(userId)
        } catch (e: unknown) {
            console.error('Ошибка при удалении контакта:', e)
        }

        void this.fetchContacts()
    }

    // Поиск пользователей для модалки «Добавить»: ответ типизирован
    // {id, login, display_name} — модалка рисует список сама; ошибка порта
    // молчит и отдаёт пустой список
    async searchUsers(login: string): Promise<ContactSearchResult[]> {
        try {
            return await this.port.searchUsers(login)
        } catch (e: unknown) {
            console.error('Ошибка при поиске пользователей:', e)

            return []
        }
    }

    // Get-or-create диалога с контактом: контракт порта — только chatId,
    // его получает инъецированный опенер; ошибка порта опенер не будит
    async openDm(userId: number): Promise<void> {
        let result: DmChatResult

        try {
            result = await this.port.createDm(userId)
        } catch (e: unknown) {
            console.error('Ошибка при открытии диалога:', e)

            return
        }

        chatOpener(result.chatId)
    }

    // «Найти все чаты» контакта: логин берётся из contacts-слайса (страница
    // знает только id) и уходит инъецированному опенеру. Контакт мог быть
    // удалён из слайса между рендером меню и кликом — в отличие от openDm
    // отказ здесь реален, поэтому ошибка НЕ гасится: страница показывает
    // фидбек «Не удалось выполнить поиск». Возврат — явный Promise (не
    // async): отказ обязан стать rejection, а не sync-throw сквозь
    // делегирование клика страницы
    findChats(userId: number): Promise<void> {
        const login = contactsSlice.getContacts().find(contact => contact.id === userId)?.login

        if (login == null || login === '') {
            return Promise.reject(new Error('contact_not_found'))
        }

        chatSearchOpener(login)

        return Promise.resolve()
    }
}

export default new ContactsFeatureController()
