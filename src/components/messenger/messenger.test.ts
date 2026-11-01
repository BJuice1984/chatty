// Регрессия LIVE-7: колбэки отправки/удаления читают this.props на момент
// клика, а не замыкание конструктора — selectedChat появляется только после
// выбора чата, конструкторное значение навсегда осталось бы undefined.
// chat-ui-polish: mapTypedMessages вешает showDate на первое сообщение дня.
// chats-social: модалки добавления/удаления на Modal, @-поиск с дебаунсом,
// черновик реплая над инпутом. Шаблон грузится тестовым погрузчиком
// (прецедент — ai-assistant), компоненты-хелперы (Modal/Message/Form) —
// импортом components.ts, как в прод-сборке main.ts.
// 2026-11-01-chat-leave: меню участника по клику аватара в шапке — матрица
// видимости (владелец/контакт/свой аватар), архивный режим (нет меню,
// кнопки «+» и композер скрыты), колбэки и XSS на display_name.
// 2026-11-01-settings: проводка autoDownload — вложения открытого чата
// перерисовываются живым тумблером preferences (подписка мессенджера).

import { expect } from 'chai'
import sinon from 'sinon'
import Handlebars from 'handlebars'
import '../../features/ai-assistant/hbs-test-loader.ts'
import type Block from '../../core/Block.ts'
import { registerComponent } from '../../core/registerComponent.ts'
import * as Components from '../components.ts'
import { mapTypedMessages, Messenger, USER_SEARCH_DEBOUNCE_MS } from './messenger.ts'
import store from '../../utils/Store.ts'
import { initPreferences, setPreference } from '../../utils/preferences.ts'
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
    menuTarget?: { id?: number, display_name?: string } | null
    onReplyToMessage?: (draft: { id?: number; snippet: string }) => void
}

function propsOf(messenger: unknown): MessengerTestProps {
    return (messenger as unknown as { props: MessengerTestProps }).props
}

