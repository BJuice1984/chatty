// Слайс состояния profile (stage 4): типы живут во фиче, ядро от них не зависит.

import store from '../../utils/Store.ts'
import type { ProfileUser } from './ports.ts'

export interface ProfileSlice {
    getUser(): ProfileUser | null
    // eslint-disable-next-line no-unused-vars
    setUser(user: ProfileUser | null): void
}

export const profileSlice: ProfileSlice = {
    getUser() {
        return store.getState().user ?? null
    },

    setUser(user) {
        store.set('user', user)
    },
}
