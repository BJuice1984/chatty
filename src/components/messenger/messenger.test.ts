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
import { pruneComponentCache, registerComponent } from '../../core/registerComponent.ts'
import * as Components from '../components.ts'
import { mapTypedMessages, Messenger, PENDING_TAIL_CACHE_KEY, USER_SEARCH_DEBOUNCE_MS } from './messenger.ts'
import store from '../../utils/Store.ts'
import { fileUrl } from '../../utils/env.ts'
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
    autoDownload?: boolean
    deleteModalOpen?: boolean
    kebabOpen?: boolean
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

    // 2026-11-07-messenger-ux-pack-2: пустое состояние без чатов — вариант
    // «создайте чат» с кнопкой-дублем one-click создания; обычный дисклеймер
    // остаётся при наличии чатов
    it('renders the no-chats create variant and fires onCreateChat from «создать»', () => {
        const onCreateChat = sinon.spy()
        const messenger = new Messenger({ hasNoChats: true, onCreateChat } as never)

        // дисклеймер — сам корневой элемент Messenger (else-ветка шаблона);
        // кнопка «создать» — потомок с testid
        expect(messenger.element?.classList.contains('chat__disclaimer-empty')).to.be.true
        expect(messenger.element?.classList.contains('messenger__empty-hint')).to.be.true
        expect(messenger.element?.querySelector('[data-testid="disclaimer-create"]')).to.be.not.null

        const createButton = messenger.element?.querySelector<HTMLButtonElement>('[data-testid="disclaimer-create"]')

        expect(createButton?.textContent?.trim()).to.eq('создать')

        createButton?.click()

        expect(onCreateChat.calledOnce).to.be.true

        messenger.destroy()
    })

    it('renders the plain disclaimer when chats exist', () => {
        const messenger = new Messenger({} as never)

        expect(messenger.element?.classList.contains('chat__disclaimer')).to.be.true
        expect(messenger.element?.textContent).to.contain('Выберите чат')
        expect(messenger.element?.querySelector('[data-testid="disclaimer-create"]')).to.eq(null)

        messenger.destroy()
    })

    // фикс мигания (2026-11-07): пока список чатов грузится, панель пуста —
    // пустая ветка шаблона компилируется в пустой фрагмент (element null),
    // ни «Выберите чат», ни «создайте чат» не мигают до ответа /chats
    it('renders neither disclaimer variant while the chats list is loading', () => {
        const messenger = new Messenger({ chatsLoading: true } as never)

        expect(messenger.element).to.eq(null)

        messenger.destroy()
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

    // Keyed-кэш Message-инстансов (2026-11-04-bot-wait-offline): мэппер
    // выдаёт ключи переиспользования — реальные сообщения id:<n>, единственный
    // pending-плейсхолдер ленты — фиксированный pending:tail, сообщения без
    // идентичности ключа не получают (инстанс строится каждым рендером)
    it('keys mapped messages: id:<n> for real, pending:tail for the placeholder, none for id-less', () => {
        const typed = mapTypedMessages([
            { chat_id: 1, time: 't1', type: 'message', user_id: 7, content: 'a', id: 5 },
            { chat_id: 1, time: 't2', type: 'message', user_id: -1, content: '…', isPending: true },
            { chat_id: 1, time: 't3', type: 'message', user_id: -1, content: '⚠', isError: true },
        ], 7)

        expect(typed[0]?.cacheKey).to.eq('id:5')
        expect(typed[1]?.cacheKey).to.eq(PENDING_TAIL_CACHE_KEY)
        expect(typed[1]?.cacheKey).to.eq('pending:tail')
        expect(typed[2]?.cacheKey).to.eq(undefined)
    })

    // 2026-11-07-messenger-ux-pack-2: оптимистичная запись своего сообщения
    // получает ключ owntmp:<n> (инстанс живёт от сабмита до эха) и флаг
    // isSending; серверная запись темп-ключ не несёт и isSending не имеет
    it('keys optimistic own entries owntmp:<n> and flags them isSending', () => {
        const typed = mapTypedMessages([
            { chat_id: 1, time: 't1', type: 'message', user_id: 7, content: 'летит', ownTempId: 'tmp-9' },
            { chat_id: 1, time: 't2', type: 'message', user_id: 7, content: 'дошло', id: 77 },
        ], 7)

        expect(typed[0]?.cacheKey).to.eq('owntmp:tmp-9')
        expect(typed[0]?.isSending).to.eq(true)
        expect(typed[1]?.cacheKey).to.eq('id:77')
        expect(typed[1]?.isSending).to.eq(false)
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

    // 2026-11-06-quick: входящее сообщение (WS message -> setProps) раньше
    // стирало набираемый текст пересозданием DOM композера — черновик
    // снимается в componentDidUpdate и возвращается в свежий узел; смена
    // чата черновик не переносит
    it('keeps the composer draft across an incoming-message rerender and drops it on chat switch', () => {
        const messenger = new Messenger({ onSendMessage: () => {} } as never)

        try {
            store.set('messages', { 5: [] })
            store.set('selectedChat', 5)

            const input = () => messenger.element?.querySelector<HTMLInputElement>('input[name="message"]')

            // store-выдача сменила else-ветку на композер: первый рендер с
            // инпутом мог пойти из конструктора базового Block ДО
            // инициализации полей подкласса — value обязан быть пустым, а не
            // строкой «undefined» (регрессия live-бага 2026-11-06)
            expect(input()?.value).to.eq('')

            if (input() != null) {
                input()!.value = 'набираю ответ'
            }

            // входящее сообщение: пропсы меняются — DOM пересобирается
            store.set('messages', {
                5: [{ id: 101, chat_id: 5, user_id: 2, content: 'входящее' }] as never,
            })

            expect(input()?.value).to.eq('набираю ответ')

            // смена чата — черновик не переезжает в другой контекст
            store.set('messages', { 6: [] })
            store.set('selectedChat', 6)

            expect(input()?.value).to.eq('')
        } finally {
            messenger.destroy()
        }
    })

    it('blocks the composer while the bot run is pending and frees it after', () => {
        const onSendMessage = sinon.spy()
        const messenger = new Messenger({ onSendMessage } as never)

        try {
            store.set('chats', [{ id: 5, title: 'ai', avatar: '', unread_count: 0, is_ai: true }] as never)
            store.set('messages', { 5: [{ chat_id: 5, time: 't1', type: 'message', user_id: 2, content: '?', isPending: true }] })
            store.set('selectedChat', 5)

            submitComposer(messenger, 'второе')

            const form = messenger.element?.querySelector<HTMLFormElement>('[data-testid="composer-form"]')
            const input = form?.querySelector<HTMLInputElement>('input[name="message"]')

            expect(onSendMessage.called).to.be.false
            expect(input?.value).to.eq('второе')
            expect(form?.querySelector('button[type="submit"]')?.hasAttribute('disabled')).to.be.true

            // разблокировка — реальным путём: стор снял pending-плейсхолдер
            store.set('messages', { 5: [{ chat_id: 5, time: 't1', type: 'message', user_id: 2, content: '?', id: 31 }] })

            const freedForm = messenger.element?.querySelector<HTMLFormElement>('[data-testid="composer-form"]')
            const freedButton = freedForm?.querySelector<HTMLButtonElement>('button[type="submit"]')

            expect(freedButton?.hasAttribute('disabled')).to.be.false

            submitComposer(messenger, 'третье')

            expect(onSendMessage.calledOnceWith(5, 'третье')).to.be.true
        } finally {
            store.set('chats', undefined)
            messenger.destroy()
        }
    })

    // NEXT п.3 (2026-11-09): store-эмит (эхо своего, входящее, bot_delta)
    // пересоздаёт DOM композера — фокус и каретка снимаются в
    // componentDidUpdate и возвращаются в свежий узел
    it('keeps the composer focus and caret across an incoming-message rerender', async () => {
        const messenger = new Messenger({ onSendMessage: () => {} } as never)

        try {
            const mount = messenger.element as Node
            document.body.appendChild(mount)
            store.set('messages', { 5: [] })
            store.set('selectedChat', 5)

            const input = messenger.element?.querySelector<HTMLInputElement>('input[name="message"]')

            input?.focus()
            if (input != null) {
                input.value = 'набираю ответ'
                input.setSelectionRange(3, 3)
            }
            expect(document.activeElement).to.equal(input)

            // входящее сообщение: пропсы меняются — DOM пересобирается
            store.set('messages', {
                5: [{ id: 101, chat_id: 5, user_id: 2, content: 'входящее' }] as never,
            })

            await new Promise(resolve => setTimeout(resolve, 10))

            const revived = messenger.element?.querySelector<HTMLInputElement>('input[name="message"]')

            expect(revived?.value).to.eq('набираю ответ')
            expect(document.activeElement).to.equal(revived)
            expect([revived?.selectionStart, revived?.selectionEnd]).to.deep.eq([3, 3])
        } finally {
            messenger.element?.remove()
            messenger.destroy()
            store.set('selectedChat', null)
            store.set('messages', undefined)
        }
    })

    it('does not steal focus on a rerender when the composer was not focused', async () => {
        const messenger = new Messenger({ onSendMessage: () => {} } as never)

        try {
            const mount = messenger.element as Node
            document.body.appendChild(mount)
            store.set('messages', { 5: [] })
            store.set('selectedChat', 5)

            const input = messenger.element?.querySelector<HTMLInputElement>('input[name="message"]')

            input?.blur()

            store.set('messages', {
                5: [{ id: 102, chat_id: 5, user_id: 2, content: 'входящее' }] as never,
            })

            await new Promise(resolve => setTimeout(resolve, 10))

            const revived = messenger.element?.querySelector<HTMLInputElement>('input[name="message"]')

            expect(document.activeElement).to.not.equal(revived)
        } finally {
            messenger.element?.remove()
            messenger.destroy()
            store.set('selectedChat', null)
            store.set('messages', undefined)
        }
    })

    it('restores the composer input focus after a send (rAF after rerender)', async () => {
        // отправка пишет в стор — лента перерисовывается и пересоздаёт DOM
        // композера; фокус возвращается в следующем кадре (2026-11-02)
        const messenger = new Messenger({ onSendMessage: sinon.spy() } as never)

        try {
            // focus() двигает activeElement только у смонтированных узлов
            const mount = messenger.element as Node
            document.body.appendChild(mount)
            store.set('messages', { 5: [] })
            store.set('selectedChat', 5)

            submitComposer(messenger, 'привет')

            await new Promise(resolve => setTimeout(resolve, 10))

            const input = messenger.element?.querySelector<HTMLInputElement>('input[name="message"]')

            expect(input?.value).to.equal('')
            expect(document.activeElement).to.equal(input)
        } finally {
            messenger.element?.remove()
            messenger.destroy()
            store.set('selectedChat', null)
            store.set('messages', undefined)
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

    // Автофокус модалки (2026-11-02-ui-ux): открытие сразу фокусирует поле и
    // не тащит черновой запрос прошлого сеанса; полная очистка текста
    // возвращает фокус с кареткой — пользователь продолжает печатать
    it('focuses the search input on open and clears the stale query', async () => {
        const messenger = new Messenger({} as never)

        try {
            document.body.appendChild(messenger.element as HTMLElement)

            // черновой запрос прошлого сеанса не должен попасть в новый
            messenger.setProps({ addUserOpen: true, addUserQuery: 'старое', addUserResults: [] })
            messenger.setProps({ addUserOpen: false })

            openAddUser(messenger)

            // фокус — в следующем кадре (перерисовка должна сойти)
            await new Promise(resolve => setTimeout(resolve, 20))

            const input = messenger.element?.querySelector<HTMLInputElement>('[data-testid="user-search-input"]')

            expect(input?.value).to.equal('')
            expect(input).to.equal(document.activeElement)
        } finally {
            messenger.element?.remove()
            messenger.destroy()
        }
    })

    it('keeps focus in the input after the text is fully cleared', async () => {
        const messenger = new Messenger({} as never)

        try {
            document.body.appendChild(messenger.element as HTMLElement)

            openAddUser(messenger)

            await new Promise(resolve => setTimeout(resolve, 20))

            const input = messenger.element?.querySelector<HTMLInputElement>('[data-testid="user-search-input"]')

            input!.value = 'ab'
            input!.dispatchEvent(new MouseEvent('input', { bubbles: true }))

            // полная очистка: немедленная перерисовка пересоздаёт инпут —
            // фокус обязан вернуться
            input!.value = ''
            input!.dispatchEvent(new MouseEvent('input', { bubbles: true }))

            await new Promise(resolve => setTimeout(resolve, 20))

            const revived = messenger.element?.querySelector<HTMLInputElement>('[data-testid="user-search-input"]')

            expect(revived?.value).to.equal('')
            expect(revived).to.equal(document.activeElement)
        } finally {
            messenger.element?.remove()
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

    it('dims the avatar of a departed member (archived membership, left_at)', () => {
        store.set('chatUsers', [
            { id: 1, display_name: 'active', avatar: '' },
            { id: 2, display_name: 'gone', avatar: '', left_at: '2026-11-05T10:00:00Z' },
        ])
        const messenger = new Messenger({} as never)

        try {
            const active = messenger.element?.querySelector('[data-testid="chat-user-avatar"][data-user-id="1"]')
            const gone = messenger.element?.querySelector('[data-testid="chat-user-avatar"][data-user-id="2"]')

            expect(active?.classList.contains('chat__container-profile-chat-ava_archived')).to.be.false
            expect(gone?.classList.contains('chat__container-profile-chat-ava_archived')).to.be.true
        } finally {
            messenger.destroy()
            store.set('chatUsers', undefined)
        }
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

            expect(headerButtons?.querySelector('img[alt="Иконка. Добавить пользователей"]')).to.not.exist
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
            expect(messenger.element?.querySelector('.messenger__header-buttons-container img[alt="Иконка. Добавить пользователей"]')).to.exist
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

// Вложения ленты (2026-11-02-ui-ux): маппинг строит attachments для каждого
// сообщения с файлом — в AI-чате входящие (ответы бота) несут МОК-список
// найденных документов (bot-attachments.mock.ts, первый пункт — реальное
// имя файла, когда контракт его несёт), свои и обычные чаты — один пункт с
// фолбэком «Файл» (file.filename в рантайме не наполняется). autoDownload
// из preferences по-прежнему приезжает пропсом (зарезервирован под будущие
// превью) и живая подписка перерисовывает ленту — рендер от него не зависит.
describe('messenger attachment file lists', () => {
    const openChat = (isAi: boolean, message: Record<string, unknown>) => {
        store.set('chats', [{ id: 5, title: 'чат', avatar: '', unread_count: 0, ...(isAi ? { is_ai: true } : {}) }])
        store.set('messages', { 5: [message] })
        store.set('user', { id: 7, display_name: 'bob', first_name: '', second_name: '', login: 'bob@chatty.local', email: 'bob@chatty.local', phone: '', avatar: '', send_read_receipts: true })
        store.set('selectedChat', 5)
    }

    beforeEach(() => {
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
    })

    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
        store.set('chats', undefined)
        store.set('user', undefined)
        window.localStorage.removeItem('chatty-preferences')
        initPreferences()
    })

    it('an AI-chat bot answer renders its single real attachment (mock list removed)', () => {
        openChat(true, {
            chat_id: 5, time: 't1', type: 'message', user_id: 42, content: 'вот документ',
            file_url: '/api/v1/files/9/download', id: 21,
            file: { id: 9, user_id: 42, path: 'x', filename: 'Ответ ассистента.pdf', content_type: 'application/pdf', content_size: 1, upload_date: 't' },
        })

        const messenger = new Messenger({} as never)

        try {
            const rows = [...(messenger.element?.querySelectorAll('[data-testid="message-file"]') ?? [])]

            expect(rows).to.have.length(1)
            expect(rows[0].querySelector('.messenger__message-file-name')?.textContent?.trim())
                .to.equal('Ответ ассистента.pdf')
            expect(rows[0].querySelector<HTMLAnchorElement>('[data-testid="attachment-download"]')?.getAttribute('href'))
                .to.equal('/api/v1/files/9/download')
        } finally {
            messenger.destroy()
        }
    })

    it('renders a ready-made bot document list as-is with per-extension icons', () => {
        openChat(true, {
            chat_id: 5, time: 't1', type: 'message', user_id: 42, content: 'найдено',
            file_url: '/api/v1/files/9/download', id: 21,
            attachments: [
                { name: 'Заявление на отпуск.pdf', url: '/api/v1/files/5/download' },
                { name: 'Бюджет отдела 2026.xlsx', url: '/api/v1/files/6/download' },
            ],
        })

        const messenger = new Messenger({} as never)

        try {
            const rows = [...(messenger.element?.querySelectorAll('[data-testid="message-file"]') ?? [])]

            expect(rows).to.have.length(2)
            expect(rows[0].querySelector('.messenger__message-file-name')?.textContent?.trim())
                .to.equal('Заявление на отпуск.pdf')
            expect(rows[1].querySelector('.messenger__message-file-name')?.textContent?.trim())
                .to.equal('Бюджет отдела 2026.xlsx')
            expect(rows[0].querySelector('.messenger__message-file-icon')?.getAttribute('src')).to.contain('file-pdf.svg')
            expect(rows[1].querySelector('.messenger__message-file-icon')?.getAttribute('src')).to.contain('file-xlsx.svg')
            expect(rows[1].querySelector<HTMLAnchorElement>('[data-testid="attachment-download"]')?.getAttribute('href'))
                .to.equal('/api/v1/files/6/download')
        } finally {
            messenger.destroy()
        }
    })

    it('an own message in an AI chat renders a single real item, not the mock list', () => {
        openChat(true, { chat_id: 5, time: 't1', type: 'message', user_id: 7, content: 'мой файл', file_url: '/api/v1/files/9/download', id: 21 })

        const messenger = new Messenger({} as never)

        try {
            const rows = messenger.element?.querySelectorAll('[data-testid="message-file"]')

            expect(rows).to.have.length(1)
            expect(messenger.element?.querySelector('.messenger__message-file-name')?.textContent?.trim())
                .to.equal('Файл')
        } finally {
            messenger.destroy()
        }
    })

    it('a non-AI chat renders a single item for a file message and none without a file', () => {
        openChat(false, { chat_id: 5, time: 't1', type: 'message', user_id: 7, content: 'файл', file_url: '/api/v1/files/9/download', id: 21 })

        const withFile = new Messenger({} as never)

        try {
            expect(withFile.element?.querySelectorAll('[data-testid="message-file"]')).to.have.length(1)
        } finally {
            withFile.destroy()
        }

        openChat(false, { chat_id: 5, time: 't2', type: 'message', user_id: 7, content: 'текст', id: 22 })

        const withoutFile = new Messenger({} as never)

        try {
            expect(withoutFile.element?.querySelector('[data-testid="message-files"]')).to.not.exist
        } finally {
            withoutFile.destroy()
        }
    })

    it('the autoDownload preference keeps flowing as a prop through the live subscription', () => {
        openChat(false, { chat_id: 5, time: 't1', type: 'message', user_id: 7, content: 'файл', file_url: '/api/v1/files/9/download', id: 21 })

        const messenger = new Messenger({} as never)

        try {
            expect(propsOf(messenger).autoDownload).to.equal(true)

            setPreference('autoDownload', false)

            expect(propsOf(messenger).autoDownload).to.equal(false)
            expect(messenger.element?.querySelectorAll('[data-testid="message-file"]')).to.have.length(1)
        } finally {
            messenger.destroy()
        }
    })
})

// Keyed-кэш Message-инстансов (2026-11-04-bot-wait-offline): повторный
// рендер с тем же cacheKey переиспользует живой инстанс (тот же
// component.id, обновление через setProps, embed переносит существующий
// элемент), prune уничтожает и выметает ключи, ушедшие из ленты (смена
// чата, удаление сообщения) — кэш не растёт неограниченно
describe('messenger message instance cache', () => {
    beforeEach(() => {
        store.set('messages', { 5: [] })
        store.set('selectedChat', 5)
    })

    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
    })

    const dto = (id: number, content: string, variant = ''): Message => ({
        chat_id: 5, time: `t${id}${variant}`, type: 'message', user_id: 7, content, id,
    })

    // Счётчик ПОСТРОЕНИЯ Message-инстансов: init стреляет ровно один раз из
    // конструктора Block (пустой в базе); count — чистое чтение, restore
    // снимает патч прототипа (в конце теста)
    function trackMessageConstructions(): { count: () => number, restore: () => void } {
        const proto = Components.Message.prototype as unknown as Record<string, () => void>
        let count = 0

        // eslint-disable-next-line func-names
        proto.init = function () {
            count += 1
        }

        return {
            count: () => count,
            restore: () => {
                delete proto.init
            },
        }
    }

    // Прямой вызов зарегистрированного хелпера Message: возвращает встроенный
    // в root.__children инстанс — наблюдаемая точка кэша вне рендера ленты
    const invokeMessageHelper = (cacheKey: string | undefined, content: string) => {
        const root: { __children?: { component: Block }[] } = {}
        const helper = Handlebars.helpers.Message as unknown as (options: {
            hash: Record<string, unknown>
            data: { root: { __children?: { component: Block }[] } }
        }) => string

        helper({
            hash: { cacheKey, content, user_id: 7, chat_id: 5, time: 't' },
            data: { root },
        })

        const component = root.__children?.[root.__children.length - 1]?.component

        if (component == null) {
            throw new Error('хелпер Message не встроил инстанс')
        }

        return component
    }

    it('reuses the instance for a repeated cacheKey and refreshes it via setProps', () => {
        const first = invokeMessageHelper('id:901', 'первый')
        const reused = invokeMessageHelper('id:901', 'обновлённый')

        // Тот же инстанс (тот же component.id), контент приехал setProps-ом
        expect(reused).to.equal(first)
        expect(reused.id).to.eq(first.id)
        expect((reused as unknown as { props: { content?: string } }).props.content).to.eq('обновлённый')

        // Другой ключ — другой инстанс; без ключа кэш не участвует вовсе
        const other = invokeMessageHelper('id:902', 'второй')

        expect(other.id).to.not.eq(first.id)

        const unkeyedA = invokeMessageHelper(undefined, 'x')
        const unkeyedB = invokeMessageHelper(undefined, 'x')

        expect(unkeyedA.id).to.not.eq(unkeyedB.id)

        // Гигиена: тестовые ключи не остаются в общем кэше
        pruneComponentCache(new Set())
    })

    it('prune destroys and drops keys that left the feed, a pruned key reconstructs', () => {
        const departed = invokeMessageHelper('id:911', 'ушёл')
        const stays = invokeMessageHelper('id:912', 'остался')

        pruneComponentCache(new Set(['id:912']))

        // Ключа нет в живом множестве — запись уничтожена и выметана
        expect((departed as unknown as { element: HTMLElement | null }).element).to.be.null
        expect((stays as unknown as { element: HTMLElement | null }).element).to.not.be.null

        // Выметанный ключ строится заново — это новый инстанс
        const revived = invokeMessageHelper('id:911', 'восстановленный')

        expect(revived.id).to.not.eq(departed.id)

        pruneComponentCache(new Set())
    })

    it('reuses live instances across store re-renders and constructs only newcomers', () => {
        const constructed = trackMessageConstructions()
        const messenger = new Messenger({} as never)

        store.set('messages', { 5: [dto(1, 'alpha'), dto(2, 'beta')] })
        expect(constructed.count()).to.eq(2)

        // Та же лента новой записью в сторе: перерисовка была, построений нет
        store.set('messages', { 5: [dto(1, 'alpha', 'v2'), dto(2, 'beta', 'v2')] })
        expect(constructed.count()).to.eq(2)

        // Хвост вырос: построен только новичок
        store.set('messages', { 5: [dto(1, 'alpha', 'v3'), dto(2, 'beta', 'v3'), dto(3, 'gamma')] })
        expect(constructed.count()).to.eq(3)

        // Контент обновился через setProps переиспользованного инстанса
        store.set('messages', { 5: [dto(1, 'ALPHA', 'v4'), dto(2, 'beta', 'v4'), dto(3, 'gamma', 'v4')] })
        expect(constructed.count()).to.eq(3)
        expect(messenger.element?.textContent).to.contain('ALPHA')

        // Сообщение удалено: prune уничтожил осевшую запись, новых построек нет
        store.set('messages', { 5: [dto(2, 'beta', 'v5'), dto(3, 'gamma', 'v5')] })
        expect(constructed.count()).to.eq(3)
        expect(messenger.element?.textContent).to.not.contain('ALPHA')

        constructed.restore()
        messenger.destroy()
    })

    it('reuses the single bot placeholder under the fixed pending:tail key', () => {
        const constructed = trackMessageConstructions()
        const messenger = new Messenger({} as never)

        const pendingDto = (variant = ''): Message => ({
            chat_id: 5, time: `tp${variant}`, type: 'message', user_id: -1,
            content: 'Ассистент печатает…', isPending: true,
        })

        store.set('messages', { 5: [dto(1, 'вопрос'), pendingDto()] })
        expect(constructed.count()).to.eq(2)
        expect(messenger.element?.querySelector('.messenger__message-bubble_pending')).to.exist

        // Плейсхолдер перезаписан в сторе (новая запись ленты) — тот же инстанс
        store.set('messages', { 5: [dto(1, 'вопрос', 'v2'), pendingDto('v2')] })
        expect(constructed.count()).to.eq(2)

        // Ответ приехал: pending:tail ушёл из ленты — prune уничтожил запись,
        // финальное сообщение построено под своим ключом id:<n>
        store.set('messages', { 5: [dto(1, 'вопрос', 'v3'), dto(2, 'ответ')] })
        expect(constructed.count()).to.eq(3)
        expect(messenger.element?.querySelector('.messenger__message-bubble_pending')).to.not.exist
        expect(messenger.element?.textContent).to.contain('ответ')

        constructed.restore()
        messenger.destroy()
    })
})


// 2026-11-05-messenger-ux-pack: inline-переименование заголовка (двойной
// клик -> инпут; Enter/Escape/клик вне сохраняют; пустое — тихий откат) и
// аватарный слот шапки (owner-only, не в архивном чате)
describe('messenger inline rename and header avatar', () => {
    const seedChat = (extra: Record<string, unknown> = {}) => {
        store.set('chats', [{ id: 5, title: 'Старое название', avatar: 'a.png', unread_count: 0, ...extra }] as never)
        store.set('messages', { 5: [] })
        store.set('selectedChat', 5)
    }

    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
        store.set('chats', undefined)
    })

    function view(): Window & typeof globalThis {
        return (document.defaultView ?? globalThis) as Window & typeof globalThis
    }

    function dblclickTitle(messenger: InstanceType<typeof Messenger>): void {
        messenger.element
            ?.querySelector('[data-testid="chat-title"]')
            ?.dispatchEvent(new (view().MouseEvent)('dblclick', { bubbles: true }))
    }

    function titleInput(messenger: InstanceType<typeof Messenger>): HTMLInputElement | null {
        return messenger.element?.querySelector<HTMLInputElement>('[data-testid="chat-title-input"]') ?? null
    }

    it('dblclick swaps the title for an input in a non-archived chat', () => {
        const messenger = new Messenger({} as never)

        try {
            seedChat()

            expect(titleInput(messenger)).to.be.null

            dblclickTitle(messenger)

            expect(titleInput(messenger)).to.not.be.null
        } finally {
            messenger.destroy()
        }
    })

    it('Enter commits a changed value through onRenameChat and closes the input', () => {
        const onRenameChat = sinon.spy()
        const messenger = new Messenger({ onRenameChat } as never)

        try {
            seedChat()
            dblclickTitle(messenger)

            const input = titleInput(messenger)

            if (input != null) {
                input.value = 'Новое название'
            }

            input?.dispatchEvent(new (view().KeyboardEvent)('keydown', { key: 'Enter', bubbles: true }))

            expect(onRenameChat.calledOnceWith(5, 'Новое название')).to.be.true
            expect(titleInput(messenger)).to.be.null
        } finally {
            messenger.destroy()
        }
    })

    it('Escape SAVES too (operator decision), focus-out commits as well', () => {
        const onRenameChat = sinon.spy()
        const messenger = new Messenger({ onRenameChat } as never)

        try {
            seedChat()
            dblclickTitle(messenger)

            const input = titleInput(messenger)

            if (input != null) {
                input.value = 'Сохранено по Escape'
            }

            input?.dispatchEvent(new (view().KeyboardEvent)('keydown', { key: 'Escape', bubbles: true }))

            expect(onRenameChat.calledOnceWith(5, 'Сохранено по Escape')).to.be.true

            // focus-out — тот же коммит
            dblclickTitle(messenger)

            const second = titleInput(messenger)

            if (second != null) {
                second.value = 'Сохранено по клику вне'
            }

            second?.dispatchEvent(new (view().FocusEvent)('focusout', { bubbles: true }))

            expect(onRenameChat.calledTwice).to.be.true
        } finally {
            messenger.destroy()
        }
    })

    it('plain typing neither commits nor closes the input (review TF-1 regression)', () => {
        const onRenameChat = sinon.spy()
        const messenger = new Messenger({ onRenameChat } as never)

        try {
            seedChat()
            dblclickTitle(messenger)

            const input = titleInput(messenger)

            if (input != null) {
                input.value = 'Нов'
            }

            // обычная клавиша набора проходит в инпут: редактор жив,
            // коммита нет (прежний код коммитил на любой клавише кроме Tab)
            input?.dispatchEvent(new (view().KeyboardEvent)('keydown', { key: 'н', bubbles: true }))
            input?.dispatchEvent(new (view().KeyboardEvent)('keydown', { key: 'Backspace', bubbles: true }))

            expect(onRenameChat.called).to.be.false
            expect(titleInput(messenger)).to.not.be.null
        } finally {
            messenger.destroy()
        }
    })

    it('title carries the ellipsis structure hook (min-width:0 flex target, review TF-4)', async () => {
        const messenger = new Messenger({} as never)

        try {
            seedChat()

            const title = messenger.element?.querySelector('[data-testid="chat-title"]')

            expect(title?.classList.contains('messenger__header-title')).to.be.true

            // class-level пин: правило эллипсиса живёт в messenger.scss
            // (jsdom не считает layout — проверяем источник стиля)
            const { readFileSync } = await import('node:fs')
            const scss = readFileSync('src/scss/components/messenger.scss', 'utf-8')
            const titleRule = scss.slice(scss.indexOf('&__header-title'), scss.indexOf('&__header-title-input'))

            expect(titleRule).to.contain('min-width: 0')
            expect(titleRule).to.contain('text-overflow: ellipsis')
        } finally {
            messenger.destroy()
        }
    })

    it('an empty trimmed value silently reverts without a rename call', () => {
        const onRenameChat = sinon.spy()
        const messenger = new Messenger({ onRenameChat } as never)

        try {
            seedChat()
            dblclickTitle(messenger)

            const input = titleInput(messenger)

            if (input != null) {
                input.value = '   '
            }

            input?.dispatchEvent(new (view().KeyboardEvent)('keydown', { key: 'Enter', bubbles: true }))

            expect(onRenameChat.called).to.be.false
            expect(titleInput(messenger)).to.be.null
        } finally {
            messenger.destroy()
        }
    })

    it('an archived chat never offers the rename input', () => {
        const messenger = new Messenger({} as never)

        try {
            seedChat({ leftAt: '2026-11-01T10:00:00Z' })

            dblclickTitle(messenger)

            expect(titleInput(messenger)).to.be.null
        } finally {
            messenger.destroy()
        }
    })

    it('header avatar slot: editable modifier only for the owner of a non-archived chat', () => {
        // meId/ownerId приходят пропсами от страницы (chat.hbs) — в тесте
        // двигаем их setProps'ом, как это делает withStore в проде
        const messenger = new Messenger({ meId: 42, ownerId: 7 } as never)

        try {
            seedChat({ owner_id: 7 })

            const slot = () => messenger.element?.querySelector('[data-testid="chat-avatar-slot"]')

            // не владелец: слот есть, аффорданса нет
            expect(slot()).to.exist
            expect(slot()?.classList.contains('messenger__header-avatar_editable')).to.be.false

            // владелец активного чата: аффорданс появляется
            messenger.setProps({ meId: 7 })

            expect(slot()?.classList.contains('messenger__header-avatar_editable')).to.be.true

            // владелец, но архивный чат: read-only
            store.set('chats', [{ id: 5, title: 'Архив', avatar: 'a.png', unread_count: 0, owner_id: 7, leftAt: '2026-11-01T10:00:00Z' }] as never)

            expect(slot()?.classList.contains('messenger__header-avatar_editable')).to.be.false
        } finally {
            messenger.destroy()
        }
    })
})

// 2026-11-06-chat-create-flow: авто-название — заголовок сразу инпут;
// подсказка пустого чата — гейт по данным; «+AI» — состояния и клик
describe('messenger auto-title input, empty hint and +AI button', () => {
    const seedChat = (extra: Record<string, unknown> = {}) => {
        store.set('chats', [{ id: 5, title: 'Чат с', avatar: 'a.png', unread_count: 0, ...extra }] as never)
        store.set('messages', { 5: [] })
        store.set('selectedChat', 5)
        store.set('chatUsers', [])
    }

    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
        store.set('chats', undefined)
        store.set('chatUsers', undefined)
    })

    function view(): Window & typeof globalThis {
        return (document.defaultView ?? globalThis) as Window & typeof globalThis
    }

    function titleInput(messenger: InstanceType<typeof Messenger>): HTMLInputElement | null {
        return messenger.element?.querySelector<HTMLInputElement>('[data-testid="chat-title-input"]') ?? null
    }

    function hint(messenger: InstanceType<typeof Messenger>): HTMLElement | null {
        return messenger.element?.querySelector<HTMLElement>('[data-testid="empty-chat-hint"]') ?? null
    }

    function aiButton(messenger: InstanceType<typeof Messenger>): HTMLElement | null {
        return messenger.element?.querySelector<HTMLElement>('.messenger__header-buttons-container .ai') ?? null
    }

    function keydownEnter(node: Element): void {
        node.dispatchEvent(new (view().KeyboardEvent)('keydown', { key: 'Enter', bubbles: true }))
    }

    it('an auto-titled chat renders the title as an immediate input (no dblclick)', () => {
        const messenger = new Messenger({} as never)

        try {
            seedChat({ auto_titled: true })

            expect(titleInput(messenger)).to.not.be.null
            expect(titleInput(messenger)?.value).to.eq('Чат с')
        } finally {
            messenger.destroy()
        }
    })

    it('a manual commit on the auto-title input fires onRenameChat; empty reverts silently', () => {
        const onRenameChat = sinon.spy()
        const messenger = new Messenger({ onRenameChat } as never)

        try {
            seedChat({ auto_titled: true })

            const input = titleInput(messenger)

            if (input != null) {
                input.value = 'Проект X'
            }

            keydownEnter(input as Element)

            expect(onRenameChat.calledOnceWith(5, 'Проект X')).to.be.true

            // пустое значение — тихий откат: вызова нет, авто-инпут жив
            const cleared = titleInput(messenger)

            if (cleared != null) {
                cleared.value = '   '
            }

            keydownEnter(cleared as Element)

            expect(onRenameChat.calledOnce).to.be.true
            expect(titleInput(messenger)).to.not.be.null
        } finally {
            messenger.destroy()
        }
    })

    it('a non-auto-titled chat keeps the static h2; an archived auto-titled chat gets no input', () => {
        const plain = new Messenger({} as never)

        try {
            seedChat()

            expect(titleInput(plain)).to.be.null

            seedChat({ auto_titled: true, leftAt: '2026-11-01T10:00:00Z' })

            expect(titleInput(plain)).to.be.null
        } finally {
            plain.destroy()
        }
    })

    it('the empty hint shows only with no messages, no co-members, not archived and not AI', () => {
        const messenger = new Messenger({} as never)

        try {
            seedChat()

            expect(hint(messenger)).to.not.be.null

            // есть соучастник — подсказки нет
            store.set('chatUsers', [{ id: 9, avatar: '', display_name: 'Боб' }] as never)

            expect(hint(messenger)).to.be.null

            store.set('chatUsers', [])
            // AI-чат — подсказки нет
            store.set('chats', [{ id: 5, title: 'Чат с', avatar: 'a.png', unread_count: 0, is_ai: true }] as never)

            expect(hint(messenger)).to.be.null

            // архивный — подсказки нет
            store.set('chats', [{ id: 5, title: 'Чат с', avatar: 'a.png', unread_count: 0, leftAt: '2026-11-01T10:00:00Z' }] as never)

            expect(hint(messenger)).to.be.null

            // появилось сообщение — подсказки нет
            store.set('chats', [{ id: 5, title: 'Чат с', avatar: 'a.png', unread_count: 0 }] as never)
            store.set('messages', { 5: [{ chat_id: 5, time: 't1', type: 'message', user_id: 1, content: 'привет' }] })

            expect(hint(messenger)).to.be.null
        } finally {
            messenger.destroy()
        }
    })

    it('the «добавить» button of the hint opens the add-user modal', () => {
        const messenger = new Messenger({} as never)

        try {
            seedChat()

            // в тексте подсказки — иконка кнопки «+» шапки (один svg-образ
            // на оба места, узор кнопки «Создать чат»)
            expect(hint(messenger)?.querySelector('img.chat__disclaimer-icon[src="/images/add-user-icon.svg"]')).to.not.be.null

            const button = messenger.element?.querySelector<HTMLElement>('[data-testid="empty-chat-add"]')

            button?.dispatchEvent(new (view().MouseEvent)('click', { bubbles: true }))

            expect(messenger.element?.querySelector('[data-testid="user-search-input"]')).to.not.be.null
        } finally {
            messenger.destroy()
        }
    })

    it('+AI: click fires onEnableAi; the active AI button fires onDisableAi', () => {
        const onEnableAi = sinon.spy()
        const onDisableAi = sinon.spy()
        const messenger = new Messenger({ onEnableAi, onDisableAi } as never)

        try {
            seedChat()

            const button = aiButton(messenger)

            button?.dispatchEvent(new (view().MouseEvent)('click', { bubbles: true }))

            expect(onEnableAi.calledOnceWith(5)).to.be.true

            store.set('chats', [{ id: 5, title: 'Чат с', avatar: 'a.png', unread_count: 0, is_ai: true }] as never)

            const active = aiButton(messenger)

            expect(active?.classList.contains('ai_active')).to.be.true

            // активная кнопка ВЫКЛЮЧАЕТ бота (2026-11-07): onDisableAi
            // уходит, повторного onEnableAi нет
            active?.dispatchEvent(new (view().MouseEvent)('click', { bubbles: true }))

            expect(onDisableAi.calledOnceWith(5)).to.be.true
            expect(onEnableAi.calledOnce).to.be.true
        } finally {
            messenger.destroy()
        }
    })

    it('an archived chat shows neither +AI nor the cross button', () => {
        const messenger = new Messenger({} as never)

        try {
            seedChat({ leftAt: '2026-11-01T10:00:00Z' })

            expect(aiButton(messenger)).to.be.null
            expect(messenger.element?.querySelector('.messenger__header-buttons-container img[alt="Иконка. Добавить пользователей"]')).to.be.null
        } finally {
            messenger.destroy()
        }
    })
})

// 2026-11-08-mobile-messenger-ux: кебаб-меню мобильной шапки — те же
// действия, что ряд иконок (дескрипторы с actionId/menuLabel), и
// свайп-возврат к списку чатов с гвардом открытых модалок (review F-4)
describe('messenger mobile kebab menu', () => {
    beforeEach(() => {
        store.set('chats', [{ id: 5, title: 'рабочий чат', avatar: '', unread_count: 0, owner_id: 7 }])
        store.set('chatUsers', [{ id: 7, avatar: '', display_name: 'Я' }])
        store.set('messages', { 5: [] })
        store.set('selectedChat', 5)
    })

    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
        store.set('chatUsers', undefined)
        store.set('chats', undefined)
    })

    const kebabOf = (messenger: { element?: Element | null }) =>
        messenger.element?.querySelector<HTMLButtonElement>('[data-testid="header-kebab"]')

    const clickAction = (messenger: { element?: Element | null }, actionId: string) =>
        messenger.element?.querySelector(`[data-testid="chat-action-${actionId}"]`)
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    it('the kebab and the desktop icon row coexist in DOM (CSS-only visibility)', () => {
        const messenger = new Messenger({} as never)

        try {
            expect(messenger.element?.querySelector('.messenger__header-buttons-container')).to.exist
            expect(kebabOf(messenger)).to.exist
        } finally {
            messenger.destroy()
        }
    })

    it('kebab opens the menu; entries fire the same callbacks as the header icons', () => {
        const onEnableAi = sinon.spy()
        const messenger = new Messenger({ onEnableAi } as never)

        try {
            kebabOf(messenger)?.click()

            const modal = messenger.element?.querySelector('[data-testid="modal"][aria-hidden="false"]')

            expect(modal).to.exist

            const labels = Array.from(messenger.element?.querySelectorAll('[data-testid^="chat-action-"]') ?? [])
                .map(node => (node as HTMLElement).textContent?.trim())

            expect(labels).to.include('Включить AI')
            expect(labels).to.include('Добавить пользователей')
            expect(labels).to.include('Удалить чат')
            expect(labels).to.include('Отмена')

            clickAction(messenger, 'ai')
            expect(onEnableAi.calledOnceWith(5)).to.be.true
            expect(propsOf(messenger).kebabOpen).to.eq(false)

            kebabOf(messenger)?.click()
            clickAction(messenger, 'add-user')
            expect(propsOf(messenger).addUserOpen).to.eq(true)

            kebabOf(messenger)?.click()
            clickAction(messenger, 'delete')
            expect(propsOf(messenger).deleteModalOpen).to.eq(true)
        } finally {
            messenger.destroy()
        }
    })

    it('cancel closes the menu without firing actions', () => {
        const onEnableAi = sinon.spy()
        const messenger = new Messenger({ onEnableAi } as never)

        try {
            kebabOf(messenger)?.click()
            clickAction(messenger, 'cancel')

            expect(propsOf(messenger).kebabOpen).to.eq(false)
            expect(onEnableAi.called).to.be.false
        } finally {
            messenger.destroy()
        }
    })

    it('archived chat: the menu carries no add-user entry, delete stays', () => {
        store.set('chats', [{ id: 5, title: 'архив', avatar: '', unread_count: 0, owner_id: 7, leftAt: '2026-11-01T09:00:00Z' }])
        const messenger = new Messenger({} as never)

        try {
            kebabOf(messenger)?.click()

            expect(messenger.element?.querySelector('[data-testid="chat-action-add-user"]')).to.not.exist
            expect(messenger.element?.querySelector('[data-testid="chat-action-delete"]')).to.exist
        } finally {
            messenger.destroy()
        }
    })
})

describe('messenger pane swipe back', () => {
    beforeEach(() => {
        store.set('chats', [{ id: 5, title: 'рабочий чат', avatar: '', unread_count: 0, owner_id: 7 }])
        store.set('chatUsers', [{ id: 7, avatar: '', display_name: 'Я' }])
        store.set('messages', { 5: [] })
        store.set('selectedChat', 5)
    })

    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
        store.set('chatUsers', undefined)
        store.set('chats', undefined)
    })

    const touchOn = (element: Element, type: 'touchstart' | 'touchend', x: number, y: number) => {
        const event = new window.Event(type, { bubbles: true, cancelable: true })

        Object.defineProperty(event, 'changedTouches', { value: [{ clientX: x, clientY: y }], configurable: true })
        element.dispatchEvent(event)
    }

    it('a right swipe returns through onBack (the same path as the back button)', () => {
        const onBack = sinon.spy()
        const messenger = new Messenger({ onBack } as never)

        try {
            touchOn(messenger.element!, 'touchstart', 0, 0)
            touchOn(messenger.element!, 'touchend', 120, 10)

            expect(onBack.calledOnce).to.be.true
        } finally {
            messenger.destroy()
        }
    })

    it('a gesture starting inside an open modal never deselects the chat (F-4 guard)', () => {
        const onBack = sinon.spy()
        const messenger = new Messenger({ onBack } as never)

        try {
            // открываем кебаб-меню: в DOM появляется живая модалка
            messenger.element?.querySelector<HTMLButtonElement>('[data-testid="header-kebab"]')?.click()

            const modal = messenger.element?.querySelector('[data-testid="modal"]') as HTMLElement

            expect(modal).to.exist

            // жест начинается ВНУТРИ модалки — гвард гасит его на старте
            touchOn(modal, 'touchstart', 0, 0)
            touchOn(messenger.element!, 'touchend', 200, 0)

            expect(onBack.called).to.be.false
            expect(propsOf(messenger).kebabOpen).to.eq(true)
        } finally {
            messenger.destroy()
        }
    })

    it('a short tap is not a swipe', () => {
        const onBack = sinon.spy()
        const messenger = new Messenger({ onBack } as never)

        try {
            touchOn(messenger.element!, 'touchstart', 0, 0)
            touchOn(messenger.element!, 'touchend', 15, 2)

            expect(onBack.called).to.be.false
        } finally {
            messenger.destroy()
        }
    })
})

