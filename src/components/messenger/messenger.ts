// Мессенджер выбранного чата (stage 4; stage 7 — все действия через пропсы):
// удаление чата, добавление пользователя и отправка сообщения — колбэки из
// пропсов (фича chats); компоненты не импортируют ни controllers, ни фичи.
// chat-ui-polish: стороны пузырей/время/маркеры дней (mapTypedMessages) и
// кнопка «назад» мобильного переключения (onBack из chat.ts).
// URL вложения вычисляется из env (fileUrl) — безопасные схемы гарантирует joinUrl.

import Block from '../../core/Block.ts'
import { Button, Input, Message, SearchUserData } from '../../utils/types.ts'
import { AppState, withStore } from '../../utils/Store.ts'
import { emptyValidationMessage } from '../../utils/constants.ts'
import { emptyValidator } from '../../utils/validators.ts'
import { fileUrl } from '../../utils/env.ts'
import { messageDayKey } from '../message/message.ts'
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
    // возврат к списку чатов в мобильном переключении (<768)
    onBack?: () => void
    [key: string]: unknown
}

interface ChatListUserEntry {
    id: number
    avatar: string
    onClick?: () => void
    [key: string]: unknown
}

// Пропсы Message, вычисленные из DTO: сторона пузыря, безопасный URL
// вложения и showDate — маркер вешается на первое сообщение дня (сравнение
// календарных дней соседних time). Невалидная метка маркера не даёт и
// цепочку дней не рвёт: день без ключа просто пропускается.
export function mapTypedMessages(
    messages: Message[],
    currentUserId: number | undefined
): (Message & { isMine: boolean; fileUrl?: string; showDate: boolean })[] {
    let previousDayKey: string | undefined

    return messages.map(message => {
        const dayKey = messageDayKey(message.time)
        const showDate = dayKey !== undefined && dayKey !== previousDayKey

        if (dayKey !== undefined) {
            previousDayKey = dayKey
        }

        return {
            ...message,
            isMine: message.user_id === currentUserId,
            fileUrl: message.file_url ?? (message.file ? fileUrl(message.file.path) : undefined),
            showDate,
        }
    })
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
            // Колбэк обязан жить в пропсах: this.props обновляется setProps,
            // а замыкание конструктора застывало на старом selectedChat (LIVE-7)
            onSendMessage: propsFromStore.onSendMessage,
            onBack: propsFromStore.onBack,
            // Кнопка «назад» — сырой <button> в messenger.hbs; клик ловится
            // делегированием с корня (прецедент — chat-history), колбэк
            // читается из this.props на момент клика (LIVE-7)
            events: {
                click: (event: Event) => {
                    const target = event.target as HTMLElement | null

                    if (target?.closest('[data-testid="messenger-back"]') != null) {
                        (this.props as MessengerProps).onBack?.()
                    }
                },
            } as unknown as Record<string, () => void>,
            formContainerExtraClass: 'messenger__header-form-container',
            headerButtons: [
                {
                    extraClass: 'close',
                    // this.props, а не замыкание конструктора: selectedChat
                    // появляется после выбора чата, замыкание осталось бы
                    // навсегда undefined (LIVE-7)
                    handleClick: () => {
                        const { onDeleteChat, selectedChat } = this.props as MessengerProps

                        if (typeof selectedChat === 'number') {
                            onDeleteChat?.(selectedChat)
                        }
                    },
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
                        // this.props, а не замыкание конструктора: selectedChat
                        // появляется после выбора чата, замыкание осталось бы
                        // навсегда undefined (LIVE-7)
                        const { onSendMessage, selectedChat } = this.props as MessengerProps

                        if (typeof selectedChat === 'number') {
                            onSendMessage?.(selectedChat, value.message)
                        }
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

    const messages = mapTypedMessages(state.messages[selectedChatId], state.user?.id)

    const chatInfo = state.chats?.find(chat => chat.id === selectedChatId)

    return {
        selectedChat: state.selectedChat,
        selectedChatUsers: state.chatUsers,
        messages,
        chatInfo,
    }
})

export const Messenger = withMessenger(MessengerBase as typeof Block)
