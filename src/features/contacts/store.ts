// Слайс состояния contacts (2026-11-01-contacts): тип живёт во фиче, ядро
// от него не зависит.

import store, { AppState } from '../../utils/Store.ts'
import type { ContactInfo } from '../../utils/types.ts'

// Ключ contacts AppState не объявляет — тот же каст-идиом, что у
// chatSearch (chats/store.ts) и chatHistory (history/store.ts): тип живёт
// во фиче, чтение через приведение AppState, utils/Store.ts не трогаем
type ContactStoreState = AppState & { contacts?: ContactInfo[] }

export interface ContactsSlice {
    getContacts(): ContactInfo[]
    // eslint-disable-next-line no-unused-vars
    setContacts(contacts: ContactInfo[]): void
}

export const contactsSlice: ContactsSlice = {
    getContacts() {
        return (store.getState() as ContactStoreState).contacts ?? []
    },

    setContacts(contacts) {
        store.set('contacts', contacts)
    },
}
