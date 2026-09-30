export type AppMode = 'practicum' | 'own'

export interface EnvironmentInput {
    MODE?: string
    VITE_APP_MODE?: string
    VITE_API_URL?: string
    VITE_WS_URL?: string
    VITE_FILES_URL?: string
    VITE_CSRF_HEADER_NAME?: string
    [key: string]: string | undefined
}

export interface AppEnvironment {
    mode: AppMode
    apiUrl: string
    wsUrl: string
    filesUrl: string
    csrfHeaderName: string
}

interface ReadEnvOptions {
    usePracticumDefaults?: boolean
}

const DEFAULT_CSRF_HEADER_NAME = 'X-CSRF-Token'

const PRACTICUM_DEFAULTS: Pick<AppEnvironment, 'apiUrl' | 'wsUrl' | 'filesUrl'> = {
    apiUrl: 'https://ya-praktikum.tech/api/v2',
    wsUrl: 'wss://ya-praktikum.tech',
    filesUrl: 'https://ya-praktikum.tech/api/v2/resources',
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

function resolveConfiguredMode(input: EnvironmentInput): string {
    return (input.VITE_APP_MODE ?? input.MODE ?? 'development').trim().toLowerCase()
}

export function resolveMode(input: EnvironmentInput = {}): AppMode {
    const configuredMode = resolveConfiguredMode(input)

    if (configuredMode === 'own') {
        return 'own'
    }

    if (
        configuredMode === 'practicum' ||
        configuredMode === 'development' ||
        configuredMode === 'production'
    ) {
        return 'practicum'
    }

    throw new EnvironmentError(
        `Unsupported application mode "${configuredMode}". Use "practicum" or "own".`
    )
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

export function readEnv(
    input: EnvironmentInput = {},
    options: ReadEnvOptions = {}
): AppEnvironment {
    const mode = resolveMode(input)
    const defaults =
        mode === 'practicum' && options.usePracticumDefaults === true
            ? PRACTICUM_DEFAULTS
            : undefined
    const apiUrl = requiredValue(input, 'VITE_API_URL', defaults?.apiUrl)
    const wsUrl = requiredValue(input, 'VITE_WS_URL', defaults?.wsUrl)
    const filesUrl = requiredValue(input, 'VITE_FILES_URL', defaults?.filesUrl)
    const csrfHeaderName = requiredValue(
        input,
        'VITE_CSRF_HEADER_NAME',
        DEFAULT_CSRF_HEADER_NAME
    )

    if (!/^[a-z][a-z0-9-]*$/i.test(csrfHeaderName)) {
        throw new EnvironmentError('Invalid CSRF header name')
    }

    return {
        mode,
        apiUrl: normalizeBaseUrl(apiUrl, 'VITE_API_URL', ['http:', 'https:']),
        wsUrl: normalizeBaseUrl(wsUrl, 'VITE_WS_URL', ['ws:', 'wss:']),
        filesUrl: normalizeBaseUrl(filesUrl, 'VITE_FILES_URL', ['http:', 'https:']),
        csrfHeaderName,
    }
}

export const env = readEnv(getRuntimeEnvironment(), { usePracticumDefaults: true })

export function fileUrl(path: string, configuration?: AppEnvironment): string {
    if (path.trim() === '') {
        return ''
    }

    return joinUrl((configuration ?? env).filesUrl, path)
}

export function chatWebSocketUrl(
    userId: number,
    chatId: number,
    token: string,
    configuration?: AppEnvironment
): string {
    if (
        !Number.isInteger(userId) ||
        !Number.isInteger(chatId) ||
        token.trim() === ''
    ) {
        throw new EnvironmentError('User, chat and token are required for a chat WebSocket URL')
    }

    const path = [userId, chatId, token]
        .map(value => encodeURIComponent(String(value)))
        .join('/')

    return joinUrl((configuration ?? env).wsUrl, `/ws/chats/${path}`)
}
