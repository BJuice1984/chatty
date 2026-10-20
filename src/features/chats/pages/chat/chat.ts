// Feature-страница чатов (stage 4): замена src/pages/chat.
// Компоненты (User/Messenger) получают поведение через пропсы — компоненты
// не могут импортировать фичи вверх по слоям.
// chats-social: колбэки @-поиска, добавления пользователя, реакций и
// реплаев; chatPaneOpen дополнительно сбрасывается при очистке selectedChat
// (WS chat_deleted сбрасывает выбор через контроллер).

import Block from '../../../../core/Block.ts'
import { AppState, withStore } from '../../../../utils/Store.ts'
import type { ChatInfo } from '../../../../utils/types.ts'
import { emptyValidationMessage } from '../../../../utils/constants.ts'
import { emptyValidator } from '../../../../utils/validators.ts'
import ChatsController from '../../controller.ts'
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
    // мобильное переключение (<768): true — показана панель чата, список
    // скрыт; false — список. Модификатор корня chat_pane-open в chat.hbs
    chatPaneOpen?: boolean
}

class ChatPageBase extends Block {
    // Дочерние Messenger-инстансы пересоздаются перерисовкой (семантика
    // stage 14 — CDM только на дереве момента монтирования), поэтому
    // автоскролл списка сообщений живёт здесь: инстанс страницы стабилен.
    // При открытии чата показываем последние сообщения; новые докручивают
    // список, только если читали низ.
    private pinnedToBottom = true

    // Перерисовка дочернего Messenger пересоздаёт DOM списка и сбрасывает
    // scrollTop. После рендера: если читали низ — докручиваем (или едем в
    // низ при смене чата), иначе восстанавливаем сохранённую позицию —
    // иначе любая реакция/ре-рендер отбрасывает чтение истории наверх.
    private restoreMessagesScroll(toBottom: boolean): void {
        const before = this.element?.querySelector('.messenger__container') as
            { scrollTop?: number } | undefined
        const saved = before != null && typeof before.scrollTop === 'number' ? before.scrollTop : 0

        const run = () => {
            const container = this.element?.querySelector('.messenger__container') as
                { scrollTop?: number, scrollHeight?: number } | null

            // утиная проверка: jsdom-тесты не дают HTMLElement; элемента
            // может не быть вовсе (изолированные тесты)
            if (container != null && typeof container.scrollHeight === 'number') {
                container.scrollTop = toBottom ? container.scrollHeight : saved
            }
        }

        // CDU выполняется до FLOW_RENDER — скроллим в следующем кадре
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run)
        } else {
            setTimeout(run, 0)
        }
    }
    constructor(propsFromStore: ChatPageProps) {
        super({
            chatPaneOpen: false,
            onClick: () => {
                this.refs.create.setProps({ isShown: true })
            },
            onSelectChat: (id: number) => {
                // Любой выбор чата открывает панель — chatListUser стреляет
                // onSelect и на повторном клике по выбранном чате
                this.setProps({ chatPaneOpen: true })
                ChatsController.selectChat(id)
                void ChatsController.getChatUsers(id)
            },
            onBack: () => {
                // Кнопка «назад» в шапке messenger (<768): возврат к списку
                this.setProps({ chatPaneOpen: false })
            },
            onChatAvatar: (data: FormData) => {
                void ChatsController.changeChatAvatar(data)
            },
            onDeleteChat: (id: number) => {
                void ChatsController.delete(id)
            },
            // @-поиск для модалки добавления: контроллер ходит в GET /users
            onSearchUsers: async (login: string) => ChatsController.searchUsers(login),
            // клик по найденному пользователю добавляет его в чат
            onAddUser: async (userId: number, chatId: number) => {
                await ChatsController.addUsersToChat([userId], chatId)
            },
            onSendMessage: (chatId: number, message: string, replyToId?: number) => {
                void ChatsController.sendMessage(chatId, message, replyToId)
            },
            onSetReaction: (chatId: number, messageId: number, emoji: string) => {
                void ChatsController.setReaction(chatId, messageId, emoji)
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
                    handleSubmitClick: (value: { title: string }) => {
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

    // Перерисовка страницы (выделение выбранного чата и пр.) пересоздаёт
    // DOM списка чатов и сбрасывает его скролл — снимаем позицию на входе
    // CDU (старый DOM ещё жив) и восстанавливаем после рендера.
    private usersListScroll = 0

    private restoreUsersListScroll(): void {
        const run = () => {
            const list = this.element?.querySelector('.chat__container-users-list') as
                { scrollTop?: number } | null

            if (list != null && typeof list.scrollTop === 'number') {
                list.scrollTop = this.usersListScroll
            }
        }

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run)
        } else {
            setTimeout(run, 0)
        }
    }

    // chat_deleted (WS): контроллер очистил selectedChat в сторе — withStore
    // принёс undefined в пропсы, панель возвращается к списку чатов.
    // Гвардия по переходу «был выбор → пропал»: панель не захлопывается,
    // пока чат ещё не выбирали (мобильный вход на страницу)
    protected componentDidUpdate(oldProps: unknown, newProps: { selectedChat?: number, messages?: unknown[] }) {
        const usersList = this.element?.querySelector('.chat__container-users-list') as
            { scrollTop?: number } | null

        if (usersList != null && typeof usersList.scrollTop === 'number') {
            this.usersListScroll = usersList.scrollTop
        }

        this.restoreUsersListScroll()

        if (
            (oldProps as { selectedChat?: number }).selectedChat !== undefined &&
            newProps.selectedChat === undefined &&
            (this.props as { chatPaneOpen?: boolean }).chatPaneOpen === true
        ) {
            this.setProps({ chatPaneOpen: false })
        }

        // автоскролл: смена чата — всегда вниз; рост сообщений — только если
        // читали низ (pinnedToBottom обновляется scroll-слушателем из CDM)
        const chatChanged = (oldProps as { selectedChat?: number }).selectedChat !== newProps.selectedChat
        const oldLen = ((oldProps as { messages?: unknown[] }).messages ?? []).length
        const newLen = (newProps.messages ?? []).length

        if (chatChanged) {
            this.pinnedToBottom = true
            this.restoreMessagesScroll(true)
        } else if (newLen > oldLen && this.pinnedToBottom) {
            this.restoreMessagesScroll(true)
        } else {
            // перерисовка без роста (реакция, реплай-черновик): вернуть
            // читаемую позицию, сброшенную пересозданием DOM списка
            this.restoreMessagesScroll(false)
        }

        return true
    }

    componentDidMount() {
        // Список чатов нужен при каждом заходе на страницу (LIVE-3): SPA-вход
        // после логина не повторяет bootstrap из main.ts. CDM диспатчится
        // Router-ом при монтировании; уход с маршрута уничтожает инстанс,
        // поэтому возврат монтирует свежий и фетч повторяется.
        void ChatsController.fetchChats()

        // scroll не всплывает — слушаем контейнер сообщений напрямую; узел
        // умирает вместе с инстансом, утечки нет
        const container = this.element?.querySelector('.messenger__container')

        container?.addEventListener('scroll', () => {
            const el = container as { scrollHeight?: number, scrollTop?: number, clientHeight?: number }

            if (typeof el.scrollHeight === 'number') {
                this.pinnedToBottom = el.scrollHeight - (el.scrollTop ?? 0) - (el.clientHeight ?? 0) < 120
            }
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}

const withChats = withStore((state: AppState) => {
    return {
        chats: state.chats,
        selectedChat: state.selectedChat,
    }
})

export const ChatPage = withChats(ChatPageBase as typeof Block)
