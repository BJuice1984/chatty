// Мессенджер выбранного чата (stage 4; stage 7 — все действия через пропсы):
// удаление чата, добавление пользователя и отправка сообщения — колбэки из
// пропсов (фича chats); компоненты не импортируют ни controllers, ни фичи.
// URL вложения вычисляется из env (fileUrl) — безопасные схемы гарантирует joinUrl.

import Block from '../../core/Block.ts'
import { Button, Input, Message, SearchUserData } from '../../utils/types.ts'
import { AppState, withStore } from '../../utils/Store.ts'
import { emptyValidationMessage } from '../../utils/constants.ts'
import { emptyValidator } from '../../utils/validators.ts'
import { fileUrl } from '../../utils/env.ts'
import template from './messenger.hbs'

interface MessengerProps {
    selectedChat: number
    selectedChatUsers: ChatListUserEntry[]
    messages: Message[]
    inputs: Input[]
    buttons: Button<{ message: string }>[]
    // eslint-disable-next-line no-unused-vars
    onDeleteChat?: (id: number) => void
    // eslint-disable-next-line no-unused-vars
    onAddUser?: (login: SearchUserData, chatId: number) => Promise<void>
    // eslint-disable-next-line no-unused-vars
    onSendMessage?: (chatId: number, message: string) => void
    [key: string]: unknown
}

interface ChatListUserEntry {
    id: number
    avatar: string
    onClick?: () => void
    [key: string]: unknown
}

class MessengerBase extends Block {
    constructor(propsFromStore: MessengerProps) {
        super({
            selectedChat: propsFromStore.selectedChat,
            selectedChatUsers: propsFromStore.selectedChatUsers,
            messages: propsFromStore.messages,
            chatInfo: propsFromStore.chatInfo,
            onDeleteChat: propsFromStore.onDeleteChat,
            onAddUser: propsFromStore.onAddUser,
            formContainerExtraClass: 'messenger__header-form-container',
            headerButtons: [
                {
                    extraClass: 'close',
                    handleClick: () => propsFromStore.onDeleteChat?.(propsFromStore.selectedChat),
                },
                {
                    extraClass: 'cross',
                    handleClick: () => this.refs.addUser.setProps({ isShown: true }),
                },
            ],
            inputs: [
                {
                    label: 'type something...',
                    name: 'message',
                    validate: emptyValidator,
                    validateMessage: emptyValidationMessage,
                },
            ],
            buttons: [
                {
                    label: 'send',
                    classType: 'primary',
                    type: 'submit',
                    handleSubmitClick: (value: { message: string }) => {
                        propsFromStore.onSendMessage?.(propsFromStore.selectedChat, value.message)
                    },
                },
            ],
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}

const withMessenger = withStore((state: AppState) => {
    const selectedChatId = state.selectedChat

    if (
        selectedChatId == null ||
        state.messages === undefined ||
        state.messages[selectedChatId] === undefined
    ) {
        return {
            selectedChat: undefined,
            messages: [],
        }
    }

    const messages = state.messages[selectedChatId]

    const typedMessages = messages.map((message: Message) => ({
        ...message,
        isMine: message.user_id === state.user?.id,
        fileUrl: message.file_url ?? (message.file ? fileUrl(message.file.path) : undefined),
    }))

    const chatInfo = state.chats?.find(chat => chat.id === selectedChatId)

    return {
        selectedChat: state.selectedChat,
        selectedChatUsers: state.chatUsers,
        messages: typedMessages,
        chatInfo,
    }
})

export const Messenger = withMessenger(MessengerBase as typeof Block)
