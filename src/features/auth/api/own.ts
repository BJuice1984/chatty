// Own-адаптер порта auth (stage 7): контракт собственного бэкенда
// (/auth/register, /auth/login, /auth/refresh, /auth/logout, /auth/me).
// Cookie-аутентификация (withCredentials в HTTPTransport) + CSRF double-submit
// (cookie chatty_csrf → заголовок env.csrfHeaderName) на refresh/logout.
// /auth/me при 401 делает refresh и повторяет запрос один раз.
//
// Маппинг креденциалов: бэкенд требует email (с '@') и пароль ≥ 12; поле login
// формы маппится в email. UserResponse несёт только id/email/role/is_active/
// created_at — недостающие поля AuthUser заполняются пустыми значениями
// (login=display_name=email). Валидаторы форм остаются калиброванными под
// Практикум — own-смоук гоняется напрямую через порты (см. план stage 7).

import HTTPTransport, { TransportError } from '../../../utils/HTTPTransport.ts'
import { readCsrfToken } from '../../../utils/csrf.ts'
import type { AuthPort, AuthUser, SignInRequest, SignUpRequest } from '../ports.ts'

export interface OwnUserResponse {
    id: number
    email: string
    role: string
    is_active: boolean
    created_at: string
}

const http = new HTTPTransport('/auth')

export function toAuthUser(response: OwnUserResponse): AuthUser {
    return {
        id: response.id,
        login: response.email,
        email: response.email,
        first_name: '',
        second_name: '',
        display_name: response.email,
        phone: '',
        avatar: '',
    }
}

// Тело запроса login: SignInRequest.login → email бэкенда
export function toLoginBody(data: SignInRequest): { email: string; password: string } {
    return { email: data.login, password: data.password }
}

// Тело запроса register: контракт бэкенда — только email и password (≥ 12)
export function toRegisterBody(data: SignUpRequest): { email: string; password: string } {
    return { email: data.email, password: data.password }
}

async function meWithRefresh(): Promise<AuthUser> {
    try {
        return toAuthUser(await (http.get('/me')))
    } catch (e: unknown) {
        if (e instanceof TransportError && e.status === 401) {
            // refresh сам возвращает свежий UserResponse — повторный /auth/me не нужен
            const refreshed = await (http.post('/refresh', { csrfToken: readCsrfToken() }) as unknown as Promise<OwnUserResponse>)

            return toAuthUser(refreshed)
        }

        throw e
    }
}

export const ownAuthPort: AuthPort = {
    async signin(data) {
        await http.post('/login', { data: toLoginBody(data) })
    },
    async signup(data: SignUpRequest) {
        // Credentials бэкенда: email + password (≥ 12); остальные поля формы Практикума не входят в контракт
        await http.post('/register', { data: toRegisterBody(data) })
    },
    me: meWithRefresh,
    async logout() {
        await http.post('/logout', { csrfToken: readCsrfToken() })
    },
}