// плашка автора (групповые, при смене автора — свои сообщения серию не
// рвут, D-2/F-1) и AI-чип ответов бота (по серверному is_bot)
describe('mapTypedMessages author plate and bot chip', () => {
    const me = 7

    const groupUsers = [
        { id: me, login: 'me@x.io', email: 'me@x.io', display_name: 'Я', first_name: '', second_name: '', phone: '', avatar: '/me.png' },
        { id: 8, login: 'alice@x.io', email: 'alice@x.io', display_name: 'Алиса', first_name: '', second_name: '', phone: '', avatar: '/alice.png' },
        { id: 9, login: 'bot@chatty.local', email: 'bot@chatty.local', display_name: 'AI', first_name: '', second_name: '', phone: '', avatar: '/bot.png', is_bot: true },
    ] as never[]

    const message = (user_id: number, extra: Record<string, unknown> = {}) => ({
        chat_id: 5, time: 't0', type: 'message', user_id, content: 'm', ...extra,
    })

    it('every foreign group message carries a plate: run starts full, continuations compact; own messages do not break the run', () => {
        // п.4 (2026-11-09): до этого продолжения серии плашки не несли — в
        // диалоговом паттерне (свои сообщения серию не рвут) плашки почти
        // исчезали из ленты; теперь: первая серии — полная (аватар+логин),
        // продолжения — компактная (логин, compact:true)
        const mapped = mapTypedMessages(
            [message(8), message(8), message(me), message(8), message(9)] as never[],
            me,
            groupUsers
        )

        const badge = (i: number) => (mapped[i] as { authorBadge?: { login: string, compact?: boolean } }).authorBadge

        expect(badge(0)?.login).to.eq('alice@x.io')
        expect(badge(0)?.compact).to.eq(false)
        expect(badge(1)?.login).to.eq('alice@x.io')
        expect(badge(1)?.compact).to.eq(true)
        // своё сообщение плашки не несёт
        expect(badge(2)).to.eq(undefined)
        // A, ME, A — серия автора не рвётся своим сообщением (review F-1):
        // второе A — продолжение, компактная плашка
        expect(badge(3)?.login).to.eq('alice@x.io')
        expect(badge(3)?.compact).to.eq(true)
        // бот — участник группового чата, его первая реплика — полная плашка
        expect(badge(4)?.login).to.eq('bot@chatty.local')
        expect(badge(4)?.compact).to.eq(false)
    })

    it('marks bot messages with isBot and keeps humans clean', () => {
        const mapped = mapTypedMessages(
            [message(8), message(9), message(9, { kind: 'chat_renamed' }), message(9, { isPending: true })] as never[],
            me,
            groupUsers
        )

        expect((mapped[0] as { isBot?: boolean }).isBot).to.eq(false)
        expect((mapped[1] as { isBot?: boolean }).isBot).to.eq(true)
        // служебная строка и pending-плейсхолдер чипа не получают
        expect((mapped[2] as { isBot?: boolean }).isBot).to.eq(false)
        expect((mapped[3] as { isBot?: boolean }).isBot).to.eq(false)
    })

    it('a 2-member chat renders no plates but keeps the bot chip', () => {
        const pairUsers = [groupUsers[0], groupUsers[2]]
        const mapped = mapTypedMessages([message(9), message(9)] as never[], me, pairUsers)

        expect((mapped[0] as { authorBadge?: unknown }).authorBadge).to.eq(undefined)
        expect((mapped[1] as { authorBadge?: unknown }).authorBadge).to.eq(undefined)
        expect((mapped[0] as { isBot?: boolean }).isBot).to.eq(true)
    })

    it('an author missing from chatUsers renders no plate and breaks nothing', () => {
        const mapped = mapTypedMessages([message(99), message(8)] as never[], me, groupUsers)

        expect((mapped[0] as { authorBadge?: unknown }).authorBadge).to.eq(undefined)
        expect((mapped[1] as { authorBadge?: { login: string } }).authorBadge?.login).to.eq('alice@x.io')
    })

    // 2026-11-09: файловый аватар («{id}/download») плашка гоняет через
    // fileUrl — сырой путь в src был относительным 404 (загруженная
    // аватарка не видна у других); статика с '/' не трогается
    it('runs a file-path badge avatar through fileUrl, keeps static paths as is', () => {
        const mapped = mapTypedMessages(
            [message(8), message(10)] as never[],
            me,
            [
                ...groupUsers,
                { id: 10, login: 'file@x.io', email: 'file@x.io', display_name: 'Ф', first_name: '', second_name: '', phone: '', avatar: '42/download' },
            ] as never[]
        )

        expect((mapped[0] as { authorBadge?: { avatar: string } }).authorBadge?.avatar).to.eq('/alice.png')
        expect((mapped[1] as { authorBadge?: { avatar: string } }).authorBadge?.avatar).to.eq(fileUrl('42/download'))
    })

    it('the store-driven messenger renders the plate with the email tooltip', () => {
        store.set('chats', [{ id: 5, title: 'группа', avatar: '', unread_count: 0 }])
        store.set('chatUsers', groupUsers)
        store.set('messages', { 5: [message(8), message(8)] })
        store.set('selectedChat', 5)
        store.set('user', { id: me })

        const messenger = new Messenger({} as never)

        try {
            const plates = [...(messenger.element?.querySelectorAll('[data-testid="message-author-badge"]') ?? [])]

            // первое сообщение серии — полная плашка с аватаром
            expect(plates[0]?.textContent).to.contain('alice@x.io')
            expect(plates[0]?.getAttribute('title')).to.eq('alice@x.io')
            expect(plates[0]?.querySelector('img')).to.not.eq(null)
            expect(plates[0]?.classList.contains('messenger__message-author_compact')).to.eq(false)
            // продолжение серии — компактная: уменьшенный аватар + логин,
            // класс-модификатор отличает от полной (п.4)
            expect(plates[1]?.textContent).to.contain('alice@x.io')
            expect(plates[1]?.querySelector('img')).to.not.eq(null)
            expect(plates[1]?.classList.contains('messenger__message-author_compact')).to.eq(true)
        } finally {
            messenger.destroy()
            store.set('messages', undefined)
            store.set('selectedChat', undefined)
            store.set('chatUsers', undefined)
            store.set('chats', undefined)
            store.set('user', undefined)
        }
    })
})

