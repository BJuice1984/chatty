export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

// eslint-disable-next-line no-unused-vars
export type ThemeListener = (theme: Theme, resolvedTheme: ResolvedTheme) => void

const STORAGE_KEY = 'chatty-theme'
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

const themeListeners = new Set<ThemeListener>()

let currentTheme: Theme = 'system'
let systemQuery: MediaQueryList | null = null
let systemListener: (() => void) | null = null

function isTheme(value: string | null): value is Theme {
    return value === 'light' || value === 'dark' || value === 'system'
}

function readStoredTheme(): Theme {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY)

        if (isTheme(stored)) {
            return stored
        }
    } catch {
        return 'system'
    }

    return 'system'
}

function persistTheme(theme: Theme): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
        // приватный режим или переполненная квота: выбор живёт до перезагрузки
    }
}

function getSystemQuery(): MediaQueryList | null {
    if (typeof window.matchMedia !== 'function') {
        return null
    }

    return window.matchMedia(SYSTEM_DARK_QUERY)
}

function resolveTheme(theme: Theme): ResolvedTheme {
    if (theme !== 'system') {
        return theme
    }

    const query = getSystemQuery()

    if (query === null) {
        return 'light'
    }

    return query.matches ? 'dark' : 'light'
}

function notifyListeners(): void {
    const resolved = resolveTheme(currentTheme)

    for (const listener of themeListeners) {
        listener(currentTheme, resolved)
    }
}

function applyResolvedTheme(): void {
    if (resolveTheme(currentTheme) === 'dark') {
        document.documentElement.dataset.theme = 'dark'
    } else {
        document.documentElement.removeAttribute('data-theme')
    }

    notifyListeners()
}

function attachSystemListener(): void {
    const query = getSystemQuery()

    if (query === null) {
        return
    }

    const listener = (): void => {
        applyResolvedTheme()
    }

    query.addEventListener('change', listener)
    systemQuery = query
    systemListener = listener
}

function detachSystemListener(): void {
    if (systemQuery === null || systemListener === null) {
        return
    }

    systemQuery.removeEventListener('change', systemListener)
    systemQuery = null
    systemListener = null
}

export function getTheme(): Theme {
    return currentTheme
}

export function getResolvedTheme(): ResolvedTheme {
    return resolveTheme(currentTheme)
}

export function applyTheme(theme: Theme): void {
    currentTheme = theme
    detachSystemListener()

    if (theme === 'system') {
        attachSystemListener()
    }

    applyResolvedTheme()
}

export function setTheme(theme: Theme): void {
    persistTheme(theme)
    applyTheme(theme)
}

export function initTheme(): void {
    applyTheme(readStoredTheme())
}

export function onThemeChange(listener: ThemeListener): () => void {
    themeListeners.add(listener)

    return () => {
        themeListeners.delete(listener)
    }
}
