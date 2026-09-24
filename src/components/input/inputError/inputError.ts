import Block from '../../../core/Block.ts'
import template from './inputError.hbs'

interface InputErrorProps {
    validateMessage: string
    show: boolean
}

export class InputError extends Block {
    constructor(props: InputErrorProps) {
        super({
            ...props,
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
