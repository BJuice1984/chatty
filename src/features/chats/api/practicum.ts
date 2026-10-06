// Practicum-адаптер порта chats (stage 7): код legacy ChatsApi/UserApi(search),
// перенесённый на HTTPTransport с env-URL. Endpoint'ы сохранены 1:1.
// HTTPMethod транспорта типизирован Promise<never> — присваивается в контракт
// порта без кастов (never assignable).

import HTTPTransport from '../../../utils/HTTPTransport.ts'
import type {
    AddChatUsersData,
    CreateChatData,
    DeleteChatData,
    RemoveChatUsersData,
    SearchUserData,
} from '../../../utils/types.ts'
import type { ChatsPort } from '../ports.ts'

const http = new HTTPTransport('/chats')
const usersHttp = new HTTPTransport('/user')

export const practicumChatsPort: ChatsPort = {
    fetchChats: () => http.get('/'),
    async createChat(data: CreateChatData) {
        await http.post('/', { data: { ...data } })
    },
    async deleteChat(data: DeleteChatData) {
        await http.delete('/', { data: { ...data } })
    },
    getToken: (chatId: number) => http.post(`/token/${chatId}`),
    async addUsers(data: AddChatUsersData) {
        await http.put('/users', { data: { ...data } })
    },
    async removeUsers(data: RemoveChatUsersData) {
        await http.delete('/users', { data: { ...data } })
    },
    getChatUsers: (chatId: number) => http.get(`/${chatId}/users`),
    changeChatAvatar: (data: FormData) => http.put('/avatar', { data }),
    searchUsers: (data: SearchUserData) => usersHttp.post('/search', { data: { ...data } }),
}
