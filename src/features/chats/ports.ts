// Порты фичи chats (stage 4): контракт за границей фичи.
// Реализация по умолчанию — адаптер над legacy ChatsApi (read-only до stage 7);
// own-адаптер придёт с api-cutover.

import type {
    AddChatUsersData,
    ChatInfo,
    ChatUser,
    CreateChatData,
    DeleteChatData,
    RemoveChatUsersData,
    TokenResponse,
} from '../../utils/types.ts'

export interface ChatsPort {
    fetchChats(): Promise<ChatInfo[]>
    // eslint-disable-next-line no-unused-vars
    createChat(data: CreateChatData): Promise<void>
    // eslint-disable-next-line no-unused-vars
    deleteChat(data: DeleteChatData): Promise<void>
    // eslint-disable-next-line no-unused-vars
    getToken(chatId: number): Promise<TokenResponse>
    // eslint-disable-next-line no-unused-vars
    addUsers(data: AddChatUsersData): Promise<void>
    // eslint-disable-next-line no-unused-vars
    removeUsers(data: RemoveChatUsersData): Promise<void>
    // eslint-disable-next-line no-unused-vars
    getChatUsers(chatId: number): Promise<ChatUser[]>
    // eslint-disable-next-line no-unused-vars
    changeChatAvatar(data: FormData): Promise<{ avatar: string }>
}

// Шлюз отправки сообщений: реализация — сохранённый MessagesController
// (stage 1 compatibility-адаптер), снос вместе с WS-cutover (stage 7).
export interface ChatMessagesPort {
    // eslint-disable-next-line no-unused-vars
    sendMessage(chatId: number, message: string): Promise<void>
    // eslint-disable-next-line no-unused-vars
    connect(chatId: number, token: string): Promise<void>
}
