// Фича-контроллер chats (stage 4; stage 7 — режимные адаптеры): бизнес-логика
// за портом. Порты по умолчанию — адаптеры, выбранные по env.mode:
// ./api/index.ts (HTTP) и ./ws/gateway.ts (WebSocket, замена MessagesController).

import store from '../../utils/Store.ts'
import type { ChatInfo } from '../../utils/types.ts'
import { chatsPort } from './api/index.ts'
import type { ChatMessagesPort, ChatsPort } from './ports.ts'
import { chatsSlice } from './store.ts'
import { chatMessagesPort } from './ws/gateway.ts'

export class ChatsFeatureController {
    private readonly port: ChatsPort
    private readonly messages: ChatMessagesPort

    constructor(
        port: ChatsPort = chatsPort,
        messages: ChatMessagesPort = chatMessagesPort
    ) {
        this.port = port
        this.messages = messages
    }

    async create(data: { title: string }): Promise<void> {
        try {
            await this.port.createChat(data)
        } catch (e: unknown) {
            console.error('Ошибка при создании чата:', e)
        }

        void this.fetchChats()
    }

    async fetchChats(): Promise<void> {
        let chats: ChatInfo[] = []

        try {
            chats = await this.port.fetchChats()
        } catch (e: unknown) {
            console.error('Ошибка при получении списка чата:', e)
        }

        for (const chat of chats) {
            try {
                const res = await this.port.getToken(chat.id)

                await this.messages.connect(chat.id, res.token)
            } catch (e: unknown) {
                console.error(`Ошибка при обработке чата с ID ${chat.id}:`, e)
            }
        }

        chatsSlice.setChats(chats)
    }

    async addUsersToChat(users: number[], chatId: number): Promise<void> {
        try {
            await this.port.addUsers({ users, chatId })
            // паритет с legacy: обновляем и список чатов, и пользователей чата
            void this.fetchChats()
            void this.getChatUsers(chatId)
        } catch (e: unknown) {
            console.error('Ошибка при добавлении пользователей в чат:', e)
        }
    }

    // Поиск пользователей для добавления в чат: метод порта (stage 7 перевёл
    // его из прямого вызова legacy UserApi в контракт ChatsPort).
    async addUsersByLogin(login: { login: string }, chatId: number): Promise<void> {
        try {
            const found = await this.port.searchUsers(login)

            if (found.length > 0) {
                await this.addUsersToChat(found.map(user => user.id), chatId)
            }
        } catch (e: unknown) {
            console.error('Ошибка при поиске и добавлении пользователя:', e)
        }
    }

    async delete(id: number): Promise<void> {
        try {
            await this.port.deleteChat({ chatId: id })

            void this.fetchChats()
        } catch (e: unknown) {
            console.error('Ошибка при удалении чата:', e)
        }
    }

    async changeChatAvatar(userData: FormData): Promise<void> {
        try {
            const newChatAva = await this.port.changeChatAvatar(userData)

            store.set('newChatAva', newChatAva.avatar)
        } catch (e: unknown) {
            console.error('Ошибка при изменении аватара чата:', e)
        }
    }

    async getChatUsers(id: number): Promise<void> {
        try {
            const users = await this.port.getChatUsers(id)

            users.forEach(user => {
                user.onClick = () => void this.deleteChatUsers({ users: [user.id], chatId: id })
            })

            chatsSlice.setChatUsers(users)
        } catch (e: unknown) {
            console.error('Ошибка при получении пользователей чата:', e)
        }
    }

    sendMessage(chatId: number, message: string): Promise<void> {
        return this.messages.sendMessage(chatId, message)
    }

    selectChat(id: number): void {
        chatsSlice.selectChat(id)
    }

    private async deleteChatUsers(data: { users: number[]; chatId: number }): Promise<void> {
        try {
            await this.port.removeUsers(data)
            void this.getChatUsers(data.chatId)
        } catch (e: unknown) {
            console.error('Ошибка при удалении пользователя из чата:', e)
        }
    }
}

export default new ChatsFeatureController()
