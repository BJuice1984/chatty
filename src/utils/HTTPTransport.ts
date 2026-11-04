import { type AppEnvironment, env, joinUrl } from './env.ts'

const METHODS = {
    GET: 'GET',
    PUT: 'PUT',
    POST: 'POST',
    DELETE: 'DELETE',
}

// Повтор при 5xx: политика владеет лестницей задержек, транспорт лишь
// ограничивает бюджет повторов на один запрос (защита от кривой политики)
const MAX_SERVER_ERROR_RETRIES = 3

// Эндпоинты, чей 401/403 семантичен сам по себе (логин/регистрация) или
// рекурсивен (refresh) — их перехват политикой запрещён
const EXCLUDED_AUTH_URL_SUFFIXES = [
    '/auth/refresh',
    '/auth/login',
    '/auth/register',
    '/auth/logout',
    '/auth/logout-all',
]

function isExcludedAuthUrl(url: string): boolean {
    return EXCLUDED_AUTH_URL_SUFFIXES.some(suffix => url.endsWith(suffix))
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms)
    })
}

export interface Options {
    headers?: { [key: string]: string }
    method?: string
    timeout?: number
    data?: Record<string, unknown> | FormData
    csrfToken?: string
}

// eslint-disable-next-line no-unused-vars
type HTTPMethod = (url: string, options?: Options) => Promise<never>

export type TransportErrorKind = 'configuration' | 'http' | 'network' | 'aborted' | 'timeout'

export type RetryOverlayKind = 'unauthorized' | 'server-error'

// Инъектируемая политика повторов (2026-11-03-auth-refresh-retry): транспорт
// знает только интерфейс; реализация живёт в фиче auth (single-flight refresh,
// лестница 5xx-задержек, затемнение экрана), связка — в features/index.ts.
export interface TransportPolicy {
    // true — токен обновлён, повторить исходный запрос один раз
    // eslint-disable-next-line no-unused-vars
    onUnauthorized?: (url: string) => Promise<boolean>
    // пауза в мс перед следующим повтором при 5xx; null — повторов больше нет
    // eslint-disable-next-line no-unused-vars
    onServerErrorDelay?: (url: string, attempt: number) => number | null
    // сбалансированная пара на каждую фазу перехвата (401-фаза, 5xx-фаза)
    // eslint-disable-next-line no-unused-vars
    onRetryOverlay?: (phase: 'begin' | 'end', kind: RetryOverlayKind) => void
    // шанс обновить options перед повтором (свежий csrf после ротации)
    // eslint-disable-next-line no-unused-vars
    beforeUnauthorizedRetry?: (options: Options) => void
}

export class TransportError extends Error {
    readonly kind: TransportErrorKind
    readonly status?: number
    readonly details?: unknown

    constructor(
        message: string,
        kind: TransportErrorKind,
        status?: number,
        details?: unknown
    ) {
        super(message)
        this.name = 'TransportError'
        this.kind = kind
        this.status = status
        this.details = details
    }
}

function queryStringify(data: Options['data']): string {
    if (data === undefined) {
        return ''
    }

    const queryString = Object.entries(data)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&')

    return `?${queryString}`
}

function getHttpErrorMessage(response: unknown, status: number): string {
    if (typeof response === 'string' && response.trim() !== '') {
        return response
    }

    if (response !== null && typeof response === 'object') {
        const payload = response as Record<string, unknown>
        const message = payload.message ?? payload.reason ?? payload.detail ?? payload.error

        if (typeof message === 'string' && message.trim() !== '') {
            return message
        }
    }

    return `Запрос не выполнен. Статус: ${status}`
}

export default class HTTPTransport {
    static API_URL = env.apiUrl
    static baseURL = env.apiUrl
    private static transportPolicy: TransportPolicy | null = null
    protected endpoint: string
    private readonly configuration: AppEnvironment

    constructor(endpoint: string, configuration?: AppEnvironment) {
        this.configuration = configuration ?? {
            ...env,
            apiUrl: HTTPTransport.baseURL !== '' ? HTTPTransport.baseURL : HTTPTransport.API_URL,
        }
        this.endpoint = joinUrl(this.configuration.apiUrl, endpoint)
    }

    static setTransportPolicy(policy: TransportPolicy | null): void {
        HTTPTransport.transportPolicy = policy
    }

    public get: HTTPMethod = (url, options = {}) => {
        const queryString = queryStringify(options.data)
        const fullUrl = `${joinUrl(this.endpoint, url)}${queryString}`

        return this.request(fullUrl, { ...options, method: METHODS.GET })
    }

    public put: HTTPMethod = (url, options = {}) => {
        const fullUrl = joinUrl(this.endpoint, url)

        return this.request(fullUrl, { ...options, method: METHODS.PUT })
    }

