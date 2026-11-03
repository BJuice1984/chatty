// Общая память прокрутки ленты сообщений (2026-11-02-ui-ux): вынесена из
// MessengerBase, чтобы страница чата (движок автоскролла) и сам Messenger
// (preserve позиции после собственных перерисовок — модалки, черновик
// ответа, меню участника) читали и писали один источник правды.
// Контракт модуля (review F-5): он владеет ТОЛЬКО памятью, document-capture
// синком и расчётом целевой позиции (bottom/память); каЖдый вызывающий
// держит собственный rAF-план и применяет его к СВОЕМУ элементу
// (this.element) — планы брошенных инстансов Messenger (hbs-дети
// пересоздаются без destroy) разрешаются в detached-узлах и молчат,
// а не вытесняют план страницы. Никаких модульных слотов плана или
// document-resolved целей здесь быть не должно.

export interface FeedScrollState {
    top: number
    pinned: boolean
}

// Расстояние от низа, внутри которого лента считается прижатой к низу
export const FEED_PINNED_THRESHOLD_PX = 120

// Окно подавления эха сброса: перерисовка пересоздаёт список (scrollTop=0)
// и порождает scroll-событие с top=0, которое без этой метки затирало бы
// сохранённую позицию чтения
export const FEED_SCROLL_ECHO_WINDOW_MS = 300

// Память по chatId: переживает пересоздание инстансов Messenger и страницы
const scrollMemory = new Map<number, FeedScrollState>()

// Ключ чата, чей скролл сейчас синкается (последний смонтированный
// мессенджер/страница); scroll не всплывает — синк один на документ
let currentScrollKey = -1
let scrollSyncInstalled = false
let lastPlanAt = 0

export function getFeedScroll(chatId: number): FeedScrollState | undefined {
    return scrollMemory.get(chatId)
}

export function setFeedScroll(chatId: number, state: FeedScrollState): void {
    scrollMemory.set(chatId, state)
}

export function deleteFeedScroll(chatId: number): void {
    scrollMemory.delete(chatId)
}

// Метка времени последнего планового кадра — вызывающие ставят её перед
// применением собственного плана
export function markFeedScrollPlan(): void {
    lastPlanAt = Date.now()
}

export function feedScrollEchoSuppressed(top: number): boolean {
    return top === 0 && Date.now() - lastPlanAt < FEED_SCROLL_ECHO_WINDOW_MS
}

// Позиция прижата к низу? Утиная проверка: jsdom-тесты дают plain-объекты
export function isFeedPinned(el: { scrollHeight?: number, scrollTop?: number, clientHeight?: number }): boolean {
    if (typeof el.scrollHeight !== 'number') {
        return true
    }

    return el.scrollHeight - (el.scrollTop ?? 0) - (el.clientHeight ?? 0) < FEED_PINNED_THRESHOLD_PX
}

// Разовая установка document-capture синка: событие — единственный всегда
// верный источник позиции (DOM-снятие на CDU-входе не ловит перерисовки
// инстанса)
export function installFeedScrollSync(): void {
    if (scrollSyncInstalled || typeof document === 'undefined') {
        return
    }

    scrollSyncInstalled = true

    document.addEventListener('scroll', (event: Event) => {
        const el = event.target as { className?: unknown, scrollTop?: number, scrollHeight?: number, clientHeight?: number }

        if (typeof el.className !== 'string' || !el.className.includes('messenger__container')) {
            return
        }

        if (typeof el.scrollHeight !== 'number') {
            return
        }

        const top = el.scrollTop ?? 0

        // сброс-эхо сразу после планового кадра игнорируем
        if (feedScrollEchoSuppressed(top)) {
            return
        }

        setFeedScroll(currentScrollKey, { top, pinned: isFeedPinned(el) })
    }, true)
}

// Ключ текущего синка: страница/мессенджер ставят его при монтировании
export function setFeedScrollKey(chatId: number): void {
    currentScrollKey = chatId
}

// Целевая позиция плана: bottom — прокрутить в низ; память отсутствует или
// прижата — тоже низ; иначе сохранённая позиция чтения
export function resolveFeedScrollTarget(chatId: number, plan: 'bottom' | 'preserve'): 'bottom' | { top: number } {
    if (plan === 'bottom') {
        return 'bottom'
    }

    const memory = getFeedScroll(chatId)

    if (memory === undefined || memory.pinned) {
        return 'bottom'
    }

    return { top: memory.top }
}

// Сброс памяти тестами (модульная — между спеками mocha)
export function resetFeedScrollForTests(): void {
    scrollMemory.clear()
    currentScrollKey = -1
    lastPlanAt = 0
}
