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
    // ИИ-чат (stage chats-social): собственный бэкенд отдаёт is_ai — по нему
    // список чатов рисует бейдж и акцент
    is_ai?: boolean
    // Владелец чата (2026-11-01-chat-leave): «Удалить из чата» в меню
    // участника доступно только ему
    owner_id?: number
    // Архивное членство (2026-11-01-chat-leave): left_at из GET /chats
    // относительно вьюера; отсутствию/null (активный участник, ответы POST
    // /chats и GET /chats/{id}) адаптер кладёт undefined
    leftAt?: string | null
    last_message?: {
        time: string
        content: string
    }
    [key: string]: unknown
}

// Совпадение живого поиска по чатам (2026-10-26-chat-search): где нашли
// (title/message/both) и окно подсветки. Сниппет опционален даже при
// matched_in 'message'/'both' — у сервера есть защитная ветка без окна,
// такой результат UI рисует без подсветки; title-only совпадениям сниппета
// и времени нет по контракту. Тип UI-стороны: DTO-зеркало живёт в api.
export interface ChatSearchMatch {
    chat_id: number
    matched_in: 'title' | 'message' | 'both'
    snippet?: { before: string; match: string; after: string } | null
    last_match_at?: string | null
}

// DTO контакта адресной книги (2026-11-01-contacts): id — id
// ПОЛЬЗОВАТЕЛЯ-контакта, login — полный email, display_name — его локальная
// часть; avatar уже разрешён own-адаптером (avatar_url ?? pool-фолбэк по id)
// — DTO-зеркало ответа GET /contacts живёт во фиче (features/contacts/api)
export interface ContactInfo {
    id: number
    login: string
    display_name: string
    avatar: string
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

// Правка профиля (2026-11-01-settings): контракт ЧАСТИЧНЫЙ — собственный
// бэкенд принимает только display_name/phone/send_read_receipts, own-адаптер
// шлёт лишь определённые поля (тумблер приватности несёт один флаг, отсутствующее
// поле колонку на сервере не затирает); legacy-поля форм (first_name/
// second_name/login/email) в own-запрос не попадают.
export interface ChangeUserData {
    first_name?: string
    second_name?: string
    display_name?: string
    login?: string
    email?: string
    phone?: string
    send_read_receipts?: boolean
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

// Цитируемое сообщение (stage chats-social): серверный снимок — кто сказал
// и укороченный текст (первые 80 символов считает бэкенд)
export interface MessageReplyTo {
    id: number
    user_id: number
    snippet: string
}

// Сводка реакций одного сообщения (stage chats-social). ВАЖНО: флаг mine
// относителен — REST-ответ и история считают его относительно запросившего,
// WS-broadcast относительно отправителя действия. Собственные чипы фронт
// всегда пересчитывает viewer-side (см. ChatsFeatureController)
export interface ReactionSummary {
    emoji: string
    count: number
    mine: boolean
}

export interface Message {
    chat_id: number
    time: string
    type: string
    user_id: number
    content: string
    file?: MessageFile
    // вычисляемый безопасный URL вложения (filesUrl + /{file_id}/download)
    // — рендерится компонентом message
    file_url?: string
    // идентичность сообщения: ключ реакций, реплаев и дедупликации истории
    id?: number
    // цепочка ответов (stage chats-social): id цели и серверный снимок цитаты
    replyToId?: number
    replyTo?: MessageReplyTo | null
    reactions?: ReactionSummary[]
    // клиентский маркер системного сообщения об ошибке (провайдер бота
    // недоступен): UI подсвечивает такой пузырь жёлтым (_error у bubble)
    isError?: boolean
    [key: string]: unknown
}
