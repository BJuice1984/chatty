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
            // null не дотягивается до fileUrl: контракт ожидает строку (LIVE-4)
            src: typeof src === 'string' && src !== '' ? fileUrl(src) : '',
        })
    }
}
