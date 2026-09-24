import Block from '../../core/Block.ts'
import template from './button.hbs'

export interface ButtonProps {
    label: string
    classType: 'primary' | 'secondary' | 'disabled' | 'hidden'
    type: 'submit' | 'button'
    onClick: () => void
    events: {
        click: () => void
    }
}

export class Button extends Block {
    constructor(props: ButtonProps) {
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
