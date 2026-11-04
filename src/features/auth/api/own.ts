// Адаптер порта auth на собственном бэкенде: контракт
// (/auth/register, /auth/login, /auth/refresh, /auth/logout, /auth/me).
// Cookie-аутентификация (withCredentials в HTTPTransport) + CSRF double-submit
// (cookie chatty_csrf → заголовок env.csrfHeaderName) на refresh/logout.
// 401 на /auth/me лечится ГЛОБАЛЬНОЙ политикой транспорта
// (features/auth/transportPolicy.ts) — локальный refresh-хук удалён.
//
// Маппинг креденциалов: бэкенд требует email (с '@') и пароль ≥ 12; поле login
// формы входа маппится в email. UserResponse несёт id/email/role/is_active/
// created_at + профильные поля (2026-11-01-settings, аддитивно): display_name
// и phone — РЕАЛЬНЫЕ значения (NULL → фолбэки «локальная часть email»/'' —
// синтез display_name=email убран: он затирал бы правки имени в /settings);
// send_read_receipts отсутствует на старых ответах → true. Аватар —
// детерминированный из пула статики (бэкенд аватары пользователей не
// хранит, см. utils/avatarPool.ts).

import HTTPTransport from '../../../utils/HTTPTransport.ts'
import { readCsrfToken } from '../../../utils/csrf.ts'
import { avatarPoolUrl } from '../../../utils/avatarPool.ts'
import type { AuthPort, AuthUser, SignInRequest, SignUpRequest } from '../ports.ts'

export interface OwnUserResponse {
    id: number
    email: string
    role: string
    is_active: boolean
    created_at: string
    // файловый путь ("{file_id}/download") или null, когда аватара нет
    avatar_url?: string | null
    // настройки профиля (2026-11-01-settings, аддитивно): NULL — «не задано»,
    // флаг отсутствует на ответах до волны настроек
    display_name?: string | null
    phone?: string | null
    send_read_receipts?: boolean
}

const http = new HTTPTransport('/auth')

// Локальная часть email — фолбэк выводимого имени: зеркалит серверные
// name-builders (NULL display_name везде показывается как локальная часть)
function emailLocalPart(email: string): string {
    const localPart = email.split('@')[0]

    return localPart === '' ? email : localPart
}

export function toAuthUser(response: OwnUserResponse): AuthUser {
    return {
        id: response.id,
        login: response.email,
        email: response.email,
        first_name: '',
        second_name: '',
        // РЕАЛЬНОЕ имя с бэкенда, NULL — локальная часть email
        display_name: response.display_name ?? emailLocalPart(response.email),
        phone: response.phone ?? '',
        send_read_receipts: response.send_read_receipts ?? true,
        // реальный аватар с бэкенда, иначе детерминированный из пула статики
        avatar: response.avatar_url ?? avatarPoolUrl(response.id),
    }
}

// Тело запроса login: SignInRequest.login → email бэкенда
export function toLoginBody(data: SignInRequest): { email: string; password: string } {
    return { email: data.login, password: data.password }
}

// Тело запроса register: Credentials бэкенда — только email и password (≥ 12);
// confirm_password — клиентская проверка формы, в запрос не входит
export function toRegisterBody(data: SignUpRequest): { email: string; password: string } {
    return { email: data.email, password: data.password }
}

export const ownAuthPort: AuthPort = {
    async signin(data) {
        await http.post('/login', { data: toLoginBody(data) })
    },
    async signup(data: SignUpRequest) {
        // Credentials бэкенда: email + password (≥ 12)
        await http.post('/register', { data: toRegisterBody(data) })
    },
    // 401 на /auth/me перехватывает глобальная политика транспорта: refresh
    // и повтор запроса происходят в HTTPTransport, маппинг — здесь.
    // Ответ типизируется явной аннотацией: транспортный Promise<never>
    // присваивается всему без предупреждений (review N-3 плана)
    async me() {
        const response: OwnUserResponse = await http.get('/me')

        return toAuthUser(response)
    },
    async logout() {
        await http.post('/logout', { csrfToken: readCsrfToken() })
    },
}
