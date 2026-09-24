import { ChatUser } from '../../api/ChatsApi.ts'
import ChatsController from '../../controllers/ChatsController.ts'
import MessagesController, { Message } from '../../controllers/MessagesController.ts'
import Block from '../../core/Block.ts'
import { Button, Input } from '../../pages/profile/profile.ts'
import { AppState, withStore } from '../../utils/Store.ts'
import { emptyValidationMessage } from '../../utils/constants.ts'
import { emptyValidator } from '../../utils/validators.ts'
import template from './messenger.hbs'

interface MessengerProps {
    selectedChat: number
    selectedChatUsers: ChatUser[]
    messages: Message[]
    inputs: Input[]
    buttons: Button[]
    [key: string]: unknown
}

class MessengerBase extends Block {
    constructor(propsFromStore: MessengerProps) {
        super({
            selectedChat: propsFromStore.selectedChat,
            selectedChatUsers: propsFromStore.selectedChatUsers,
            messages: propsFromStore.messages,
            chatInfo: propsFromStore.chatInfo,
            formContainerExtraClass: 'messenger__header-form-container',
            headerButtons: [
                {
                    extraClass: 'close',
                    handleClick: () => ChatsController.delete(propsFromStore.selectedChat),
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
                        void MessagesController.sendMessage(
                            propsFromStore.selectedChat,
                            value.message
                        )
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

    const messages = state.messages[selectedChatId] as unknown as Message[]

    const typedMessages = messages.map((message: Message) => ({
        ...message,
        isMine: message.user_id === state.user?.id,
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
