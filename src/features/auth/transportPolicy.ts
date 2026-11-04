// Реализация TransportPolicy фичей auth (2026-11-03-auth-refresh-retry):
// единый владелец оверлея (onRetryOverlay → busyOverlay), single-flight
// refresh поверх одноразовой ротации, окно недавно завершённого refresh-а
// против гонки ротации, быстрый отказ без csrf-cookie и локальный выход
// при неудачном refresh. Холодная загрузка /auth/me идёт через ту же
// механику — meWithRefresh удалён как мёртвый код.

import Router from '../../utils/Router.ts'
import { SIGNIN } from '../../utils/constants.ts'
import HTTPTransport, { type Options, type RetryOverlayKind, type TransportPolicy } from '../../utils/HTTPTransport.ts'
import { readCsrfToken } from '../../utils/csrf.ts'
import { hideBusyOverlay, showBusyOverlay } from '../../utils/busyOverlay.ts'
import { authPort } from './api/index.ts'
import { authSlice } from './store.ts'

export const SERVER_ERROR_RETRY_DELAYS_MS: readonly number[] = [2000, 6000, 12000]
const RECENTLY_REFRESHED_MS = 2000

export interface TransportPolicyDependencies {
    // eslint-disable-next-line no-unused-vars
    postRefresh: (csrfToken: string) => Promise<void>
    logout: () => Promise<void>
    goToSignIn: () => void
    now: () => number
}

const defaultDependencies: TransportPolicyDependencies = {
    postRefresh: async (csrfToken) => {
        await new HTTPTransport('/auth').post('/refresh', { csrfToken })
    },
    logout: async () => {
        await authPort.logout()
    },
    goToSignIn: () => {
        Router.go(SIGNIN)
    },
    now: () => Date.now(),
}

export function createAuthTransportPolicy(deps: TransportDependencies = defaultDependencies): TransportPolicy {
    let refreshInFlight: Promise<boolean> | null = null
    let lastRefreshSuccessAt = Number.NEGATIVE_INFINITY

    // Оверлей: показ отложен на макротаск и отменяется мгновенно закрывшейся
    // парой begin/end (быстрый отказ не мигает); каждый показ парен своим
    // скрытием — счётчик busyOverlay сходится в ноль
    let showTimer: ReturnType<typeof setTimeout> | null = null
    let pendingBegins = 0
    let shownPairs = 0
    let latestKind: RetryOverlayKind = 'unauthorized'

    const scheduleDeferredShow = (): void => {
        if (showTimer !== null) {
            return
        }

        showTimer = setTimeout(() => {
            showTimer = null

            while (pendingBegins > 0) {
                showBusyOverlay(latestKind === 'unauthorized' ? 'wait' : 'reconnect')
                shownPairs += 1
                pendingBegins -= 1
            }
        }, 0)
    }

    const kickOut = async (): Promise<void> => {
        authSlice.setUser(null)

        try {
            await deps.logout()
        } catch {
            // лучший-effort выход: куки уже мертвы — молча
        }

        deps.goToSignIn()
    }

    const doRefresh = async (): Promise<boolean> => {
        const csrfToken = readCsrfToken()

        if (csrfToken === '') {
            return false
        }

        try {
            await deps.postRefresh(csrfToken)
            lastRefreshSuccessAt = deps.now()

            return true
        } catch {
            await kickOut()

            return false
        }
    }

    return {
        onUnauthorized: async () => {
            // 401 сразу после завершённого refresh-а лечится повтором без
            // сети: вторая ротация старым cookie ответила бы rotated и
            // ошибочно выкинула пользователя
            if (deps.now() - lastRefreshSuccessAt < RECENTLY_REFRESHED_MS) {
                return true
            }

            if (refreshInFlight === null) {
                refreshInFlight = doRefresh().finally(() => {
                    refreshInFlight = null
                })
            }

            return refreshInFlight
        },
        onServerErrorDelay: (_url, attempt) => SERVER_ERROR_RETRY_DELAYS_MS[attempt] ?? null,
        onRetryOverlay: (phase, kind) => {
            if (phase === 'begin') {
                pendingBegins += 1
                latestKind = kind
                scheduleDeferredShow()

                return
            }

            if (pendingBegins > 0) {
                // пара закрылась до отложенного показа — показ этой пары
                // отменяется целиком (мгновенный отказ не мигает экраном)
                pendingBegins -= 1

                if (pendingBegins === 0 && showTimer !== null) {
                    clearTimeout(showTimer)
                    showTimer = null
                }

                return
            }

            if (shownPairs > 0) {
                hideBusyOverlay()
                shownPairs -= 1
            }
        },
        beforeUnauthorizedRetry: (options: Options) => {
            options.csrfToken = readCsrfToken()
        },
    }
}

type TransportDependencies = TransportPolicyDependencies

export function installAuthTransportPolicy(): void {
    HTTPTransport.setTransportPolicy(createAuthTransportPolicy())
}
