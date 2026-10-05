// Слайс состояния auth (stage 3): типы состояния живут во фиче, ядро от них не зависит.

import store from '../../utils/Store.ts'
import type { AuthUser } from './ports.ts'

export interface AuthSlice {
    getUser(): AuthUser | null
    // eslint-disable-next-line no-unused-vars
    setUser(user: AuthUser | null): void
}

export const authSlice: AuthSlice = {
    getUser() {
        return store.getState().user ?? null
    },

    setUser(user) {
        store.set('user', user)
    },
}
