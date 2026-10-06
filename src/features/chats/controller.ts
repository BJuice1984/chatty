// Фича-контроллер chats (stage 4): бизнес-логика за портом.
// Дефолтная реализация порта — адаптер над legacy ChatsApi (api ниже features,
// снос legacy api — stage 7 вместе с own-адаптером). MessagesController —
// сохранённый stage 1 compatibility-адаптер WebSocket.

import API from '../../api/ChatsApi.ts'
import UsersAPI from '../../api/UserApi.ts'
import MessagesController from '../../controllers/MessagesController.ts'
import store from '../../utils/Store.ts'
import type { ChatInfo, ChatUser } from '../../utils/types.ts'
import type { ChatMessagesPort, ChatsPort } from './ports.ts'
import { chatsSlice } from './store.ts'

const messagesGateway: ChatMessagesPort = {
    sendMessage: (chatId, message) => {
        MessagesController.sendMessage(chatId, message)

        return Promise.resolve()
    },
    connect: async (chatId, token) => {
        await MessagesController.connect(chatId, token)
    },
}

// legacy DTO структурно уже своих контрактов (index-сигнатуры/отсутствие полей) — мост через unknown
const practicumChatsPort: ChatsPort = {
    fetchChats: () => API.read() as unknown as Promise<ChatInfo[]>,
    createChat: (data) => API.create(data),
    deleteChat: (data) => API.delete(data) as unknown as Promise<void>,
    getToken: (chatId) => API.getToken(chatId) as unknown as Promise<{ token: string }>,
    addUsers: (data) => API.addUsers(data) as unknown as Promise<void>,
    removeUsers: (data) => API.deleteUsers(data) as unknown as Promise<void>,
    getChatUsers: (chatId) => API.getUsers(chatId) as unknown as Promise<ChatUser[]>,
    changeChatAvatar: (data) => API.changeChatAvatar(data),
}

export class ChatsFeatureController {
    private readonly port: ChatsPort
    private readonly messages: ChatMessagesPort

    constructor(
        port: ChatsPort = practicumChatsPort,
        messages: ChatMessagesPort = messagesGateway
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
            void this.getChatUsers(chatId)
        } catch (e: unknown) {
            console.error('Ошибка при добавлении пользователей в чат:', e)
        }
    }

    // Поиск пользователей для добавления в чат: общий метод legacy api
    // (read-only до stage 7), не чужая фича.
    async addUsersByLogin(login: { login: string }, chatId: number): Promise<void> {
        try {
            const found = await UsersAPI.searchUsers(login)

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
