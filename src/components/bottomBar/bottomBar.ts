import Block from '../../core/Block.ts'
import Router from '../../utils/Router.ts'
import { CONTACTS, MESSENGER, PROFILE } from '../../utils/constants.ts'
import template from './bottomBar.hbs'

export class BottomBar extends Block {
    constructor() {
        // Страницы пересоздаются на каждый переход, поэтому текущий путь
        // читается при конструировании — иконка активного маршрута подсвечивается
        const currentPath = typeof document !== 'undefined'
            ? document.location.pathname
            : ''

        super({
            bottomBarIcons: [
                {
                    src: '/images/bottom-bar-icon_group.svg',
                    alt: 'Иконка. Контакты',
                    isActive: currentPath === CONTACTS,
                    onClick: () => {
                        Router.go(CONTACTS)
                    },
                },
                {
                    src: '/images/bottom-bar-icon_chats.svg',
                    alt: 'Иконка. Чаты',
                    isActive: currentPath === MESSENGER,
                    onClick: () => {
                        Router.go(MESSENGER)
                    },
                },
                {
                    src: '/images/bottom-bar-icon_more.svg',
                    alt: 'Иконка. Ещё',
                    isActive: currentPath === PROFILE,
                    onClick: () => {
                        Router.go(PROFILE)
                    },
                },
            ],
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
