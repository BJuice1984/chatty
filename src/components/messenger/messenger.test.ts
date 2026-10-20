// Регрессия LIVE-7: колбэки отправки/удаления читают this.props на момент
// клика, а не замыкание конструктора — selectedChat появляется только после
// выбора чата, конструкторное значение навсегда осталось бы undefined.
// chat-ui-polish: mapTypedMessages вешает showDate на первое сообщение дня.
// chats-social: модалки добавления/удаления на Modal, @-поиск с дебаунсом,
// черновик реплая над инпутом. Шаблон грузится тестовым погрузчиком
// (прецедент — ai-assistant), компоненты-хелперы (Modal/Message/Form) —
// импортом components.ts, как в прод-сборке main.ts.

import { expect } from 'chai'
import sinon from 'sinon'
import Handlebars from 'handlebars'
import '../../features/ai-assistant/hbs-test-loader.ts'
import type Block from '../../core/Block.ts'
import { registerComponent } from '../../core/registerComponent.ts'
import * as Components from '../components.ts'
import { mapTypedMessages, Messenger, USER_SEARCH_DEBOUNCE_MS } from './messenger.ts'
import store from '../../utils/Store.ts'
import type { Message } from '../../utils/types.ts'

// Регистрация компонентов-хелперов как в прод-сборке (main.ts): модалкам и
// пузырям нужен настоящий рендер вложенных helper-компонентов
Object.entries(Components).forEach(([name, component]) => {
    if (!(name in Handlebars.helpers)) {
        registerComponent(name, component as typeof Block)
    }
})

interface SubmitButton {
    type: string
    handleSubmitClick?: (value: { message: string }) => void
}

interface HeaderButton {
    extraClass: string
    handleClick?: () => void
}

interface MessengerTestProps {
    buttons: SubmitButton[]
    headerButtons: HeaderButton[]
    addUserOpen?: boolean
    deleteModalOpen?: boolean
    onReplyToMessage?: (draft: { id?: number; snippet: string }) => void
}

function propsOf(messenger: unknown): MessengerTestProps {
    return (messenger as unknown as { props: MessengerTestProps }).props
}

