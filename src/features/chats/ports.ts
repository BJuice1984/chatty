// Порты фичи chats (stage 4; stage 7 добавил поиск пользователей): контракт за границей фичи.
// Реализации — адаптеры режимов в ./api/{practicum,own,index}.ts; порт остаётся
// самодостаточным (без импортов). Раньше поиск жил в прямом вызове legacy UserApi
// из контроллера — с cutover он часть контракта.

import type {
    AddChatUsersData,
    ChatInfo,
    ChatUser,
    CreateChatData,
    DeleteChatData,
    RemoveChatUsersData,
    SearchUserData,
    TokenResponse,
} from '../../utils/types.ts'

// Минимальная форма результата поиска: контроллеру нужны только id найденных
export interface ChatsUserSearchResult {
    id: number
    login: string
}

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
    // eslint-disable-next-line no-unused-vars
    searchUsers(data: SearchUserData): Promise<ChatsUserSearchResult[]>
}

// Шлюз сообщений (stage 7): реализация — ws/gateway.ts по env.mode
// (practicum: токен в URL; own: cookie-auth), замена MessagesController.
export interface ChatMessagesPort {
    // eslint-disable-next-line no-unused-vars
    sendMessage(chatId: number, message: string): Promise<void>
    // eslint-disable-next-line no-unused-vars
    connect(chatId: number, token: string): Promise<void>
}