describe('mapTypedMessages day markers', () => {
    it('passes isError through to the rendered bubble modifier', () => {
        // регрессия provider_failed: messenger.hbs перечисляет пропсы Message
        // явно — потерянный isError означал серый пузырь вместо жёлтого
        const [failed, normal] = mapTypedMessages(
            [
                { chat_id: 1, time: 't1', type: 'message', user_id: -1, content: '⚠ ошибка', isError: true },
                { chat_id: 1, time: 't2', type: 'message', user_id: 7, content: 'привет' },
            ],
            7
        )

        expect((failed as { isError?: boolean }).isError).to.eq(true)
        expect((normal as { isError?: boolean }).isError).to.eq(undefined)
    })

    it('renders the yellow _error bubble for isError messages', () => {
        // Messenger тянет selectedChat/messages из стора (withStore) —
        // сценарий живого provider_failed, а не прямые пропсы Message
        store.set('selectedChat', 1)
        store.set('messages', {
            1: [{ chat_id: 1, time: 't1', type: 'message', user_id: -1, content: '⚠ ошибка', isError: true }],
        })
        const messenger = new Messenger({} as never)

        expect(
            messenger.element?.querySelector('.messenger__message-bubble')?.classList.contains('messenger__message-bubble_error')
        ).to.be.true

        messenger.destroy()
        store.set('selectedChat', undefined)
        store.set('messages', {})
    })

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


// Composer-сабмит по DOM-форме (кнопка ушла из пропсов — своя разметка)
function submitComposer(messenger: { element?: Element | null }, text: string): void {
    const form = messenger.element?.querySelector<HTMLFormElement>('[data-testid="composer-form"]')
    const input = form?.querySelector<HTMLInputElement>('input[name="message"]')

    if (input != null) {
        input.value = text
    }

    const view = document.defaultView ?? (globalThis as { Event?: typeof Event })
    const SubmitEvent = (view?.Event ?? Event) as typeof Event
    const submit = new SubmitEvent('submit', { bubbles: true, cancelable: true })

    form?.dispatchEvent(submit)
}

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

            // composer-форма: сабмит идёт через handleComposerSubmit по DOM-форме
            const form = messenger.element?.querySelector<HTMLFormElement>('[data-testid="composer-form"]')
            const input = form?.querySelector<HTMLInputElement>('input[name="message"]')

            if (input != null) {
                input.value = 'привет'
            }

            const view = document.defaultView ?? (globalThis as { Event?: typeof Event })
    const SubmitEvent = (view?.Event ?? Event) as typeof Event
    const submit = new SubmitEvent('submit', { bubbles: true, cancelable: true })

    form?.dispatchEvent(submit)

            expect(onSendMessage.calledOnceWith(5, 'привет')).to.be.true
        } finally {
            messenger.destroy()
        }
    })

    it('keeps the send dispatch silent until a chat is selected (LIVE-7)', () => {
        const onSendMessage = sinon.spy()
        const messenger = new Messenger({ onSendMessage } as never)

        try {
            submitComposer(messenger, 'привет')

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

// Модалка добавления пользователя (chats-social): поиск по началу или
// полному email с дебаунсом через onSearchUsers, клик по находке зовёт
// onAddUser(userId, chatId), фидбек после добавления. Модальное состояние —
// controller-free UI-пропсы.
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

    it('debounces the search and passes the full email verbatim', async () => {
        const clock = sinon.useFakeTimers()
        const onSearchUsers = sinon.stub().resolves([
            { id: 101, login: 'alice@chatty.local', display_name: 'alice' },
        ])
        const messenger = new Messenger({ onSearchUsers } as never)

        try {
            openAddUser(messenger)

            const input = messenger.element?.querySelector<HTMLInputElement>('[data-testid="user-search-input"]')

            input!.value = 'alice@chatty.local'
            // mochaSetup даёт только MouseEvent-глобал: тип события 'input'
            // важнее интерфейса, слушатель смотрит на event.type и target
            input!.dispatchEvent(new MouseEvent('input', { bubbles: true }))

            // значение не переписывается: полный email остаётся как введён
            expect(input!.value).to.equal('alice@chatty.local')

            // до истечения дебаунса поиска нет
            await clock.tickAsync(USER_SEARCH_DEBOUNCE_MS - 50)
            expect(onSearchUsers.called).to.be.false

            await clock.tickAsync(100)

            expect(onSearchUsers.calledOnceWith('alice@chatty.local')).to.be.true

            const result = messenger.element?.querySelector<HTMLButtonElement>('[data-testid="user-search-result"]')

            expect(result?.dataset.userId).to.eq('101')
            expect(result?.textContent).to.contain('alice')
            expect(result?.textContent).to.contain('alice@chatty.local')

            // перерисовка по ответу коммитит запрос в инпут дословно
            const revived = messenger.element?.querySelector<HTMLInputElement>('[data-testid="user-search-input"]')

            expect(revived?.value).to.equal('alice@chatty.local')
        } finally {
            messenger.destroy()
            clock.restore()
        }
    })

    it('still searches a bare prefix without the full email', async () => {
        const clock = sinon.useFakeTimers()
        const onSearchUsers = sinon.stub().resolves([])
        const messenger = new Messenger({ onSearchUsers } as never)

        try {
            openAddUser(messenger)

            const input = messenger.element?.querySelector<HTMLInputElement>('[data-testid="user-search-input"]')

            input!.value = 'bob'
            input!.dispatchEvent(new MouseEvent('input', { bubbles: true }))

            await clock.tickAsync(USER_SEARCH_DEBOUNCE_MS)

            expect(onSearchUsers.calledOnceWith('bob')).to.be.true
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

    // 2026-11-01-contacts (review F-6): билдер модалки получил опциональный
    // alreadyBadge — дефолт обязан остаться «уже в чате», мессенджер ничего
    // не передаёт и его поведение бит-в-бит прежнее
    it('badges an already-member with the default «уже в чате» and disables the result', () => {
        store.set('chatUsers', [{ id: 101, avatar: '' }])
        const messenger = new Messenger({} as never)

        try {
            messenger.setProps({
                addUserOpen: true,
                addUserResults: [{ id: 101, login: 'bob@example.com', display_name: 'bob' }],
            })

            const result = messenger.element?.querySelector<HTMLButtonElement>('[data-testid="user-search-result"]')

            expect(result?.disabled).to.be.true
            expect(result?.textContent).to.contain('уже в чате')
        } finally {
            messenger.destroy()
            store.set('chatUsers', undefined)
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

            submitComposer(messenger, 'ответ')

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
            submitComposer(messenger, 'просто')

            expect(onSendMessage.calledOnceWith(5, 'просто', undefined)).to.be.true
        } finally {
            messenger.destroy()
        }
    })
})

// Меню участника (2026-11-01-chat-leave): клик по аватару в шапке открывает
// Modal-меню; матрица видимости — чужой аватар: «Добавить в контакты» (id
// не в contactIds) и «Удалить из чата» (meId === ownerId); свой аватар:
// «Удалиться из чата»; архивный чат (leftAt): меню нет вовсе, кнопка «+» и
// композер скрыты, история остаётся; «Отмена» — всегда
describe('messenger member menu', () => {
    const members = [
        { id: 9, avatar: '', display_name: 'Боб' },
        { id: 7, avatar: '', display_name: 'Я' },
    ]

    beforeEach(() => {
        store.set('chats', [{ id: 5, title: 'рабочий чат', avatar: '', unread_count: 0, owner_id: 7 }])
        store.set('chatUsers', members)
        store.set('messages', { 5: [] })
        store.set('selectedChat', 5)
    })

    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
        store.set('chatUsers', undefined)
        store.set('chats', undefined)
    })

    const openMemberMenu = (messenger: { element?: Element | null }, userId: number): void => {
        messenger.element?.querySelector(`[data-testid="chat-user-avatar"][data-user-id="${userId}"]`)
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }

    const menuQuery = (messenger: { element?: Element | null }, testid: string) =>
        messenger.element?.querySelector(`[data-testid="${testid}"]`)

    const menuActions = (messenger: { element?: Element | null }) => ({
        addContact: menuQuery(messenger, 'member-menu-add-contact'),
        kick: menuQuery(messenger, 'member-menu-kick'),
        leave: menuQuery(messenger, 'member-menu-leave'),
        cancel: menuQuery(messenger, 'member-menu-cancel'),
    })

    it('owner viewing a non-contact member: contact item, kick and cancel', () => {
        const messenger = new Messenger({ meId: 7, ownerId: 7, contactIds: [] } as never)

        try {
            openMemberMenu(messenger, 9)

            expect(propsOf(messenger).menuTarget?.id).to.eq(9)

            const actions = menuActions(messenger)

            expect(actions.addContact, 'add-contact shown').to.exist
            expect(actions.kick, 'kick shown for the owner').to.exist
            expect(actions.leave, 'no self-leave on another member').to.not.exist
            expect(actions.cancel, 'cancel always').to.exist
        } finally {
            messenger.destroy()
        }
    })

    it('owner viewing an existing contact: kick stays, contact item gone', () => {
        const messenger = new Messenger({ meId: 7, ownerId: 7, contactIds: [9] } as never)

        try {
            openMemberMenu(messenger, 9)

            const actions = menuActions(messenger)

            expect(actions.addContact, 'already a contact').to.not.exist
            expect(actions.kick).to.exist
            expect(actions.cancel).to.exist
        } finally {
            messenger.destroy()
        }
    })

    it('non-owner viewing a non-contact member: contact item only, no kick', () => {
        const messenger = new Messenger({ meId: 3, ownerId: 7, contactIds: [] } as never)

        try {
            openMemberMenu(messenger, 9)

            const actions = menuActions(messenger)

            expect(actions.addContact).to.exist
            expect(actions.kick, 'kick is owner-only').to.not.exist
            expect(actions.leave).to.not.exist
            expect(actions.cancel).to.exist
        } finally {
            messenger.destroy()
        }
    })

    it('non-owner viewing an existing contact: cancel only', () => {
        const messenger = new Messenger({ meId: 3, ownerId: 7, contactIds: [9] } as never)

        try {
            openMemberMenu(messenger, 9)

            const actions = menuActions(messenger)

            expect(actions.addContact).to.not.exist
            expect(actions.kick).to.not.exist
            expect(actions.leave).to.not.exist
            expect(actions.cancel).to.exist
        } finally {
            messenger.destroy()
        }
    })

    it('own avatar of a non-owner member: leave only', () => {
        const messenger = new Messenger({ meId: 9, ownerId: 7, contactIds: [] } as never)

        try {
            openMemberMenu(messenger, 9)

            const actions = menuActions(messenger)

            expect(actions.leave, 'self-leave shown').to.exist
            expect(actions.addContact, 'no self-contact').to.not.exist
            expect(actions.kick, 'no self-kick').to.not.exist
            expect(actions.cancel).to.exist
        } finally {
            messenger.destroy()
        }
    })

    it('own avatar of the owner: leave only — no self-kick either', () => {
        const messenger = new Messenger({ meId: 7, ownerId: 7, contactIds: [] } as never)

        try {
            openMemberMenu(messenger, 7)

            const actions = menuActions(messenger)

            expect(actions.leave).to.exist
            expect(actions.kick).to.not.exist
            expect(actions.addContact).to.not.exist
        } finally {
            messenger.destroy()
        }
    })

    it('cancel closes the menu without firing any action', () => {
        const onAddContact = sinon.spy()
        const onKickUser = sinon.spy()
        const onLeaveChat = sinon.spy()
        const messenger = new Messenger({
            meId: 7,
            ownerId: 7,
            contactIds: [],
            onAddContact,
            onKickUser,
            onLeaveChat,
        } as never)

        try {
            openMemberMenu(messenger, 9)
            menuQuery(messenger, 'member-menu-cancel')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

            expect(propsOf(messenger).menuTarget).to.be.null
            expect(menuActions(messenger).kick).to.not.exist
            expect(onAddContact.called).to.be.false
            expect(onKickUser.called).to.be.false
            expect(onLeaveChat.called).to.be.false
        } finally {
            messenger.destroy()
        }
    })

    it('add-contact fires onAddContact with the member id and closes', () => {
        const onAddContact = sinon.spy()
        const messenger = new Messenger({ meId: 3, ownerId: 7, contactIds: [], onAddContact } as never)

        try {
            openMemberMenu(messenger, 9)
            menuQuery(messenger, 'member-menu-add-contact')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

            expect(onAddContact.calledOnceWith(9)).to.be.true
            expect(propsOf(messenger).menuTarget).to.be.null
        } finally {
            messenger.destroy()
        }
    })

    it('kick fires onKickUser with the member id and the chat id', () => {
        const onKickUser = sinon.spy()
        const messenger = new Messenger({ meId: 7, ownerId: 7, contactIds: [], onKickUser } as never)

        try {
            openMemberMenu(messenger, 9)
            menuQuery(messenger, 'member-menu-kick')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

            expect(onKickUser.calledOnceWith(9, 5)).to.be.true
            expect(propsOf(messenger).menuTarget).to.be.null
        } finally {
            messenger.destroy()
        }
    })

    it('leave fires onLeaveChat with the chat id', () => {
        const onLeaveChat = sinon.spy()
        const messenger = new Messenger({ meId: 9, ownerId: 7, contactIds: [], onLeaveChat } as never)

        try {
            openMemberMenu(messenger, 9)
            menuQuery(messenger, 'member-menu-leave')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

            expect(onLeaveChat.calledOnceWith(5)).to.be.true
            expect(propsOf(messenger).menuTarget).to.be.null
        } finally {
            messenger.destroy()
        }
    })

    it('archived chat: no menu, no + button, no composer — history stays', () => {
        store.set('chats', [{ id: 5, title: 'архив', avatar: '', unread_count: 0, leftAt: '2026-11-01T09:00:00Z' }])
        const onLeaveChat = sinon.spy()
        const messenger = new Messenger({ meId: 7, ownerId: 7, contactIds: [], onLeaveChat } as never)

        try {
            openMemberMenu(messenger, 9)

            // меню не открылось — действий в DOM нет, пропс не тронут
            expect(propsOf(messenger).menuTarget).to.be.null
            const actions = menuActions(messenger)

            expect(actions.addContact).to.not.exist
            expect(actions.kick).to.not.exist
            expect(actions.leave).to.not.exist
            expect(onLeaveChat.called).to.be.false

            // кнопка «+» скрыта, удаление чата остаётся (owner-only на бэке)
            const headerButtons = messenger.element?.querySelector('.messenger__header-buttons-container')

            expect(headerButtons?.querySelector('.cross')).to.not.exist
            expect(headerButtons?.querySelector('.close')).to.exist

            // композер скрыт, история остаётся скроллимой
            expect(messenger.element?.querySelector('.messenger__composer')).to.not.exist
            expect(messenger.element?.querySelector('.messenger__container')).to.exist
        } finally {
            messenger.destroy()
        }
    })

    it('active chat keeps the + button and the composer', () => {
        const messenger = new Messenger({} as never)

        try {
            expect(messenger.element?.querySelector('.messenger__header-buttons-container .cross')).to.exist
            expect(messenger.element?.querySelector('.messenger__composer')).to.exist
        } finally {
            messenger.destroy()
        }
    })

    it('renders a hostile display_name as text (XSS)', () => {
        store.set('chatUsers', [{ id: 11, avatar: '', display_name: '<script>alert(1)</script>' }])
        const messenger = new Messenger({ meId: 7, ownerId: 7, contactIds: [] } as never)

        try {
            openMemberMenu(messenger, 11)

            expect(messenger.element?.querySelector('script')).to.not.exist

            const nameLine = messenger.element?.querySelector('[data-testid="member-menu-name"]')

            expect(nameLine?.innerHTML).to.contain('&lt;script&gt;')

            const menuTitle = nameLine?.closest('[data-testid="modal"]')?.querySelector('[data-testid="modal-title"]')

            expect(menuTitle?.textContent).to.contain('alert(1)')
            expect(menuTitle?.innerHTML).to.contain('&lt;script&gt;')
        } finally {
            messenger.destroy()
        }
    })
})

// Гейт автозагрузки вложений (2026-11-01-settings): мессенджер несёт
// autoDownload из preferences и живо перерисовывает вложения открытого чата
// при переключении тумблера (подписка, не только начальное значение).
describe('messenger attachment auto-download wiring', () => {
    beforeEach(() => {
        store.set('chats', [{ id: 5, title: 'файлы', avatar: '', unread_count: 0 }])
        store.set('messages', {
            5: [{ chat_id: 5, time: 't1', type: 'message', user_id: 7, content: 'файл', file_url: '/api/v1/files/9/download', id: 21 }],
        })
        store.set('selectedChat', 5)
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
    })

    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
        store.set('chats', undefined)
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
    })

    it('renders the inline attachment by default and re-renders on the live toggle', () => {
        const messenger = new Messenger({} as never)

        try {
            expect(messenger.element?.querySelector('.messenger__message-attachment')?.textContent?.trim())
                .to.equal('Вложение')

            setPreference('autoDownload', false)

            const download = messenger.element?.querySelector<HTMLAnchorElement>('[data-testid="attachment-download"]')

            expect(download).to.exist
            expect(download?.getAttribute('href')).to.equal('/api/v1/files/9/download')
            expect(messenger.element?.querySelector('[data-testid="attachment-download"]')?.textContent?.trim())
                .to.equal('Скачать')

            setPreference('autoDownload', true)

            expect(messenger.element?.querySelector('[data-testid="attachment-download"]')).to.not.exist
            expect(messenger.element?.querySelector('.messenger__message-attachment')?.textContent?.trim())
                .to.equal('Вложение')
        } finally {
            messenger.destroy()
        }
    })

    it('starts with the preview suppressed when the preference is already off', () => {
        setPreference('autoDownload', false)

        const messenger = new Messenger({} as never)

        try {
            expect(messenger.element?.querySelector('[data-testid="attachment-download"]')).to.exist
        } finally {
            messenger.destroy()
        }
    })
})
