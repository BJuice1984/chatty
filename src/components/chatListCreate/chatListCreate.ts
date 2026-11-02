import Block from '../../core/Block.ts'
import template from './chatListCreate.hbs'

interface ChatListCreateProps {
    isShown: boolean
    // One-click-плитка «Чат с AI» (2026-10-27-ai-chat-creation): колбэк
    // приходит от страницы — компонент презентационный и контроллеров не
    // импортирует
    onAiChatClick?: () => void
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
