// Typing-индикатор (stage 10): видим во время searching/typing; состояние
// ограничено временем жизни запроса (ран бота синхронный и ограниченный).

import Block from '../../../core/Block.ts'
import template from './typing-indicator.hbs'

interface TypingIndicatorProps {
    label?: string
    [key: string]: unknown
}

export class TypingIndicator extends Block {
    constructor(props: TypingIndicatorProps) {
        super({ label: 'Ассистент печатает…', ...props })
    }

    render() {
        return this.compile(template, this.props)
    }
}
