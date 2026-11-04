// Полноэкранное затемнение со спиннером на время перехвата запросов
// (2026-11-03-auth-refresh-retry): refresh-пауза и 5xx-повторы. Модуль
// утилитарный и императивный (без Block): узел создаётся лениво при первом
// show, удаление отложено на macrotask и отменяется следующим show —
// переход 401→5xx между фазами перехвата не мигает.

export type BusyOverlayKind = 'wait' | 'reconnect'

const OVERLAY_ID = 'busy-overlay'
const TEARDOWN_DELAY_MS = 0

const CAPTIONS: Record<BusyOverlayKind, string> = {
    wait: 'Пожалуйста, ожидайте',
    reconnect: 'Возможно, проблемы на сервере.. Мы пробуем переподключиться',
}

let overlayCount = 0
let activeKind: BusyOverlayKind | null = null
let teardownTimer: ReturnType<typeof setTimeout> | null = null

function buildOverlayNode(kind: BusyOverlayKind): HTMLElement {
    const overlay = document.createElement('div')

    overlay.id = OVERLAY_ID
    overlay.className = `busy-overlay busy-overlay_kind_${kind}`
    overlay.setAttribute('role', 'status')
    overlay.setAttribute('aria-live', 'polite')

    const spinner = document.createElement('div')

    spinner.className = 'busy-overlay__spinner'
    overlay.appendChild(spinner)

    const caption = document.createElement('span')

    caption.className = 'busy-overlay__caption'
    caption.textContent = CAPTIONS[kind]
    overlay.appendChild(caption)

    if (kind === 'wait') {
        const dots = document.createElement('span')

        dots.className = 'busy-overlay__dots'
        dots.setAttribute('aria-hidden', 'true')

        for (let index = 0; index < 3; index += 1) {
            const dot = document.createElement('span')

            dot.className = 'busy-overlay__dot'
            dot.textContent = '.'
            dots.appendChild(dot)
        }

        overlay.appendChild(dots)
    }

    return overlay
}

function overlayNode(): HTMLElement | null {
    return document.getElementById(OVERLAY_ID)
}

function cancelTeardown(): void {
    if (teardownTimer !== null) {
        clearTimeout(teardownTimer)
        teardownTimer = null
    }
}

export function showBusyOverlay(kind: BusyOverlayKind): void {
    cancelTeardown()
    overlayCount += 1

    if (activeKind !== kind) {
        const previous = overlayNode()

        previous?.remove()
        activeKind = kind
    }

    if (overlayNode() == null) {
        document.body.appendChild(buildOverlayNode(kind))
    }
}

export function hideBusyOverlay(): void {
    overlayCount = Math.max(0, overlayCount - 1)

    if (overlayCount === 0 && teardownTimer === null) {
        teardownTimer = setTimeout(() => {
            teardownTimer = null
            overlayNode()?.remove()
            activeKind = null
        }, TEARDOWN_DELAY_MS)
    }
}

// Тестовый хук: модуль держит refcount между сценариями, сьюты сбрасывают
// его вместе с DOM перед каждым кейсом (публичный контракт — только пара
// show/hide)
export function resetBusyOverlayForTests(): void {
    cancelTeardown()
    overlayCount = 0
    activeKind = null
    overlayNode()?.remove()
}
