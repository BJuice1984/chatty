import Block from '../../core/Block.ts'
import template from './message.hbs'

interface MessageProps {
    content: string
    user_id: number
    isMine?: boolean
    // вычисляемый безопасный URL вложения (env.filesUrl/file_url через joinUrl)
    fileUrl?: string
    [key: string]: unknown
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
