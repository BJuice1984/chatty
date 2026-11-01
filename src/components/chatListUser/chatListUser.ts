// Элемент списка чатов (stage 4): выбор чата и загрузка аватара чата —
// колбэки из пропсов (фича chats), компонент контроллеров не импортирует.
// 2026-10-26-chat-search: подсветка совпадения — страница передаёт сырые
// части, компонент экранирует их и заворачивает совпадение в <mark>.
// 2026-11-01-chat-leave: архивное членство (leftAt) — потушенный
// модификатор карточки: чат читается, но без живого участия.

import Block from '../../core/Block.ts'
import Handlebars from 'handlebars'
import { renderHighlighted } from '../../utils/highlight.ts'
import type { ChatInfo } from '../../utils/types.ts'
import template from './chatListUser.hbs'

// equality-хелпер для выделения выбранного чата в списке (chat.hbs)
Handlebars.registerHelper('eq', (left: unknown, right: unknown) => left === right)

export interface UserProps extends ChatInfo {
    // части подсветки заголовка/сниппета поиска; null/undefined — рисуем
    // обычный текст (matched_in message/both без сниппета — без mark)
    titleParts?: { before: string, match: string, after: string } | null
    snippetParts?: { before: string, match: string, after: string } | null
    // время последнего совпадения поиска вместо last_message.time
    searchTime?: string
    // eslint-disable-next-line no-unused-vars
    onSelect?: (id: number) => void
    // eslint-disable-next-line no-unused-vars
    onChatFile?: (data: FormData) => void
}

export class User extends Block {
    constructor(props: UserProps) {
        super({
            ...props,
            // escape-then-wrap: тройные скобки шаблона получают уже
            // экранированный HTML (прецедент renderAddUserModalContent)
            titleHtml: props.titleParts != null ? renderHighlighted(props.titleParts) : undefined,
            snippetHtml: props.snippetParts != null ? renderHighlighted(props.snippetParts) : undefined,
            onClick: () => {
                this.refs.fileInput.element?.click()
            },
            input: {
                name: 'avatar',
                id: props.id,
                type: 'file',
                extraClass: 'input__element_type_hide',
            },
            events: {
                click: () => {
                    props.onSelect?.(props.id)
                },
            },
        })
    }

    render() {

        return this.compile(template, this.props)
    }
}
