import { ChatInfo } from '../../api/ChatsApi.ts'
import ChatsController from '../../controllers/ChatsController.ts'
import Block from '../../core/Block.ts'
import template from './chatListUser.hbs'

export class User extends Block {
    constructor(props: ChatInfo) {
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
                    ChatsController.selectChat(props.id)
                    void ChatsController.getChatUsers(props.id)
                },
            },
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
