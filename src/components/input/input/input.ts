import Block from '../../../core/Block.ts'
import template from './input.hbs'

export interface InputProps {
    onBlur: () => void
    label: string
    name: string
    events: {
        blur: () => void
    }
    [key: string]: unknown
}

export class Input extends Block<InputProps> {
    constructor(props: InputProps) {
        super({
            ...props,
            events: {
                blur: props.onBlur,
            },
        })
    }

    getValue() {
        return this.element ? (this.element as HTMLInputElement).value : ''
    }

    setValue(value: string) {
        if (this.element) {
            ;(this.element as HTMLInputElement).value = value
        }
    }

    render() {
        return this.compile(template, this.props)
    }
}
