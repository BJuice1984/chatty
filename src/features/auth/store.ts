// Слайс состояния auth (stage 3): типы состояния живут во фиче, ядро от них не зависит.
// authError — человекочитаемая ошибка последнего запроса (сервер недоступен,
// отказ бэкенда): страницы входа/регистрации показывают её под формой.

import store from '../../utils/Store.ts'
import type { AuthUser } from './ports.ts'

export interface AuthSlice {
    getUser(): AuthUser | null
    // eslint-disable-next-line no-unused-vars
    setUser(user: AuthUser | null): void
    getAuthError(): string | null
    // eslint-disable-next-line no-unused-vars
    setAuthError(message: string | null): void
}

export const authSlice: AuthSlice = {
    getUser() {
        return store.getState().user ?? null
    },

    setUser(user) {
        store.set('user', user)
    },

    getAuthError() {
        return store.getState().authError ?? null
    },

    setAuthError(message) {
        store.set('authError', message)
    },
}
