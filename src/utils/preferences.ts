// Персональные настройки зрителя (2026-11-01-settings): звук входящих,
// браузерные уведомления и автозагрузка вложений. Хранение — ОДИН JSON-блоб
// в localStorage (ключ chatty-preferences): атомарное чтение/запись всех
// значений разом; тема оформления живёт отдельно в utils/theme.ts (ключ
// chatty-theme) и сюда не входит. Хранилище может отказывать (приватный
// режим, квота) — чтение и запись молча деградируют: значения живут в
// памяти до перезагрузки, чтение возвращает дефолты.

export interface Preferences {
    sound: boolean
    browserNotifications: boolean
    autoDownload: boolean
}

// eslint-disable-next-line no-unused-vars
export type PreferencesListener = (preferences: Preferences) => void

// 'unsupported' — API Notification отсутствует (jsdom/старые сборки):
// UI по этому значению прячет запрос разрешения
export type NotificationPermissionState = NotificationPermission | 'unsupported'

const STORAGE_KEY = 'chatty-preferences'

// Дефолты: звук и автозагрузка включены, браузерные уведомления выключены —
// до явного разрешения пользователя их включать нельзя
const DEFAULT_PREFERENCES: Preferences = {
    sound: true,
    browserNotifications: false,
    autoDownload: true,
}

const listeners = new Set<PreferencesListener>()

// Текущие значения: стартуют с дефолтов и перечитываются из хранилища при
// загрузке модуля (initPreferences внизу файла) — импортёры получают готовое
// состояние без явного init в main.ts
let preferences: Preferences = { ...DEFAULT_PREFERENCES }

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback
}

// Читает блоб: битый JSON, не-объект или поля не-boolean молча заменяются
// дефолтами ПО ПОЛЮ — неизвестное содержимое хранилища не должно ронять UI
function readStoredPreferences(): Preferences {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)

        if (raw === null) {
            return { ...DEFAULT_PREFERENCES }
        }

        const parsed: unknown = JSON.parse(raw)

        if (typeof parsed !== 'object' || parsed === null) {
            return { ...DEFAULT_PREFERENCES }
        }

        const stored = parsed as Record<string, unknown>

        return {
            sound: readBoolean(stored.sound, DEFAULT_PREFERENCES.sound),
            browserNotifications: readBoolean(stored.browserNotifications, DEFAULT_PREFERENCES.browserNotifications),
            autoDownload: readBoolean(stored.autoDownload, DEFAULT_PREFERENCES.autoDownload),
        }
    } catch {
        return { ...DEFAULT_PREFERENCES }
    }
}

function persistPreferences(): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
    } catch {
        // приватный режим или переполненная квота: значения живут до перезагрузки
    }
}

function notifyListeners(): void {
    for (const listener of [...listeners]) {
        listener({ ...preferences })
    }
}

// Перечитывает хранилище (загрузка модуля, тесты, синхронизация между вкладками)
export function initPreferences(): void {
    preferences = readStoredPreferences()
}

// Копия: потребитель не может мутировать внутреннее состояние модуля
export function getPreferences(): Preferences {
    return { ...preferences }
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    preferences = { ...preferences, [key]: value }

    persistPreferences()
    notifyListeners()
}

export function subscribePreferences(listener: PreferencesListener): () => void {
    listeners.add(listener)

    return () => {
        listeners.delete(listener)
    }
}

// Текущее состояние разрешения браузерных уведомлений; API может отсутствовать
// (jsdom) — тогда 'unsupported', без обращения к глобалу
export function notificationPermission(): NotificationPermissionState {
    if (typeof globalThis.Notification === 'undefined') {
        return 'unsupported'
    }

    return globalThis.Notification.permission
}

initPreferences()
