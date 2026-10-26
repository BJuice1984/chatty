// Порты фичи chats (stage 4; stage 7 добавил поиск пользователей; stage
// chats-social добавил реакции): контракт за границей фичи.
// Реализация — собственный адаптер в ./api/{own,index}.ts; порт остаётся
// самодостаточным (без импортов). Раньше поиск жил в прямом вызове legacy UserApi
// из контроллера — с cutover он часть контракта.

import type {
    AddChatUsersData,
    ChatInfo,
    ChatSearchMatch,
    ChatUser,
    CreateChatData,
    DeleteChatData,
    ReactionSummary,
    RemoveChatUsersData,
    SearchUserData,
    TokenResponse,
} from '../../utils/types.ts'

// Результат поиска пользователей: id, полный email-логин и выводимое имя
// (локальная часть email — бэкенд выводит её сам)
export interface ChatsUserSearchResult {
    id: number
    login: string
    display_name: string
}

// Ответ toggle-реакции: свежая серверная сводка по сообщению. mine здесь
// относительно ЗАПРОСИВШЕГО (это REST-ответ), поэтому фронт может ей доверять
// для собственных чипов вьюера
export interface ReactionToggleResult {
    message_id: number
    active: boolean
    reactions: ReactionSummary[]
}

export interface ChatsPort {
    // meId — идентичность вьюера для правила «единственный собеседник» в
    // аватарах списка: адаптер стор не читает, контроллер передаёт параметром
    // eslint-disable-next-line no-unused-vars
    fetchChats(meId?: number): Promise<ChatInfo[]>
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
    // Запуск ассистента по сообщению в is_ai-чате (для отображения ошибки)
    // eslint-disable-next-line no-unused-vars
    runBot?(chatId: number, messageId: number): Promise<{ id: number; status: string; error_kind: string | null }>
    // eslint-disable-next-line no-unused-vars
    changeChatAvatar(data: FormData): Promise<{ avatar: string }>
    // eslint-disable-next-line no-unused-vars
    searchUsers(data: SearchUserData): Promise<ChatsUserSearchResult[]>
    // Живой поиск по чатам (2026-10-26-chat-search): case-insensitive
    // подстрока по title и содержимому сообщений чатов пользователя;
    // порядок и cap (50) — серверные, клиент рендерит как приехало
    // eslint-disable-next-line no-unused-vars
    searchChats(query: string): Promise<ChatSearchMatch[]>
    // toggle-реакция: POST /chats/{cid}/messages/{mid}/reactions {emoji}
    // eslint-disable-next-line no-unused-vars
    setReaction(data: { chatId: number; messageId: number; emoji: string }): Promise<ReactionToggleResult>
}

// Событие реакции из WS-broadcast {type:'reaction'}: mine-флагов НЕТ —
// событие описывает только действие (кто/что/вкл-выкл), сводку каждый
// клиент пересчитывает viewer-side
export interface ChatReactionEvent {
    chat_id: number
    message_id: number
    user_id: number
    emoji: string
    active: boolean
}

// Шлюз сообщений (stage 7; stage 11 добавил историю; chats-social добавил
// реплаи и закрытие сокета чата): реализация — ws/gateway.ts на own-адаптере
// (cookie-аутентификация), замена MessagesController. loadHistory — курсорная
// пагинация «загрузить ещё»: {type:'history', content:{before_id, limit}};
// сами сообщения возвращаются WS-событием Message. Все методы обязательны:
// литералы порта в тестах обновляются вместе с контрактом. Токен connect() —
// историческая часть сигнатуры (cookie-аутентификация токен не использует),
// контроллерский цикл fetchChats → getToken(''-сентинел) → connect остаётся
// нетронутым.
export interface ChatMessagesPort {
    // replyToId — необязательный ответ на сообщение чата (reply_to_id)
    // eslint-disable-next-line no-unused-vars
    sendMessage(chatId: number, message: string, replyToId?: number): Promise<void>
    // eslint-disable-next-line no-unused-vars
    connect(chatId: number, token: string): Promise<void>
    // eslint-disable-next-line no-unused-vars
    loadHistory(chatId: number, beforeId: number | null, limit: number): Promise<void>
    // явное закрытие сокета чата (событие chat_deleted/выход): без реконнекта
    // eslint-disable-next-line no-unused-vars
    closeChat(chatId: number): Promise<void>
}
