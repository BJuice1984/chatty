// Чтение CSRF-cookie для own-режима (stage 7): бэкенд использует double-submit —
// значение cookie chatty_csrf дублируется в заголовке env.csrfHeaderName
// (X-CSRF-Token по умолчанию) на изменяющих состояние запросах (login не требует,
// refresh/logout — требуют). Имя cookie — серверный default из конфига бэкенда.

export const OWN_CSRF_COOKIE_NAME = 'chatty_csrf'

export function readCookie(name: string): string {
    if (name === '') {
        return ''
    }

    const cookies = document.cookie.split(';')

    for (const entry of cookies) {
        const separator = entry.indexOf('=')

        if (separator === -1) {
            continue
        }

        const key = entry.slice(0, separator).trim()

        if (key === name) {
            return decodeURIComponent(entry.slice(separator + 1).trim())
        }
    }

    return ''
}

export function readCsrfToken(): string {
    return readCookie(OWN_CSRF_COOKIE_NAME)
}
