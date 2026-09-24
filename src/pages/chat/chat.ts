import { ChatInfo, CreateChatData } from '../../api/ChatsApi.ts'
import ChatsController from '../../controllers/ChatsController.ts'
import Block from '../../core/Block.ts'
import { AppState, withStore } from '../../utils/Store.ts'
import { emptyValidationMessage } from '../../utils/constants.ts'
import { emptyValidator } from '../../utils/validators.ts'
import template from './chat.hbs'

interface ChatPageProps {
    stories: {
        owner: string
        extraClass?: string
        src: string
        alt: string
    }[]
    chats?: ChatInfo[]
    selectedChat: number
}

class ChatPageBase extends Block {
    constructor(propsFromStore: ChatPageProps) {
        super({
            onClick: () => {
                this.refs.create.setProps({ isShown: true })
            },
            inputs: [
                {
                    label: 'type chat name',
                    name: 'title',
                    validate: emptyValidator,
                    validateMessage: emptyValidationMessage,
                },
            ],
            buttons: [
                {
                    label: 'Create',
                    classType: 'hidden',
                    type: 'submit',
                    handleSubmitClick: (value: CreateChatData) => {
                        void ChatsController.create(value)
                    },
                },
            ],
            stories: [
                {
                    owner: 'You story',
                    extraClass: 'chat-story__container_type_add-story',
                    src: '/images/add-story-icon.svg',
                    alt: 'Иконка. Создать историю',
                },
                {
                    owner: 'Midala Huininja',
                    src: '/images/ava-1.jpg',
                    alt: 'Иконка. Аватар пользователя',
                },
                {
                    owner: 'Athalia Putri',
                    src: '/images/ava-2.jpg',
                    alt: 'Иконка. Аватар пользователя',
                },
                {
                    owner: 'Erlan Sadewa',
                    src: '/images/ava-3.jpg',
                    alt: 'Иконка. Аватар пользователя',
                },
            ],
            chats: propsFromStore.chats,
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}

const withChats = withStore((state: AppState) => {
    return {
        chats: state.chats,
    }
})

export const ChatPage = withChats(ChatPageBase as typeof Block)
