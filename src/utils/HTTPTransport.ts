import { type AppEnvironment, env, joinUrl } from './env.ts'

const METHODS = {
    GET: 'GET',
    PUT: 'PUT',
    POST: 'POST',
    DELETE: 'DELETE',
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
    protected endpoint: string
    private readonly configuration: AppEnvironment

    constructor(endpoint: string, configuration?: AppEnvironment) {
        this.configuration = configuration ?? {
            ...env,
            apiUrl: HTTPTransport.baseURL !== '' ? HTTPTransport.baseURL : HTTPTransport.API_URL,
        }
        this.endpoint = joinUrl(this.configuration.apiUrl, endpoint)
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

    private request: HTTPMethod = (url, options = { method: METHODS.GET }) => {
        const { method, data } = options

        return new Promise((resolve, reject) => {
            if (method == null) {
                reject(new TransportError('No method specified', 'configuration'))

                return
            }

            const xhr = new XMLHttpRequest()

            xhr.open(method, url)

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
            xhr.timeout = options.timeout ?? 0

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
}