describe('messenger scss pins', () => {
    it('the auto-title chip is positioned from the left without a right offset', async () => {
        const { readFileSync } = await import('node:fs')
        const scss = readFileSync('src/scss/components/messenger.scss', 'utf-8')
        const ruleStart = scss.indexOf('&__header-title-hint {')
        const ruleEnd = scss.indexOf('white-space: nowrap', ruleStart)
        const rule = scss.slice(ruleStart, ruleEnd)

        expect(ruleStart).to.be.greaterThan(-1)
        expect(rule).to.contain('left: 70px')
        expect(rule).to.not.match(/right:\s/)
    })

    it('the mobile branch moves the chip to left: 95px and swaps the icon row for the kebab', async () => {
        const { readFileSync } = await import('node:fs')
        const scss = readFileSync('src/scss/components/messenger.scss', 'utf-8')
        const mobileStart = scss.indexOf('@media (max-width: ($tablet - 1px))')
        const mobileBlock = scss.slice(mobileStart)

        expect(mobileStart).to.be.greaterThan(-1)
        expect(mobileBlock).to.contain('&__header-title-hint')
        expect(mobileBlock).to.contain('left: 95px')
        expect(mobileBlock).to.contain('&__header-buttons-container')
        expect(mobileBlock).to.contain('&__header-kebab')
    })
})
