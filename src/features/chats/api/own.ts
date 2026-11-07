// Own-адаптер порта chats (stage 7; stage chats-social добавил поиск
// пользователей, удаление чата и реакции; 2026-10-25-chats-list-members —
// составы участников в списке; 2026-10-26-chat-search — last_message в
// списке и живой поиск; 2026-11-01-chat-leave — кик участника и собственный
// выход): контракт собственного бэкенда —
// POST /chats (создание), GET /chats (список с краткими составами
// участников и last_message), GET /chats/search?q= (живой поиск по чатам),
// POST /chats/{id}/members
// (добавление участника, по одному user_id на вызов), GET /users?login=
// (префиксный поиск), DELETE /chats/{id} (owner-only, перед удалением бэкенд
// рассылает WS chat_deleted и закрывает сокеты чата), DELETE
// /chats/{id}/members/{uid} (кик, owner-only, по одному участнику на вызов),
// POST /chats/{id}/leave (собственный выход, архивирует членство), POST
// /chats/{cid}/messages/{mid}/reactions (toggle).
//
// getToken возвращает пустой токен-сентинел: WS own-режима аутентифицируется
// cookie, а не токеном в URL (см. ws/own.ts) — контроллерский цикл
// fetchChats → getToken → connect остаётся нетронутым.

import HTTPTransport from '../../../utils/HTTPTransport.ts'
import { readCsrfToken } from '../../../utils/csrf.ts'
import { avatarPoolUrl } from '../../../utils/avatarPool.ts'
import { toMessage } from '../message-mapping.ts'
import type { ChatInfo, Message, ReactionSummary } from '../../../utils/types.ts'
import type { ChatsPort, ChatsUserSearchResult, CreateChatResult, ReactionToggleResult } from '../ports.ts'

export interface OwnChatMemberResponse {
    id: number
    login: string
    display_name: string
    // файловый путь аватара участника ("{file_id}/download") или null
    avatar_url?: string | null
}

// Ответ POST /chats: адаптеру из полного ChatResponse нужен только id
interface OwnCreatedChatResponse {
    id: number
}

export interface OwnChatResponse {
    id: number
    title: string
    owner_id: number
    is_ai: boolean
    // авто-название (013): шапка мессенджера рендерит заголовок инпутом
    auto_titled?: boolean
    created_at: string
    unread_count?: number
    // файловый путь аватара чата ("{file_id}/download") или null
    avatar_url?: string | null
    // краткие составы участников из GET /chats; на старом ответе их нет —
    // собеседник тогда не вычисляется
    members?: OwnChatMemberResponse[]
    // последнее сообщение чата из GET /chats (сортировка списка по
    // активности): content null — файловое вложение без текста; null/нет
    // поля — чат без сообщений и ответы POST /chats, GET /chats/{id}
    // (null-дефолт сервера)
    last_message?: { content: string | null; time: string } | null
    // архивное членство из GET /chats, относительно ЗАПРОСИВШЕГО: null —
    // активный участник; нет поля — ответы POST /chats и GET /chats/{id}
    // (единого членства там нет, список остаётся источником)
    left_at?: string | null
}

// Ответ GET /users?login= : id, полный (нижнерегистровый) email и выводимое
// имя (локальная часть email) — выводит сервер
export type OwnUserSearchResponse = ChatsUserSearchResult[]

// Элемент ответа GET /chats/search — DTO-зеркало UI-типа ChatSearchMatch
// (utils/types; реэкспорт вверх запрещён слоем). Сниппет может быть null
// даже при matched_in 'message'/'both' — у сервера есть защитная ветка без
// окна, клиент обязан рисовать такое без подсветки; title-only совпадениям
// сниппета и времени нет по контракту
interface OwnChatSearchResult {
    chat_id: number
    // 'member' — '@'-режим: сниппет несёт имя совпавшего участника
    matched_in: 'title' | 'message' | 'both' | 'member'
    snippet: { before: string; match: string; after: string } | null
    last_match_at: string | null
}

interface OwnReactionSummaryResponse {
    emoji: string
    count: number
    mine: boolean
}

const http = new HTTPTransport('/chats')
// поиск пользователей живёт вне префикса /chats (GET /users)
const usersHttp = new HTTPTransport('/users')

// Аватар чата: свой avatar_url с бэкенда, иначе — реальный аватар
// единственного собеседника (не я) с pool-фолбэком; без meId или без
// составов в ответе собеседник не вычисляется; групповые чаты (не ровно
// один не-я участник) остаются без аватара
function companionAvatar(
    members: OwnChatMemberResponse[] | undefined,
    meId: number | undefined
): string {
    if (members === undefined || meId === undefined) {
        return ''
    }

    const companion = members.filter(member => member.id !== meId)

    if (companion.length !== 1) {
        return ''
    }

    return companion[0].avatar_url ?? avatarPoolUrl(companion[0].id)
}

