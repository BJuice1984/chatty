// Общие типы-описания UI (что страницы/компоненты передают в рендереры форм).
// Живут в utils, чтобы и pages, и components могли импортировать их вниз по слоям.

export interface Input {
    label: string
    name: string
    validateMessage: string
    // eslint-disable-next-line no-unused-vars
    validate: (value: string) => boolean
}

export interface Button<T = unknown> {
    label: string
    classType: string
    type: string
    onClick?: () => void
    // eslint-disable-next-line no-unused-vars
    handleSubmitClick?: (value: T) => void
}

// DTO-типы домена (stage 4): определяются здесь, НЕ реэкспортируются из api/ —
// utils не может импортировать вверх (layer-direction). Фичи и компоненты
// берут контракты здесь; legacy api-классы до сноса в stage 7 используют свои.

export interface ChatInfo {
    id: number
    title: string
    avatar: string
    unread_count: number
    last_message?: {
        time: string
        content: string
    }
    [key: string]: unknown
}

export interface ChatUser {
    id: number
    first_name: string
    second_name: string
    display_name: string
    login: string
    email: string
    phone: string
    avatar: string
    [key: string]: unknown
}

export interface CreateChatData {
    title: string
    [key: string]: unknown
}

export interface DeleteChatData {
    chatId: number
    [key: string]: unknown
}

export interface TokenResponse {
    token: string
    [key: string]: unknown
}

export interface AddChatUsersData {
    users: number[]
    chatId: number
    [key: string]: unknown
}

export interface RemoveChatUsersData {
    users: number[]
    chatId: number
    [key: string]: unknown
}

export interface SearchUserData {
    login: string
    [key: string]: unknown
}

export interface ChangeUserData {
    first_name: string
    second_name: string
    display_name: string
    login: string
    email: string
    phone: string
    [key: string]: unknown
}

// DTO сообщения (stage 7): переехал из MessagesController при WS-cutover —
// utils/types остаётся единственным домом DTO, Store и компоненты берут тип здесь.
export interface MessageFile {
    id: number
    user_id: number
    path: string
    filename: string
    content_type: string
    content_size: number
    upload_date: string
}

export interface Message {
    chat_id: number
    time: string
    type: string
    user_id: number
    content: string
    file?: MessageFile
    // вычисляемый безопасный URL вложения (practicum: fileUrl(file.path);
    // own: filesUrl + /{file_id}/download) — рендерится компонентом message
    file_url?: string
    [key: string]: unknown
}
