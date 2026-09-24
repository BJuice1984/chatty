import Block from '../../core/Block.ts'
import Router from '../../utils/Router.ts'
import { MESSENGER, PROFILE } from '../../utils/constants.ts'
import template from './bottomBar.hbs'

export class BottomBar extends Block {
    constructor() {
        super({
            bottomBarIcons: [
                {
                    src: '/images/bottom-bar-icon_group.svg',
                    alt: 'Иконка. Контакты',
                    onClick: () => {
                        console.log('render contacts')
                    },
                },
                {
                    src: '/images/bottom-bar-icon_chats.svg',
                    alt: 'Иконка. Чаты',
                    onClick: () => {
                        Router.go(MESSENGER)
                    },
                },
                {
                    src: '/images/bottom-bar-icon_more.svg',
                    alt: 'Иконка. Ещё',
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
