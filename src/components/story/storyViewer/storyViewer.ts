// Полноэкранный просмотр истории (мок-стадия stories). Чисто
// презентационный: таймер автозакрытия принадлежит странице-владельцу —
// hbs-дети пересоздаются каждой перерисовкой родителя, и таймер внутри
// компонента становился бы зомби. Закрытие — интент через onClose:
// клик по бэкдропу/крестику (делегирование с корня, паттерн Modal) и
// Escape (срабатывает при фокусе внутри оверлея: tabindex="-1", фокус
// ставит страница при открытии и восстанавливает после перерисовок).

import Block from '../../../core/Block.ts'
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
    [key: string]: unknown
}

export class StoryViewer extends Block {
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
            } as unknown as Record<string, () => void>,
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