    public post: HTTPMethod = (url, options = {}) => {
        const fullUrl = joinUrl(this.endpoint, url)

        return this.request(fullUrl, { ...options, method: METHODS.POST })
    }

    public delete: HTTPMethod = (url, options = {}) => {
        const fullUrl = joinUrl(this.endpoint, url)

        return this.request(fullUrl, { ...options, method: METHODS.DELETE })
    }

    private send: HTTPMethod = (url, options = { method: METHODS.GET }) => {
        const { method, data } = options

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest()

            xhr.open(method as string, url)

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.response as never)
                } else {
                    reject(
                        new TransportError(
                            getHttpErrorMessage(xhr.response, xhr.status),
                            'http',
                            xhr.status,
                            xhr.response
                        )
                    )
                }
            }

            xhr.onabort = () => {
                reject(new TransportError('Запрос прерван', 'aborted'))
            }

            xhr.onerror = () => {
                reject(new TransportError('Ошибка сети. Запрос не выполнен', 'network'))
            }

            xhr.ontimeout = () => {
                reject(new TransportError('Время ожидания запроса истекло', 'timeout'))
            }

            xhr.withCredentials = true
            xhr.responseType = 'json'
            // RV5: дефолтный таймаут 30с — раньше 0 («вечно») подвешивал
            // запросы при пропавшей сети. Per-request override сохранён:
            // тяжёлые multipart-загрузки передают options.timeout больше
            // (FormData-файлы могут легитимно ехать дольше 30 секунд).
            xhr.timeout = options.timeout ?? 30000

            Object.entries(options.headers ?? {}).forEach(([header, value]) => {
                xhr.setRequestHeader(header, value)
            })

            if (
                method !== METHODS.GET &&
                options.csrfToken !== undefined &&
                options.csrfToken !== ''
            ) {
                xhr.setRequestHeader(this.configuration.csrfHeaderName, options.csrfToken)
            }

            if (method === METHODS.GET || data === undefined) {
                xhr.send()
            } else if (data instanceof FormData) {
                // xhr.setRequestHeader('Content-Type', 'multipart/form-data')
                xhr.send(data)
            } else {
                xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8')
                xhr.send(JSON.stringify(data))
            }
        })
    }

    private request: HTTPMethod = async (url, options = { method: METHODS.GET }) => {
        const method = options.method

        if (method == null) {
            throw new TransportError('No method specified', 'configuration')
        }

        const policy = HTTPTransport.transportPolicy

        if (policy == null || isExcludedAuthUrl(url)) {
            return this.send(url, options)
        }

        let unauthorizedRetried = false
        let unauthorizedError: TransportError | null = null
        let serverErrorRetries = 0
        let serverOverlayOpen = false

        const closeServerOverlay = (): void => {
            if (serverOverlayOpen) {
                serverOverlayOpen = false
                policy.onRetryOverlay?.('end', 'server-error')
            }
        }

        for (;;) {
            try {
                const response = await this.send(url, options)

                closeServerOverlay()

                return response
            } catch (error) {
                if (!(error instanceof TransportError) || error.kind !== 'http') {
                    closeServerOverlay()

                    throw error
                }

                const status = error.status ?? 0

                // 401-фаза: одна сбалансированная пара оверлея вокруг refresh
                if (status === 401 && !unauthorizedRetried && policy.onUnauthorized != null) {
                    unauthorizedRetried = true
                    unauthorizedError = error
                    policy.onRetryOverlay?.('begin', 'unauthorized')

                    let refreshed = false

                    try {
                        refreshed = await policy.onUnauthorized(url)
                    } catch {
                        // падение хука трактуется как неудачный refresh
                    } finally {
                        policy.onRetryOverlay?.('end', 'unauthorized')
                    }

                    if (refreshed) {
                        policy.beforeUnauthorizedRetry?.(options)

                        continue
                    }

                    // открытая 5xx-фаза закрывается и на этом терминальном пути
                    closeServerOverlay()

                    throw unauthorizedError
                }

                // 5xx-фаза: begin при первом готовящемся повторе, end при
                // выходе из фазы (успех повтора / null-задержка / бюджет)
                if (status >= 500 && status <= 599 && serverErrorRetries < MAX_SERVER_ERROR_RETRIES) {
                    const delay = policy.onServerErrorDelay?.(url, serverErrorRetries) ?? null

                    if (delay != null) {
                        if (!serverOverlayOpen) {
                            serverOverlayOpen = true
                            policy.onRetryOverlay?.('begin', 'server-error')
                        }

                        serverErrorRetries += 1

                        await sleep(delay)

                        continue
                    }
                }

                closeServerOverlay()

                // повторный 401 после лечения отвергается ИСХОДНОЙ ошибкой
                // первого 401; прочие терминальные статусы идут как есть
                if (status === 401 && unauthorizedError != null) {
                    throw unauthorizedError
                }

                throw error
            }
        }
    }
}
