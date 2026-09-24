import Block from '../../../core/Block.ts'
import template from './chatAvatar.hbs'

interface ChatAvatarProps {
    onClick?: () => void
    avatar: string
    [key: string]: unknown
}

export class ChatAvatar extends Block<ChatAvatarProps> {
    constructor(props: ChatAvatarProps) {
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
