// TTL-гашение колец на клиенте. Лента с бэкенда уже отфильтрована по
// story_ttl_hours, но WS-запушенное кольцо и кольца давно смонтированной
// сессии переживают истечение до следующего рефетча — рендер прячет их
// сам, чтобы не кликалось то, чего в серверной ленте уже нет.

// Зеркало серверного дефолта CHATTY_STORY_TTL_HOURS=24 (app/core/config.py):
// ручка осознанно не прокинута — рассинхрон ловится ревью, а не рантаймом
export const STORY_TTL_MS = 24 * 60 * 60 * 1000

export function isStoryAlive(createdAt: string, now: number = Date.now()): boolean {
    const created = Date.parse(createdAt)

    // невалидная дата — не прячем кольцо: мисс-фильтр безопаснее пропуска
    if (Number.isNaN(created)) {
        return true
    }

    return now - created < STORY_TTL_MS
}
