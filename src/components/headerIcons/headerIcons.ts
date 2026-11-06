// Иконки шапки списка чатов: «Создать чат» (2026-11-06-chat-create-flow —
// one-click создание: клик сразу рождает чат «Чат с» и открывает его) и
// «Пометить всё прочитанными» (2026-11-05-messenger-ux-pack — бывшая
// иконка настроек: настройки живут на /settings через BottomBar). Кнопка
// прочитанных активна только при наличии пилюль — без них потушена
// (модификатор disabled на HeaderIcon + гейт клика).

import Block from '../../core/Block.ts'
import template from './headerIcons.hbs'

interface HeaderIconsProps {
    src: string
    alt: string
    onClick: () => void
    // есть ли непрочитанные: гейт «Пометить всё прочитанными»
    hasUnread?: boolean
    // клик по «Пометить всё прочитанными» (фича chats через страницу)
    onMarkAllRead?: () => void
    [key: string]: unknown
}

export class HeaderIcons extends Block {
    constructor(props: HeaderIconsProps) {
        super({
            ...props,
            headerIcons: [
                {
                    src: '/images/start-chat-icon.svg',
                    alt: 'Иконка. Создать чат',
                    onClick: props.onClick,
                },
                {
                    src: '/images/mark-all-read-icon.svg',
                    alt: 'Иконка. Пометить всё прочитанными',
                    // потушенная иконка не кликается: гейт на месте колбэка,
                    // CSS дополнительно гасит pointer-events
                    disabled: props.hasUnread !== true,
                    onClick: props.hasUnread === true ? props.onMarkAllRead : undefined,
                },
            ],
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