export function toChatInfo(response: OwnChatResponse, meId?: number): ChatInfo {
    return {
        id: response.id,
        title: response.title,
        avatar: response.avatar_url ?? companionAvatar(response.members, meId),
        unread_count: response.unread_count ?? 0,
        // дата создания — fallback сортировки «новый чат сверху»
        created_at: response.created_at,
        // ИИ-чат: бейдж и акцент в списке чатов
        is_ai: response.is_ai,
        // авто-название (2026-11-06): отсутствию — undefined
        auto_titled: response.auto_titled === true ? true : undefined,
        // владелец чата: пункт «Удалить из чата» в меню участника — только
        // для него (меню UI-волны)
        owner_id: response.owner_id,
        // архивное членство вьюера: отсутствию/null (активный участник,
        // ответы без членского контекста) — undefined
        leftAt: response.left_at ?? undefined,
        // Последнее сообщение (сортировка списка по активности): единая
        // точка плейсхолдера «Вложение» для файловых (content null);
        // отсутствующему/пустому last_message — undefined, чат тонет вниз
        last_message: response.last_message == null
            ? undefined
            : {
                content: response.last_message.content ?? 'Вложение',
                time: response.last_message.time,
            },
    }
}

export const ownChatsPort: ChatsPort = {
    async fetchChats(meId?: number) {
        const chats = await (http.get('') as unknown as Promise<OwnChatResponse[]>)

        return chats.map(chat => toChatInfo(chat, meId))
    },
    async createChat(data) {
        // is_ai/auto_titled уезжают только выставленными (прецедент
        // 2026-10-27-ai-chat-creation): бэкенд дефолтит false, а title-only
        // вызовы обязаны слать прежний payload без полей
        const payload: { title: string, is_ai?: boolean, auto_titled?: boolean } = { title: data.title }

        if (data.is_ai === true) {
            payload.is_ai = true
        }

        if (data.auto_titled === true) {
            payload.auto_titled = true
        }

        const response = await (http.post('', {
            data: payload,
            csrfToken: readCsrfToken(),
        }) as unknown as Promise<OwnCreatedChatResponse>)

        // one-click-флоу селектит свежую карточку по id (2026-11-06)
        const result: CreateChatResult = { chatId: response.id }

        return result
    },
    async deleteChat(data) {
        // owner-only на бэкенде; перед 204 участникам уходит WS chat_deleted
        await http.delete(`/${data.chatId}`, { csrfToken: readCsrfToken() })
    },
    async renameChat(chatId: number, title: string) {
        // PUT (не PATCH) — прецедент PUT /auth/profile: у транспорта нет
        // patch-метода, а контракт частичного обновления на PUT уже живет в
        // репозитории. Ответ — обновлённый ChatResponse (title для
        // оптимистичного патча контроллер уже применил локально)
        await http.put(`/${chatId}`, { data: { title }, csrfToken: readCsrfToken() })
    },
    async enableAi(chatId: number) {
        // «+AI»: включает бота в текущем чате; сервер рассылает WS
        // chat_ai_toggled активным участникам (наш патч — оптимистичный в
        // контроллере, чужие приедут событием)
        await http.put(`/${chatId}`, { data: { is_ai: true }, csrfToken: readCsrfToken() })
    },
    async disableAi(chatId: number) {
        // обратный «+AI»: гасит флаг бота тем же PUT; бот остаётся в
        // участниках, ран больше не стартует; WS chat_ai_toggled приедет и
        // нам (идемпотентный патч), и остальным участникам
        await http.put(`/${chatId}`, { data: { is_ai: false }, csrfToken: readCsrfToken() })
    },
    async readAll() {
        // «Пометить всё прочитанными»: bulk-upsert маркеров чтения по всем
        // чатам вьюера; {updated} — число чатов с сообщениями (фронт гасит
        // пилюли локально по факту успеха)
        const response = await (http.post('/read-all', { csrfToken: readCsrfToken() }) as unknown as Promise<
            { updated: number }
        >)

        return response
    },
    getToken() {
        return Promise.resolve({ token: '' })
    },
    async addUsers(data) {
        // бэкенд принимает одного участника за вызов
        await Promise.all(
            data.users.map(user_id =>
                http.post(`/${data.chatId}/members`, { data: { user_id }, csrfToken: readCsrfToken() })
            )
        )
    },
    async removeUsers(data) {
        // кик: owner-only на бэкенде; бэкенд удаляет одного участника
        // за вызов (прецедент addUsers — Promise.all по user_id)
        await Promise.all(
            data.users.map(user_id =>
                http.delete(`/${data.chatId}/members/${user_id}`, { csrfToken: readCsrfToken() })
            )
        )
    },
    async leaveChat(chatId: number) {
        // собственный выход: архивирует членство (left_at), повтор —
        // идемпотентный 204; бэкенд закрывает наш сокет чата
        await http.post(`/${chatId}/leave`, { csrfToken: readCsrfToken() })
    },
    async rejoinChat(chatId: number) {
        // возврат в свой архивированный чат (2026-11-01-settings):
        // реактивирует собственное членство (left_at -> NULL); активное
        // членство — идемпотентный 204
        await http.post(`/${chatId}/rejoin`, { csrfToken: readCsrfToken() })
    },
    async getChatUsers(chatId: number) {
        const members = await (http.get(`/${chatId}/members`) as unknown as Promise<
            {
                id: number
                login: string
                display_name: string
                avatar_url?: string | null
                // архивное членство (покинул чат) — шапка гасит иконку
                left_at?: string | null
            }[]
        >)

        return members.map(member => ({
            id: member.id,
            login: member.login,
            display_name: member.display_name,
            email: member.login,
            first_name: member.display_name,
            second_name: '',
            phone: '',
            // реальный аватар участника, иначе pool-фолбэк
            avatar: member.avatar_url ?? avatarPoolUrl(member.id),
            left_at: member.left_at ?? null,
        }))
    },
    async changeChatAvatar(data: FormData) {
        // id чата UI кладёт в FormData полем chatId (кликнутая плитка —
        // не обязательно selectedChat); файловое поле называется avatar
        const chatId = data.get('chatId')
        const file = data.get('avatar')

        if (typeof chatId !== 'string' || chatId === '' || !(file instanceof File)) {
            throw new Error('Операция changeChatAvatar недоступна в own-режиме: форма не содержит chatId/avatar')
        }

        const payload = new FormData()

        payload.append('uploaded', file)
        payload.append('kind', 'chat')
        payload.append('chat_id', chatId)

        const response = await (new HTTPTransport('/files/avatars').post('', {
            data: payload,
            csrfToken: readCsrfToken(),
        }) as unknown as Promise<{ avatar_url: string | null }>)

        return { avatar: response.avatar_url ?? '' }
    },
    async searchUsers(data) {
        const users = await (usersHttp.get('', { data: { login: data.login } }) as unknown as Promise<OwnUserSearchResponse>)

        return users
    },
    async searchChats(query) {
        const response = await (http.get('/search', { data: { q: query } }) as unknown as Promise<{ query: string; results: OwnChatSearchResult[] }>)

        // порядок, cap и сниппеты уже серверные — отдаём как есть
        // (структурно ChatSearchMatch)
        return response.results
    },
    async setReaction(data) {
        const response = await (http.post(`/${data.chatId}/messages/${data.messageId}/reactions`, {
            data: { emoji: data.emoji },
            csrfToken: readCsrfToken(),
        }) as unknown as Promise<{ message_id: number; active: boolean; reactions: OwnReactionSummaryResponse[] }>)

        // сводка сервера уже viewer-relative (запросил вьюер) — прокидываем как есть
        const reactions: ReactionSummary[] = response.reactions.map(item => ({
            emoji: item.emoji,
            count: item.count,
            mine: item.mine,
        }))

        return {
            message_id: response.message_id,
            active: response.active,
            reactions,
        } satisfies ReactionToggleResult
    },

    async runBot(chatId: number, messageId: number) {
        // per-request timeout: thinking-модель с RAG отвечает дольше
        // дефолтных 30с HTTPTransport — ждём как бэкенд (300с), иначе
        // фронт отваливается по таймауту при живом прогоне
        return http.post(`/${chatId}/bot/runs`, { data: { message_id: messageId }, csrfToken: readCsrfToken(), timeout: 300_000 })
    },

    async fetchMessages(chatId: number, limit?: number): Promise<Message[]> {
        const query = limit !== undefined ? { limit: String(limit) } : undefined
        const response = await (http.get(`/${chatId}/messages`, query !== undefined ? { data: query } : undefined)) as {
            messages: Parameters<typeof toMessage>[0][]
        }

        // бэкенд отдаёт desc (курсорная страница) — лента растёт в asc
        return response.messages.map(toMessage).reverse()
    },
}