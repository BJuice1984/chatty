import Block from '../../core/Block.ts'
import template from './button.hbs'

export interface ButtonProps {
    label: string
    classType: 'primary' | 'secondary' | 'danger' | 'disabled' | 'hidden'
    type: 'submit' | 'button'
    onClick: () => void
    // атрибут disabled самой кнопки (2026-11-07-auth-session-ux): полёт
    // запроса авторизации; со стилевым classType 'disabled' не связан
    disabled?: boolean
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
