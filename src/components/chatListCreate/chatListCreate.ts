import Block from '../../core/Block.ts'
import template from './chatListCreate.hbs'

interface ChatListCreateProps {
    isShown: boolean
}

export class ChatListCreate extends Block {
    constructor(props: ChatListCreateProps) {
        super({
            ...props,
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
