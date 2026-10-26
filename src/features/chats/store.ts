// Слайс состояния chats (stage 4): типы живут во фиче, ядро от них не зависит.
// 2026-10-26-chat-search добавил слайс живого поиска chatSearch рядом.

import store, { AppState } from '../../utils/Store.ts'
import type { ChatInfo, ChatSearchMatch, ChatUser } from '../../utils/types.ts'

export interface ChatsSlice {
    getChats(): ChatInfo[]
    // eslint-disable-next-line no-unused-vars
    setChats(chats: ChatInfo[]): void
    getSelectedChat(): number | undefined
    // eslint-disable-next-line no-unused-vars
    selectChat(id: number): void
    getChatUsers(): ChatUser[] | undefined
    // eslint-disable-next-line no-unused-vars
    setChatUsers(users: ChatUser[]): void
}

export const chatsSlice: ChatsSlice = {
    getChats() {
        return store.getState().chats as ChatInfo[] ?? []
    },

    setChats(chats) {
        store.set('chats', chats)
    },

    getSelectedChat() {
        return store.getState().selectedChat
    },

    selectChat(id) {
        store.set('selectedChat', id)
    },

    getChatUsers() {
        return store.getState().chatUsers
    },

    setChatUsers(users) {
        store.set('chatUsers', users)
    },
}

// Состояние живого поиска по чатам (2026-10-26-chat-search): активный
// запрос и серверные совпадения; неопределённый слайс — поиск не активен,
// страница рендерит полный список
export interface ChatSearchState {
    query: string
    results: ChatSearchMatch[]
}

// Ключ chatSearch AppState не объявляет — тот же каст-идиом, что у
// chatHistory (history/store.ts): тип живёт во фиче, чтение через
// приведение AppState, utils/Store.ts не трогаем
type ChatSearchStoreState = AppState & { chatSearch?: ChatSearchState }

export interface ChatSearchSlice {
    getSearch(): ChatSearchState | undefined
    // eslint-disable-next-line no-unused-vars
    setSearch(query: string, results: ChatSearchMatch[]): void
    resetSearch(): void
}

export const chatSearchSlice: ChatSearchSlice = {
    getSearch() {
        return (store.getState() as ChatSearchStoreState).chatSearch
    },

    setSearch(query, results) {
        store.set('chatSearch', { query, results })
    },

    resetSearch() {
        // undefined поверх ключа: слайс исчезает, страница видит «поиск
        // не активен»; уже пустому слайсу Store.set ничего не эмитит
        store.set('chatSearch', undefined)
    },
}
