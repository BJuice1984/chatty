import Block from '../../core/Block.ts'
import template from './bottomBarIcon.hbs'

interface BottomBarIconProps {
    src: string
    alt: string
    onClick: () => void
    [key: string]: unknown
}

export class BottomBarIcon extends Block<BottomBarIconProps> {
    constructor(props: BottomBarIconProps) {
        super({
            ...props,
            events: {
                click: props.onClick,
            },
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
