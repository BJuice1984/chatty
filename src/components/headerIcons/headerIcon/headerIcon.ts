import Block from '../../../core/Block.ts'
import template from './headerIcon.hbs'

interface HeaderIconProps {
    src: string
    alt: string
    onClick?: () => void
    // потушенная иконка (2026-11-05): без колбэка и с aria-disabled
    disabled?: boolean
    [key: string]: unknown
}

export class HeaderIcon extends Block<HeaderIconProps> {
    constructor(props: HeaderIconProps) {
        super({
            ...props,
            events: props.onClick != null
                ? {
                    click: props.onClick,
                }
                : undefined,
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
