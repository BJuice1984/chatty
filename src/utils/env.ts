export interface EnvironmentInput {
    VITE_API_URL?: string
    VITE_WS_URL?: string
    VITE_FILES_URL?: string
    VITE_CSRF_HEADER_NAME?: string
    [key: string]: string | undefined
}

export interface AppEnvironment {
    apiUrl: string
    wsUrl: string
    filesUrl: string
    csrfHeaderName: string
}

const DEFAULT_CSRF_HEADER_NAME = 'X-CSRF-Token'

// Локальные дефолты собственного стека (compose-runbook из
// docs/deployment/own-backend.md): дают рабочие адреса dev-серверу и
// тестовому прогону, когда VITE_*-переменные не заданы. Внешний деплой
// обязан задавать их явно — молча ходить на чужой хост приложение не должно.
const OWN_DEFAULTS: Pick<AppEnvironment, 'apiUrl' | 'wsUrl' | 'filesUrl'> = {
    apiUrl: 'http://localhost:8000/api/v1',
    wsUrl: 'ws://localhost:8000/api/v1',
    filesUrl: 'http://localhost:8000/api/v1/files',
}

export class EnvironmentError extends Error {
    readonly code = 'ENV_CONFIGURATION_ERROR'

    constructor(message: string) {
        super(message)
        this.name = 'EnvironmentError'
    }
}

function getRuntimeEnvironment(): EnvironmentInput {
    return import.meta.env
}

function requiredValue(
    input: EnvironmentInput,
    key: keyof EnvironmentInput,
    fallback?: string
): string {
    const configuredValue = input[key]
    const trimmedValue = typeof configuredValue === 'string' ? configuredValue.trim() : ''
    const value = trimmedValue !== '' ? trimmedValue : fallback

    if (value === undefined || value === '') {
        throw new EnvironmentError(`Missing required environment value: ${key}`)
    }

    return value
}

function normalizeBaseUrl(value: string, key: string, protocols: string[]): string {
    let parsed: URL

    try {
        parsed = new URL(value)
    } catch {
        throw new EnvironmentError(`Invalid URL for ${key}: ${value}`)
    }

    if (!protocols.includes(parsed.protocol)) {
        throw new EnvironmentError(
            `Invalid protocol for ${key}: expected ${protocols.join(' or ')}`
        )
    }

    if (
        parsed.username !== '' ||
        parsed.password !== '' ||
        parsed.search !== '' ||
        parsed.hash !== ''
    ) {
        throw new EnvironmentError(`${key} must not contain credentials, query or hash`)
    }

    const pathname = parsed.pathname.replace(/\/+$/, '')

    return `${parsed.origin}${pathname}`
}

export function joinUrl(baseUrl: string, path: string): string {
    const base = normalizeBaseUrl(baseUrl, 'base URL', ['http:', 'https:', 'ws:', 'wss:'])
    const normalizedPath = path.trim()

    if (normalizedPath === '') {
        return base
    }

    if (/^[a-z][a-z\d+.-]*:/i.test(normalizedPath)) {
        throw new EnvironmentError('URL path must be relative to the configured base URL')
    }

    const pathSegments = normalizedPath.split(/[/?#]/)

    if (pathSegments.includes('..')) {
        throw new EnvironmentError('URL path must not traverse above the configured base URL')
    }

    const relativePath = normalizedPath.replace(/^\/+/, '')

    return new URL(relativePath, `${base}/`).toString()
}

export function readEnv(input: EnvironmentInput = {}): AppEnvironment {
    const apiUrl = requiredValue(input, 'VITE_API_URL', OWN_DEFAULTS.apiUrl)
    const wsUrl = requiredValue(input, 'VITE_WS_URL', OWN_DEFAULTS.wsUrl)
    const filesUrl = requiredValue(input, 'VITE_FILES_URL', OWN_DEFAULTS.filesUrl)
    const csrfHeaderName = requiredValue(
        input,
        'VITE_CSRF_HEADER_NAME',
        DEFAULT_CSRF_HEADER_NAME
    )

    if (!/^[a-z][a-z0-9-]*$/i.test(csrfHeaderName)) {
        throw new EnvironmentError('Invalid CSRF header name')
    }

    return {
        apiUrl: normalizeBaseUrl(apiUrl, 'VITE_API_URL', ['http:', 'https:']),
        wsUrl: normalizeBaseUrl(wsUrl, 'VITE_WS_URL', ['ws:', 'wss:']),
        filesUrl: normalizeBaseUrl(filesUrl, 'VITE_FILES_URL', ['http:', 'https:']),
        csrfHeaderName,
    }
}

export const env = readEnv(getRuntimeEnvironment())

export function fileUrl(path: string, configuration?: AppEnvironment): string {
    if (path.trim() === '') {
        return ''
    }

    return joinUrl((configuration ?? env).filesUrl, path)
}
