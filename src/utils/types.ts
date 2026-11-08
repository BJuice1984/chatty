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
    // атрибут disabled самой кнопки (2026-11-07): полёт запроса или сон
    // формы до валидных изменений; со стилевым classType не связан
    disabled?: boolean
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
    // Авто-название (2026-11-06-chat-create-flow): бэкенд отдаёт auto_titled
    // — шапка мессенджера рендерит заголовок сразу инпутом (автодополнение
    // сервером), ручной rename гасит флаг навсегда
    auto_titled?: boolean
    // Владелец чата (2026-11-01-chat-leave): «Удалить из чата» в меню
    // участника доступно только ему
    owner_id?: number
    // Дата создания чата (2026-11-05-messenger-ux-pack): fallback сортировки
    // списка — свежесозданный чат без сообщений поднимается в верх списка
    // вместо того, чтобы тонуть
    created_at?: string
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
    // 'member' (2026-11-05-messenger-ux-pack): '@'-режим — совпал СОУЧАСТНИК
    // (префикс login/display_name); сниппет несёт имя совпавшего, подсветки
    // заголовка и времени совпадения нет
    matched_in: 'title' | 'message' | 'both' | 'member'
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
    // бот-аккаунт ассистента (2026-11-08): серверный is_bot из формы
    // участника — по нему сообщения бота получают чип «✦ AI»
    is_bot?: boolean
    // архивное членство (участник покинул чат, GET /chats/{id}/members):
    // null/undefined — активный; шапка мессенджера гасит такую иконку
    left_at?: string | null
    [key: string]: unknown
}

// Плашка автора сообщения (2026-11-08-mobile-messenger-ux): аватар +
// логин над пузырём первого сообщения серии автора в групповом чате;
// email уезжает в нативный title плашки
export interface MessageAuthorBadge {
    login: string
    email: string
    avatar: string
}

export interface CreateChatData {
    title: string
    // ИИ-чат (2026-10-27-ai-chat-creation): чекбокс формы создания и
    // one-click-плитки шлют флаг на POST /chats. Необязательность бережёт
    // прежние title-only вызовы: адаптер опускает поле, бэкенд дефолтит false
    is_ai?: boolean
    // Авто-название (2026-11-06-chat-create-flow): one-click-создание шлёт
    // флаг — сервер дописывает имена добавляемых участников в заголовок,
    // ручной rename гасит режим навсегда. Адаптер шлёт только выставленным
    auto_titled?: boolean
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

// Вложение-файл в списке внутри пузыря (2026-11-02-ui-ux): имя для
// отображения и безопасный URL скачивания; список строит маппинг
// Messenger из file_url/file (мок бота подставляет имена найденных
// документов, пока бот отключён)
export interface MessageAttachment {
    name: string
    url: string
}

export interface Message {
    chat_id: number
    time: string
    type: string
    user_id: number
    content: string
    // маркер служебного сообщения с сервера (2026-11-05-messenger-ux-pack,
    // messages.kind): отсутствию/null — обычное сообщение-пузырь; сегодня
    // единственное значение 'chat_renamed' — строка «кто и когда переименовал
    // чат», UI рисует её служебной строкой без пузыря
    kind?: string
    file?: MessageFile
    // исходное имя файла вложения с сервера (2026-11-06): имя пункта
    // вложения и иконка по расширению; без него — фолбэк «Файл»
    file_name?: string
    // вычисляемый безопасный URL вложения (filesUrl + /{file_id}/download)
    // — рендерится компонентом message
    file_url?: string
    // список вложений пузыря (2026-11-02-ui-ux): рендерится файловой
    // строкой (иконка + имя + «Скачать»); строится из file_url/file,
    // отсутствию — прежний вид без вложений
    attachments?: MessageAttachment[]
    // идентичность сообщения: ключ реакций, реплаев и дедупликации истории
    id?: number
    // цепочка ответов (stage chats-social): id цели и серверный снимок цитаты
    replyToId?: number
    replyTo?: MessageReplyTo | null
    reactions?: ReactionSummary[]
    // клиентский маркер системного сообщения об ошибке (провайдер бота
    // недоступен): UI подсвечивает такой пузырь жёлтым (_error у bubble)
    isError?: boolean
    // клиентский плейсхолдер прогона бота: пока POST /bot/runs в полёте,
    // лента хвостит «Ассистент печатает…» (_pending у bubble, пульсация);
    // контроллер снимает плейсхолдер по завершении прогона
    isPending?: boolean
    // клиентский маркер «Чат недоступен» (2026-11-07-messenger-ux-pack-2):
    // сокет чата умер исчерпанием реконнектов — контроллер ставит бабл
    // ошибки в ленту и убирает его при восстановлении соединения
    isChatUnavailable?: boolean
    // клиентский идентификатор оптимистичной записи своего сообщения
    // (2026-11-07): стоит до серверного эха, маркер «отправляется»;
    // эхо заменяет запись (взгляд воркера — oldest ownTempId FIFO)
    ownTempId?: string
    [key: string]: unknown
}
