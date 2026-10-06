// Слайс состояния chats (stage 4): типы живут во фиче, ядро от них не зависит.

import store from '../../utils/Store.ts'
import type { ChatInfo, ChatUser } from '../../utils/types.ts'

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
