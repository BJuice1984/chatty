// Роут-гард аутентификации (stage 3): centralized auth-check для Router.beforeEach.
// Подключение к живому роутеру — при композиции приложения (stage 4), здесь — контракт и установка.

import Router from '../../utils/Router.ts'
import { SIGNIN, SIGNUP } from '../../utils/constants.ts'
import { authSlice } from './store.ts'

const PUBLIC_PATHS = new Set([SIGNIN, SIGNUP])

// Гард для Router.beforeEach: публичные пути пропускает,
// защищённые — только при наличии пользователя, иначе редирект на страницу входа.
export function requireAuth(to: string): boolean | string {
    if (PUBLIC_PATHS.has(to)) {
        return true
    }

    return authSlice.getUser() !== null ? true : SIGNIN
}

// Устанавливает гард на роутер и возвращает отписку.
export function installAuthGuard(): () => void {
    return Router.beforeEach(requireAuth)
}
