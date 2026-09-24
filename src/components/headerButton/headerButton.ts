import Block from '../../core/Block.ts'
import template from './headerButton.hbs'

interface headerButtonProps {
    extraClass: string
    handleClick: () => void
    [key: string]: unknown
}

export class headerButton extends Block<headerButtonProps> {
    constructor(props: headerButtonProps) {
        super({
            ...props,
            events: {
                click: props.handleClick,
            },
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
