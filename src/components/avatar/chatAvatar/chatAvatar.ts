import Block from '../../../core/Block.ts'
import { fileUrl } from '../../../utils/env.ts'
import template from './chatAvatar.hbs'

export interface ChatAvatarProps {
    onClick?: () => void
    src?: string
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
        const src = this.props.src

        return this.compile(template, {
            ...this.props,
            src: src !== undefined && src !== '' ? fileUrl(src) : src,
        })
    }
}
