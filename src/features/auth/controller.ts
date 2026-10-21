// Фича-контроллер auth (stage 3): бизнес-логика за портом. Реализация порта
// по умолчанию — own-адаптер из ./api/index.ts.
// Ошибки запросов не остаются только в console: контроллер кладёт
// человекочитаемое сообщение в authError стора, страницы входа/регистрации
// показывают его под формой (недоступный бэкенд раньше выглядел как
// «кнопка не работает»).

import Router from '../../utils/Router.ts'
import { MESSENGER, PROFILE, SIGNIN } from '../../utils/constants.ts'
import { TransportError } from '../../utils/HTTPTransport.ts'
import { authPort } from './api/index.ts'
import type { AuthPort, SignInRequest, SignUpRequest } from './ports.ts'
import { authSlice } from './store.ts'

export const AUTH_NETWORK_ERROR_MESSAGE = 'Нет связи с сервером. Проверьте подключение и попробуйте позже'

// Человекочитаемое сообщение для формы: сетевые сбои (сервер не поднят,
// CORS) — свой текст; HTTP-ошибки — message от бэкенда (getHttpErrorMessage
// уже вытащил reason/detail); прочее — нейтральный fallback
function authErrorMessage(error: unknown): string {
    if (error instanceof TransportError) {
        if (error.kind === 'network') {
            return AUTH_NETWORK_ERROR_MESSAGE
        }

        if (error.kind === 'timeout') {
            return 'Сервер не отвечает. Попробуйте ещё раз позже'
        }

        if (error.kind === 'http') {
            return error.message
        }
    }

    return 'Не удалось выполнить запрос. Попробуйте ещё раз'
}

// Сетевой/серверный сбой /auth/me юзер должен увидеть на странице входа —
// гард молча уводит туда по null-пользователю; 401 — легитимная
// «не авторизован», ошибки не несёт
function isServerUnavailable(error: unknown): boolean {
    return (
        error instanceof TransportError &&
        (error.kind === 'network' ||
            error.kind === 'timeout' ||
            (error.kind === 'http' && error.status !== undefined && error.status >= 500))
    )
}

export class AuthFeatureController {
    private readonly port: AuthPort

    constructor(port: AuthPort = authPort) {
        this.port = port
    }

    async signin(data: SignInRequest): Promise<void> {
        authSlice.setAuthError(null)

        try {
            // Пробелы по краям логина/email от копипаста не попадают в запрос
            await this.port.signin({ ...data, login: data.login.trim() })
            await this.fetchUser()
            Router.go(MESSENGER)
        } catch (e: unknown) {
            console.error('Ошибка при входе в систему:', e)
            authSlice.setAuthError(authErrorMessage(e))
        }
    }

    async signup(data: SignUpRequest): Promise<void> {
        authSlice.setAuthError(null)

        try {
            await this.port.signup(data)
            await this.fetchUser()
            Router.go(PROFILE)
        } catch (e: unknown) {
            console.error('Ошибка при регистрации:', e)
            authSlice.setAuthError(authErrorMessage(e))
        }
    }

    async fetchUser(): Promise<void> {
        try {
            const user = await this.port.me()

            authSlice.setUser(user)
        } catch (e: unknown) {
            console.error('Ошибка при получении информации о пользователе:', e)
            authSlice.setUser(null)

            if (isServerUnavailable(e)) {
                authSlice.setAuthError(authErrorMessage(e))
            }
        }
    }

    async logout(): Promise<void> {
        try {
            await this.port.logout()
            authSlice.setUser(null)
            Router.go(SIGNIN)
        } catch (e: unknown) {
            console.error('Ошибка при выходе из системы:', e)
        }
    }
}

export default new AuthFeatureController()
