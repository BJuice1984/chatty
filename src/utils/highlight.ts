// Подсветка совпадений живого поиска чатов (2026-10-26-chat-search):
// сервер отдаёт СЫРЫЕ подстроки окна, экранирование — обязанность клиента.
// Схема escape-then-wrap: сначала экранируем каждую часть, потом
// заворачиваем совпадение в <mark> (прецедент renderAddUserModalContent
// в messenger.ts — тройные скобки получают только готовый HTML).

import Handlebars from 'handlebars'

// Части окна подсветки: до/совпадение/после (сырые подстроки)
export interface HighlightParts {
    before: string
    match: string
    after: string
}

// Первое вхождение needle без учёта регистра; пустая игла и промах —
// null (вызывающий рисует обычный текст без <mark>)
export function buildHighlightParts(haystack: string, needle: string): HighlightParts | null {
    if (needle === '') {
        return null
    }

    const index = haystack.toLowerCase().indexOf(needle.toLowerCase())

    if (index === -1) {
        return null
    }

    return {
        before: haystack.slice(0, index),
        match: haystack.slice(index, index + needle.length),
        after: haystack.slice(index + needle.length),
    }
}

// Каждая часть экранируется, <mark> получает ТОЛЬКО совпадение —
// подсветка не открывает HTML-инъекцию через содержимое чата
export function renderHighlighted(parts: HighlightParts): string {
    const escape = Handlebars.escapeExpression

    return `${escape(parts.before)}<mark>${escape(parts.match)}</mark>${escape(parts.after)}`
}
