// Элемент списка чатов (stage 4): выбор чата и загрузка аватара чата —
// колбэки из пропсов (фича chats), компонент контроллеров не импортирует.

import Block from '../../core/Block.ts'
import Handlebars from 'handlebars'
import type { ChatInfo } from '../../utils/types.ts'
import template from './chatListUser.hbs'

// equality-хелпер для выделения выбранного чата в списке (chat.hbs)
Handlebars.registerHelper('eq', (left: unknown, right: unknown) => left === right)

export interface UserProps extends ChatInfo {
    // eslint-disable-next-line no-unused-vars
    onSelect?: (id: number) => void
    // eslint-disable-next-line no-unused-vars
    onChatFile?: (data: FormData) => void
}

export class User extends Block {
    constructor(props: UserProps) {
        super({
            ...props,
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
