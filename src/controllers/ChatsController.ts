import API, {
    ChatInfo,
    ChatsAPI,
    CreateChatData,
    TokenResponse,
    deleteChatUsers,
} from '../api/ChatsApi.ts'
import store from '../utils/Store.ts'
import MessagesController from './MessagesController.ts'

class ChatsController {
    private readonly api: ChatsAPI

    constructor() {
        this.api = API
    }

    async create(title: CreateChatData): Promise<void> {
        try {
            await this.api.create(title)
        } catch (e: unknown) {
            console.error('Ошибка при создании чата:', e)
        }

        void this.fetchChats()
    }

    async fetchChats(): Promise<void> {
        let chats: ChatInfo[] = []

        try {
            chats = await this.api.read()
        } catch (e: unknown) {
            console.error('Ошибка при получении списка чатов:', e)
        }

        for (const chat of chats) {
            try {
                const res: TokenResponse = await this.getToken(chat.id)

                const token: string = res.token

                await MessagesController.connect(chat.id, token)
            } catch (e: unknown) {
                console.error(`Ошибка при обработке чата с ID ${chat.id}:`, e)
            }
        }

        store.set('chats', chats)
    }

    async addUsersToChat(users: number[], chatId: number) {
        try {
            await this.api.addUsers({ users, chatId })
            void this.fetchChats()
        } catch (e: unknown) {
            console.error('Ошибка при добавлении пользователей в чат:', e)
        }
    }

    async delete(id: number) {
        try {
            await this.api.delete({ chatId: id })

            void this.fetchChats()
        } catch (e: unknown) {
            console.error('Ошибка при удалении чата:', e)
        }
    }

    async changeChatAvatar(userData: FormData) {
        try {
            const newChatAva = await this.api.changeChatAvatar(userData)

            store.set('newChatAva', newChatAva.avatar)
        } catch (e: unknown) {
            console.error('Ошибка при изменения аватара чата', e)
        }
    }

    async getChatUsers(id: number) {
        try {
            const users = await this.api.getUsers(id)

            users.forEach(user => {
                user.onClick = () => void this.deleteChatUsers({ users: [user.id], chatId: id })
            })

            store.set('chatUsers', users)
        } catch (e: unknown) {
            console.error('Ошибка при получении пользователей чата:', e)
        }
    }

    private async deleteChatUsers(data: deleteChatUsers) {
        try {
            await this.api.deleteUsers(data)
            void this.getChatUsers(data.chatId)
        } catch (e: unknown) {
            console.error('Ошибка при удалении пользователя из чата', e)
        }
    }

    getToken(id: number) {
        return this.api.getToken(id)
    }

    selectChat(id: number) {
        store.set('selectedChat', id)
    }
}

export default new ChatsController()