describe('mapTypedMessages day markers', () => {
    // Локальная ISO-метка без зоны: день метки не зависит от таймзоны машины
    const iso = (date: Date) => {
        const pad = (value: number) => String(value).padStart(2, '0')

        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T12:00:00`
    }

    const dayAgo = (days: number) => {
        const date = new Date()

        date.setDate(date.getDate() - days)

        return date
    }

    const dto = (time: string): Message => ({ chat_id: 1, time, type: 'message', user_id: 7, content: `m-${time}` })

    it('flags the first message of each day with showDate', () => {
        const typed = mapTypedMessages([
            dto(iso(dayAgo(2))),
            dto(iso(dayAgo(1))),
            dto(iso(new Date())),
            dto(iso(new Date())),
        ], 7)

        expect(typed.map(message => message.showDate)).to.deep.equal([true, true, true, false])
    })

    it('keeps showDate off when the day does not change', () => {
        const typed = mapTypedMessages([
            dto(iso(new Date())),
            dto(iso(new Date())),
        ], 7)

        expect(typed.map(message => message.showDate)).to.deep.equal([true, false])
    })

    it('invalid time gets no marker and does not break the day chain', () => {
        const typed = mapTypedMessages([
            dto(iso(new Date())),
            dto('t1'),
            dto(iso(new Date())),
        ], 7)

        expect(typed.map(message => message.showDate)).to.deep.equal([true, false, false])
    })

    it('first message after an invalid one still marks a new day', () => {
        const typed = mapTypedMessages([
            dto('t1'),
            dto(iso(dayAgo(1))),
        ], 7)

        expect(typed.map(message => message.showDate)).to.deep.equal([false, true])
    })

    it('maps the bubble side and passes time through', () => {
        const nowIso = iso(new Date())
        const typed = mapTypedMessages([
            { ...dto(nowIso), user_id: 7 },
            { ...dto(nowIso), user_id: 42 },
        ], 7)

        expect(typed[0].isMine).to.be.true
        expect(typed[1].isMine).to.be.false
        expect(typed[0].time).to.equal(nowIso)
    })
})

describe('messenger action dispatch', () => {
    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
    })

    it('carries the current selectedChat into the send callback (LIVE-7)', () => {
        const onSendMessage = sinon.spy()
        const messenger = new Messenger({ onSendMessage } as never)

        try {
            // Чат выбрали ПОСЛЕ монтирования — Store обновляет пропсы через withStore
            store.set('messages', { 5: [] })
            store.set('selectedChat', 5)

            const send = propsOf(messenger).buttons.find(button => button.type === 'submit')

            send?.handleSubmitClick?.({ message: 'привет' })

            expect(onSendMessage.calledOnceWith(5, 'привет')).to.be.true
        } finally {
            messenger.destroy()
        }
    })

    it('keeps the send dispatch silent until a chat is selected (LIVE-7)', () => {
        const onSendMessage = sinon.spy()
        const messenger = new Messenger({ onSendMessage } as never)

        try {
            const send = propsOf(messenger).buttons.find(button => button.type === 'submit')

            send?.handleSubmitClick?.({ message: 'привет' })

            expect(onSendMessage.called).to.be.false
        } finally {
            messenger.destroy()
        }
    })

    it('carries the current selectedChat into the delete confirm (LIVE-7)', () => {
        const onDeleteChat = sinon.spy()
        const messenger = new Messenger({ onDeleteChat } as never)

        try {
            store.set('messages', { 7: [] })
            store.set('selectedChat', 7)

            // крестик шапки открывает модалку подтверждения — сам id читается
            // из this.props на момент клика по «Удалить»
            const close = propsOf(messenger).headerButtons.find(button => button.extraClass === 'close')

            close?.handleClick?.()

            expect(propsOf(messenger).deleteModalOpen).to.be.true

            messenger.element?.querySelector('[data-testid="delete-chat-confirm"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

            expect(onDeleteChat.calledOnceWith(7)).to.be.true
            expect(propsOf(messenger).deleteModalOpen).to.be.false
        } finally {
            messenger.destroy()
        }
    })
})

// Модалка добавления пользователя (chats-social): @-поиск с дебаунсом через
// onSearchUsers, клик по находке зовёт onAddUser(userId, chatId), фидбек
// после добавления. Модальное состояние — controller-free UI-пропсы.
describe('messenger add-user modal', () => {
    beforeEach(() => {
        store.set('messages', { 5: [] })
        store.set('selectedChat', 5)
    })

    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
    })

    function openAddUser(messenger: unknown): void {
        const cross = propsOf(messenger).headerButtons.find(button => button.extraClass === 'cross')

        cross?.handleClick?.()
    }

    it('opens and closes the modal from the header buttons', () => {
        const messenger = new Messenger({} as never)

        try {
            openAddUser(messenger)

            expect(propsOf(messenger).addUserOpen).to.be.true
            expect(messenger.element?.querySelector('[data-testid="user-search-input"]')).to.exist

            messenger.element?.querySelector('[data-testid="modal-close"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

            expect(propsOf(messenger).addUserOpen).to.be.false
        } finally {
            messenger.destroy()
        }
    })

    it('debounces the @-prefixed search and renders the typed results', async () => {
        const clock = sinon.useFakeTimers()
        const onSearchUsers = sinon.stub().resolves([
            { id: 101, login: 'bob@example.com', display_name: 'bob' },
        ])
        const messenger = new Messenger({ onSearchUsers } as never)

        try {
            openAddUser(messenger)

            const input = messenger.element?.querySelector<HTMLInputElement>('[data-testid="user-search-input"]')

            input!.value = '@bob'
            // mochaSetup даёт только MouseEvent-глобал: тип события 'input'
            // важнее интерфейса, слушатель смотрит на event.type и target
            input!.dispatchEvent(new MouseEvent('input', { bubbles: true }))

            // до истечения дебаунса поиска нет
            await clock.tickAsync(USER_SEARCH_DEBOUNCE_MS - 50)
            expect(onSearchUsers.called).to.be.false

            await clock.tickAsync(100)

            expect(onSearchUsers.calledOnceWith('bob')).to.be.true

            const result = messenger.element?.querySelector<HTMLButtonElement>('[data-testid="user-search-result"]')

            expect(result?.dataset.userId).to.eq('101')
            expect(result?.textContent).to.contain('bob')
            expect(result?.textContent).to.contain('bob@example.com')
        } finally {
            messenger.destroy()
            clock.restore()
        }
    })

    it('clears the results when the query empties', async () => {
        const onSearchUsers = sinon.stub().resolves([])
        const messenger = new Messenger({ onSearchUsers } as never)

        try {
            messenger.setProps({ addUserOpen: true, addUserResults: [{ id: 1, login: 'a@example.com', display_name: 'a' }], addUserQuery: 'a' })

            expect(messenger.element?.querySelector('[data-testid="user-search-result"]')).to.exist

            const input = messenger.element?.querySelector<HTMLInputElement>('[data-testid="user-search-input"]')

            input!.value = ''
            input!.dispatchEvent(new MouseEvent('input', { bubbles: true }))

            expect(messenger.element?.querySelector('[data-testid="user-search-result"]')).to.not.exist
            expect(onSearchUsers.called).to.be.false
        } finally {
            messenger.destroy()
        }
    })

    it('adds the picked user through the callback and shows feedback', async () => {
        const onAddUser = sinon.stub().resolves()
        const messenger = new Messenger({ onAddUser } as never)

        try {
            messenger.setProps({ addUserOpen: true, addUserResults: [{ id: 101, login: 'bob@example.com', display_name: 'bob' }] })

            messenger.element?.querySelector<HTMLButtonElement>('[data-testid="user-search-result"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

            expect(onAddUser.calledOnceWith(101, 5)).to.be.true

            await new Promise(resolve => setTimeout(resolve, 0))

            expect(messenger.element?.querySelector('[data-testid="add-user-feedback"]')?.textContent?.trim()).to.eq('Пользователь добавлен')
        } finally {
            messenger.destroy()
        }
    })

    it('escapes search results in the slot html', async () => {
        const messenger = new Messenger({ onSearchUsers: async () => [] } as never)

        try {
            messenger.setProps({
                addUserOpen: true,
                addUserQuery: '<img>',
                addUserResults: [{ id: 1, login: '<script>x</script>', display_name: '<b>имя</b>' }],
            })

            const content = messenger.element?.querySelector('[data-testid="user-search-results"]')

            expect(content?.querySelector('script')).to.not.exist
            expect(content?.innerHTML).to.contain('&lt;script&gt;')
        } finally {
            messenger.destroy()
        }
    })
})

// Модалка удаления: подтверждение кликом, отмена не трогает чат
describe('messenger delete-chat modal', () => {
    beforeEach(() => {
        store.set('messages', { 7: [] })
        store.set('selectedChat', 7)
    })

    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
    })

    it('cancel closes the modal without deleting', () => {
        const onDeleteChat = sinon.spy()
        const messenger = new Messenger({ onDeleteChat } as never)

        try {
            messenger.setProps({ deleteModalOpen: true })

            messenger.element?.querySelector('[data-testid="delete-chat-cancel"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

            expect(onDeleteChat.called).to.be.false
            expect(propsOf(messenger).deleteModalOpen).to.be.false
        } finally {
            messenger.destroy()
        }
    })

    it('renders the chat title in the confirmation text', () => {
        store.set('chats', [{ id: 7, title: 'рабочий чат', avatar: '', unread_count: 0 }])
        const messenger = new Messenger({} as never)

        try {
            messenger.setProps({ deleteModalOpen: true })

            expect(messenger.element?.querySelector('[data-testid="delete-chat-text"]')?.textContent).to.contain('рабочий чат')
        } finally {
            messenger.destroy()
            store.set('chats', undefined)
        }
    })
})

// Черновик реплая: превью цитаты над инпутом, отмена крестиком, отправка
// уносит reply_to_id и сбрасывает черновик
describe('messenger reply draft', () => {
    beforeEach(() => {
        store.set('messages', { 5: [] })
        store.set('selectedChat', 5)
    })

    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
    })

    it('shows and cancels the quoted preview above the input', () => {
        const messenger = new Messenger({} as never)

        try {
            (propsOf(messenger) as { onReplyToMessage: (draft: { id?: number; snippet: string }) => void }).onReplyToMessage({ id: 11, snippet: 'цитируемое' })

            expect(messenger.element?.querySelector('[data-testid="reply-preview"]')?.textContent).to.contain('цитируемое')

            messenger.element?.querySelector('[data-testid="reply-cancel"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

            expect(messenger.element?.querySelector('[data-testid="reply-preview"]')).to.not.exist
        } finally {
            messenger.destroy()
        }
    })

    it('sends with the draft id and resets the draft afterwards', () => {
        const onSendMessage = sinon.spy()
        const messenger = new Messenger({ onSendMessage } as never)

        try {
            (propsOf(messenger) as { onReplyToMessage: (draft: { id?: number; snippet: string }) => void }).onReplyToMessage({ id: 11, snippet: 'цитируемое' })

            const send = propsOf(messenger).buttons.find(button => button.type === 'submit')

            send?.handleSubmitClick?.({ message: 'ответ' })

            expect(onSendMessage.calledOnceWith(5, 'ответ', 11)).to.be.true
            expect(messenger.element?.querySelector('[data-testid="reply-preview"]')).to.not.exist
        } finally {
            messenger.destroy()
        }
    })

    it('sends without a reply when no draft is set', () => {
        const onSendMessage = sinon.spy()
        const messenger = new Messenger({ onSendMessage } as never)

        try {
            const send = propsOf(messenger).buttons.find(button => button.type === 'submit')

            send?.handleSubmitClick?.({ message: 'просто' })

            expect(onSendMessage.calledOnceWith(5, 'просто', undefined)).to.be.true
        } finally {
            messenger.destroy()
        }
    })
})
