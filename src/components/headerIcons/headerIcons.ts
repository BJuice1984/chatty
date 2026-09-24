import Block from '../../core/Block.ts'
import template from './headerIcons.hbs'

interface HeaderIconsProps {
    src: string
    alt: string
    onClick: () => void
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
                    src: '/images/settings-icon.svg',
                    alt: 'Иконка. Настройки',
                    onClick: () => {
                        console.log('Настройки')
                    },
                },
            ],
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
