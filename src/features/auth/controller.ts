// Фича-контроллер auth (stage 3): бизнес-логика за портом. Реализация порта
// по умолчанию — own-адаптер из ./api/index.ts.
// Ошибки запросов не остаются только в console: контроллер кладёт
// человекочитаемое сообщение в authError стора, страницы входа/регистрации
// показывают его под формой (недоступный бэкенд раньше выглядел как
// «кнопка не работает»).

import Router from '../../utils/Router.ts'
import { MESSENGER, PROFILE, SIGNIN } from '../../utils/constants.ts'
import { TransportError } from '../../utils/HTTPTransport.ts'
import store from '../../utils/Store.ts'
import { authPort } from './api/index.ts'
import type { AuthPort, SignInRequest, SignUpRequest } from './ports.ts'
import { authSlice } from './store.ts'

// Сеансный teardown-шов (backlog NEXT.md п.2/п.10, 2026-11-09): при выходе
// нужно гасить WS-сокеты чатов и stories, но фичи не импортируют друг друга
// напрямую (guard: только через порты/композицию). Узор chatSearchOpener:
// фича выставляет регистрацию, композиционный корень (main.ts) injects
// реализацию — он единственный, кому разрешено знать обе стороны.
type SessionTeardown = () => void

let sessionTeardown: SessionTeardown = () => {}

export function registerSessionTeardown(fn: SessionTeardown): void {
    sessionTeardown = fn
}

export const AUTH_NETWORK_ERROR_MESSAGE = 'Нет связи с сервером. Проверьте подключение и попробуйте позже'

// HTTP-статусы форм входа/регистрации → человекочитаемый текст: detail
// own-бэкенда — машинный код ('invalid_credentials'), показывать его
// пользователю нельзя. Незнакомый статус остаётся с message бэкенда
// (getHttpErrorMessage уже вытащил reason/detail)
const AUTH_HTTP_ERROR_TEXTS: Record<number, string> = {
    401: 'Неверный email или пароль',
    409: 'Этот email уже зарегистрирован',
    422: 'Проверьте поля: email — корректный адрес, пароль — минимум 12 символов',
}

// Человекочитаемое сообщение для формы: сетевые сбои (сервер не поднят,
// CORS) — свой текст; известные HTTP-статусы — текст из карты выше;
// прочие HTTP-ошибки — message от бэкенда; остальное — нейтральный fallback
function authErrorMessage(error: unknown): string {
    if (error instanceof TransportError) {
        if (error.kind === 'network') {
            return AUTH_NETWORK_ERROR_MESSAGE
        }

        if (error.kind === 'timeout') {
            return 'Сервер не отвечает. Попробуйте ещё раз позже'
        }

        if (error.kind === 'http') {
            return (error.status !== undefined ? AUTH_HTTP_ERROR_TEXTS[error.status] : undefined) ?? error.message
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
        authSlice.setAuthLoading(true)

        try {
            // Пробелы по краям логина/email от копипаста не попадают в запрос
            await this.port.signin({ ...data, login: data.login.trim() })
            await this.fetchUser()
            Router.go(MESSENGER)
        } catch (e: unknown) {
            console.error('Ошибка при входе в систему:', e)
            authSlice.setAuthError(authErrorMessage(e))
        } finally {
            authSlice.setAuthLoading(false)
        }
    }

    async signup(data: SignUpRequest): Promise<void> {
        authSlice.setAuthError(null)
        authSlice.setAuthLoading(true)

        try {
            await this.port.signup(data)
            await this.fetchUser()
            Router.go(PROFILE)
        } catch (e: unknown) {
            console.error('Ошибка при регистрации:', e)
            authSlice.setAuthError(authErrorMessage(e))
        } finally {
            authSlice.setAuthLoading(false)
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
        } catch (e: unknown) {
            console.error('Ошибка при выходе из системы:', e)
        } finally {
            // отказ сервера не оставляет чужие данные на экране: локальная
            // сессия завершается в любом исходе (приватность п.2 важнее
            // строгости серверного logout — куки перевыпустит следующий логин)
            this.resetSession()
        }
    }

    // Локальный выход без серверного запроса (2026-11-07): /auth/logout-all
    // сам снимает ВСЕ куки (csrf в том числе) и бампает token_version —
    // следующий за ним POST /auth/logout едет уже с пустым csrf и падает
    // 403 csrf_failed, оставляя юзера на странице настроек
    localSignOut(): void {
        this.resetSession()
    }

    // Единое завершение локальной сессии (backlog п.2/п.10, 2026-11-09):
    // полный сброс стора + гарантированное закрытие WS-сокетов через шов.
    // Раньше выход сбрасывал только user: selectedChat, messages, chats,
    // chatUsers, stories и контакты переживали смену аккаунта — лента
    // первого пользователя была видна следующему, а мёртвый чат-сокет
    // ломал эхо и запуск бота после ре-логина. Сокеты гасим ДО reset:
    // их обработчики ещё живы и не должны реагировать на уже пустой стор.
    private resetSession(): void {
        sessionTeardown()
        store.reset()
        Router.go(SIGNIN)
    }
}

export default new AuthFeatureController()
