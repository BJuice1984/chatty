// Плитка истории в ряду stories чат-страницы. Поведение — через пропсы:
// onClick получает id (страница решает, открыть вьюер или пикер для
// add-плитки), isUnread=false гасит градиентную рамку (chat-story__container_viewed).
// Мок-стадия stories: состояние просмотренности живёт в пропсах страницы.

import Block from '../../core/Block.ts'
import template from './story.hbs'

interface StoryProps {
    // идентификатор истории: страница маркирует просмотр и различает
    // add-плитку (id 'add-story')
    id?: string
    owner: string
    extraClass?: string
    src: string
    alt: string
    // false — история просмотрена: рамка приглушается; undefined/true —
    // выделенная (непросмотренная) рамка. add-плитка не задаёт поле.
    isUnread?: boolean
    // eslint-disable-next-line no-unused-vars
    onClick?: (id?: string) => void
    [key: string]: unknown
}

export class Story extends Block {
    constructor(props: StoryProps) {
        super({
            ...props,
            // viewed вычисляем один раз при создании: плитки пересоздаются
            // каждой перерисовкой страницы (hbs-дети), отдельной реакции не нужно
            viewed: props.isUnread === false,
            events: {
                click: (event: Event) => {
                    const target = event.target as HTMLElement | null

                    if (target?.closest('.chat-story__container') != null) {
                        props.onClick?.(props.id)
                    }
                },
            } as unknown as Record<string, () => void>,
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
