// Полноэкранный просмотр истории (мок-стадия stories). Чисто
// презентационный: таймер автозакрытия принадлежит странице-владельцу —
// hbs-дети пересоздаются каждой перерисовкой родителя, и таймер внутри
// компонента становился бы зомби. Закрытие — интент через onClose:
// клик по бэкдропу/крестику (делегирование с корня, паттерн Modal) и
// Escape (срабатывает при фокусе внутри оверлея: tabindex="-1", фокус
// ставит страница при открытии и восстанавливает после перерисовок).
// 2026-11-08-mobile-messenger-ux: свайпы — тоже интент: touchstart/
// touchend с корня классифицируются resolveSwipe, направление уезжает
// колбэком onSwipe; навигация (next/prev/close + маркировка просмотра)
// принадлежит странице, как и таймер.

import Block from '../../../core/Block.ts'
import { SwipeDirection, SwipePoint, resolveSwipe } from '../../../utils/swipe.ts'
import template from './storyViewer.hbs'

export interface ViewerStory {
    owner: string
    src: string
    alt: string
    // своя история: в шапке появляется кнопка удаления
    isOwn?: boolean
}

interface StoryViewerProps {
    // открытая история; null/undefined — вьюер скрыт
    story?: ViewerStory | null
    onClose?: () => void
    // удаление своей истории (кнопка видна только при story.isOwn)
    onDelete?: () => void
    // свайп-навигация: 'left' — следующая, 'right' — предыдущая,
    // 'down' — закрыть (семантику выбирает страница-владелец)
    // eslint-disable-next-line no-unused-vars
    onSwipe?: (direction: SwipeDirection) => void
    [key: string]: unknown
}

export class StoryViewer extends Block {
    // стартовая точка текущего жеста: null — жеста нет (тап без
    // классификации его просто не зажигает)
    private swipeStart: SwipePoint | null = null

    constructor(props: StoryViewerProps) {
        super({
            ...props,
            events: {
                click: (event: Event) => {
                    const target = event.target as HTMLElement | null

                    if (target?.closest('[data-testid="story-viewer-delete"]') != null) {
                        ;(this.props as StoryViewerProps).onDelete?.()

                        return
                    }

                    if (target?.closest('[data-testid="story-viewer-backdrop"], [data-testid="story-viewer-close"]') != null) {
                        ;(this.props as StoryViewerProps).onClose?.()
                    }
                },
                keydown: (event: Event) => {
                    if ((event as KeyboardEvent).key === 'Escape') {
                        (this.props as StoryViewerProps).onClose?.()
                    }
                },
                touchstart: (event: Event) => {
                    const touch = (event as TouchEvent).changedTouches?.[0]

                    this.swipeStart = touch != null ? { x: touch.clientX, y: touch.clientY } : null
                },
                touchend: (event: Event) => {
                    const start = this.swipeStart

                    this.swipeStart = null

                    const touch = (event as TouchEvent).changedTouches?.[0]

                    if (start == null || touch == null) {
                        return
                    }

                    const direction = resolveSwipe(start, { x: touch.clientX, y: touch.clientY })

                    if (direction != null) {
                        (this.props as StoryViewerProps).onSwipe?.(direction)
                    }
                },
            } as unknown as Record<string, () => void>,
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
