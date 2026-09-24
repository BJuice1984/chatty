import Block from '../../core/Block.ts'
import template from './message.hbs'

interface MessageProps {
    validateMessage: string
    show: boolean
}

export class Message extends Block {
    constructor(props: MessageProps) {
        super({
            ...props,
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
