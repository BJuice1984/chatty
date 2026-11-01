// Страница адресной книги (2026-11-01-contacts): список рисуется из слайса
// стора (XSS-пин: login с <script> — текстом), CDM фетчит контакты, модалка
// «Добавить» переиспользует билдер messenger с бейджем «уже в контактах» и
// дебаунсом 300 мс, меню контакта зовёт openDm/removeContact. Состояние
// модалок — controller-free UI-пропсы; шаблон грузится тестовым погрузчиком,
// компоненты-хелперы — импортом components.ts, как в прод-сборке main.ts.

import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import '../../../ai-assistant/hbs-test-loader.ts'
import Handlebars from 'handlebars'
import type Block from '../../../../core/Block.ts'
import { registerComponent } from '../../../../core/registerComponent.ts'
import * as Components from '../../../../components/components.ts'
import store from '../../../../utils/Store.ts'
import { USER_SEARCH_DEBOUNCE_MS } from '../../../../components/messenger/messenger.ts'
import ContactsController from '../../controller.ts'
import type { ContactInfo } from '../../../../utils/types.ts'
import { ContactsPage } from './contacts.ts'

const dom = new JSDOM('<body></body>', { url: 'http://localhost:3000/contacts' })
global.document = dom.window.document

Object.entries(Components).forEach(([name, component]) => {
    if (!(name in Handlebars.helpers)) {
        registerComponent(name, component as typeof Block)
    }
})

const bob: ContactInfo = { id: 9, login: 'bob@example.com', display_name: 'bob', avatar: '' }

interface ContactsPageState {
    menuTarget?: ContactInfo | null
    deleteTarget?: ContactInfo | null
    addOpen?: boolean
    addFeedback?: string
}

function stateOf(page: unknown): ContactsPageState {
    return (page as unknown as { props: ContactsPageState }).props
}

// кнопка/узел ВНУТРИ открытой модалки: закрытая рендерится с display:none
const inOpenModal = (page: { element?: Element | null }, testid: string): Element | null =>
    page.element?.querySelector(`.modal_open [data-testid="${testid}"]`) ?? null

const click = (node: Element | null | undefined): void => {
    node?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
}

describe('contacts page', () => {
    afterEach(() => {
        store.set('contacts', undefined)
    })

    it('fetches contacts on componentDidMount, not on construction', () => {
        const fetchContacts = sinon.stub(ContactsController, 'fetchContacts').resolves()

        try {
            const page = new ContactsPage({} as never)

            expect(fetchContacts.called).to.be.false

            page.dispatchComponentDidMount()
            expect(fetchContacts.calledOnce).to.be.true

            page.destroy()
        } finally {
            fetchContacts.restore()
        }
    })

    it('renders the contact cards from the store slice', () => {
        store.set('contacts', [
            bob,
            { id: 12, login: 'ada@example.com', display_name: 'ada', avatar: '' },
        ])

        const page = new ContactsPage({} as never)

        const cards = page.element?.querySelectorAll('[data-testid="contact-item"]')

        expect(cards).to.have.lengthOf(2)
        expect(page.element?.textContent).to.contain('bob')
        expect(page.element?.textContent).to.contain('ada@example.com')
        expect(page.element?.querySelector('.contacts__placeholder')?.textContent).to.contain('выберите контакт')

        page.destroy()
    })

    it('renders a script-bearing login as text (XSS)', () => {
        store.set('contacts', [
            { id: 3, login: '<script>alert(1)</script>', display_name: 'зло', avatar: '' },
        ])

        const page = new ContactsPage({} as never)

        expect(page.element?.querySelector('script')).to.not.exist
        expect(page.element?.querySelector('.contact-item__subtitle')?.innerHTML).to.contain('&lt;script&gt;')

        page.destroy()
    })

    it('opens the add modal from the «Добавить» button', () => {
        const page = new ContactsPage({} as never)

        try {
            click(page.element?.querySelector('[data-testid="contacts-add"]'))

            expect(inOpenModal(page, 'user-search-input')).to.exist

            click(page.element?.querySelector('[data-testid="modal-close"]'))

            expect(inOpenModal(page, 'user-search-input')).to.not.exist
            expect(stateOf(page).addOpen).to.be.false
        } finally {
            page.destroy()
        }
    })

    it('debounces the search and badges already-contacts «уже в контактах»', async () => {
        const clock = sinon.useFakeTimers()
        const searchUsers = sinon.stub(ContactsController, 'searchUsers').resolves([
            { id: 12, login: 'ada@example.com', display_name: 'ada' },
            { id: 9, login: 'bob@example.com', display_name: 'bob' },
        ])

        try {
            store.set('contacts', [bob])

            const page = new ContactsPage({} as never)

            document.body.appendChild(page.element as HTMLElement)

            click(page.element?.querySelector('[data-testid="contacts-add"]'))

            const input = page.element?.querySelector<HTMLInputElement>('[data-testid="user-search-input"]')

            input!.value = 'bob@example.com'
            input!.dispatchEvent(new dom.window.MouseEvent('input', { bubbles: true }))

            // значение не переписывается: полный email остаётся как введён
            expect(input!.value).to.equal('bob@example.com')

            await clock.tickAsync(USER_SEARCH_DEBOUNCE_MS - 50)
            expect(searchUsers.called).to.be.false

            await clock.tickAsync(100)

            // полный email доходит до поиска дословно
            expect(searchUsers.calledOnceWith('bob@example.com')).to.be.true

            const results = page.element?.querySelectorAll<HTMLButtonElement>('[data-testid="user-search-result"]')

            expect(results).to.have.lengthOf(2)
            expect(results?.[0]?.disabled).to.be.false
            expect(results?.[1]?.disabled).to.be.true
            expect(results?.[1]?.textContent).to.contain('уже в контактах')

            // перерисовка по ответу вернула фокус и коммит значения в инпут
            const revived = page.element?.querySelector<HTMLInputElement>('[data-testid="user-search-input"]')

            expect(revived?.value).to.equal('bob@example.com')
            expect(revived).to.equal(document.activeElement)

            // префикс без «@» по-прежнему ищет
            revived!.value = 'ada'
            revived!.dispatchEvent(new dom.window.MouseEvent('input', { bubbles: true }))

            await clock.tickAsync(USER_SEARCH_DEBOUNCE_MS)

            expect(searchUsers.secondCall.calledWith('ada')).to.be.true

            page.destroy()
        } finally {
            clock.restore()
            searchUsers.restore()
        }
    })

    it('adds the picked user through the controller with feedback «Добавлен»', async () => {
        const addContact = sinon.stub(ContactsController, 'addContact').resolves()

        try {
            const page = new ContactsPage({} as never)

            page.setProps({
                addOpen: true,
                addResults: [{ id: 12, login: 'ada@example.com', display_name: 'ada' }],
            })

            click(page.element?.querySelector('[data-testid="user-search-result"]'))

            expect(addContact.calledOnceWith(12)).to.be.true

            await new Promise(resolve => setTimeout(resolve, 0))

            expect(inOpenModal(page, 'add-user-feedback')?.textContent?.trim()).to.equal('Добавлен')

            page.destroy()
        } finally {
            addContact.restore()
        }
    })

    it('opens the contact menu on a card click with the display name title', () => {
        store.set('contacts', [bob])

        const page = new ContactsPage({} as never)

        try {
            click(page.element?.querySelector('[data-testid="contact-item"]'))

            const create = inOpenModal(page, 'contact-menu-create')

            expect(create).to.exist
            expect(create?.closest('.modal')?.querySelector('[data-testid="modal-title"]')?.textContent).to.equal('bob')
        } finally {
            page.destroy()
        }
    })

    it('renders «Найти все чаты» disabled with the stub title', () => {
        store.set('contacts', [bob])

        const page = new ContactsPage({} as never)

        try {
            click(page.element?.querySelector('[data-testid="contact-item"]'))

            const stub = inOpenModal(page, 'contact-menu-search') as HTMLButtonElement | null

            expect(stub?.disabled).to.be.true
            expect(stub?.getAttribute('title')).to.equal('пока не реализовано')
            expect(stub?.textContent).to.contain('Найти все чаты')
        } finally {
            page.destroy()
        }
    })

    it('creates the DM through «Создать» and closes the menu', async () => {
        const openDm = sinon.stub(ContactsController, 'openDm').resolves()

        try {
            store.set('contacts', [bob])

            const page = new ContactsPage({} as never)

            click(page.element?.querySelector('[data-testid="contact-item"]'))
            click(inOpenModal(page, 'contact-menu-create'))

            expect(openDm.calledOnceWith(9)).to.be.true

            await new Promise(resolve => setTimeout(resolve, 0))

            expect(inOpenModal(page, 'contact-menu-create')).to.not.exist
            expect(stateOf(page).menuTarget).to.be.null

            page.destroy()
        } finally {
            openDm.restore()
        }
    })

    it('keeps the menu with feedback when the DM call rejects', async () => {
        const openDm = sinon.stub(ContactsController, 'openDm').rejects(new Error('boom'))

        try {
            store.set('contacts', [bob])

            const page = new ContactsPage({} as never)

            click(page.element?.querySelector('[data-testid="contact-item"]'))
            click(inOpenModal(page, 'contact-menu-create'))

            await new Promise(resolve => setTimeout(resolve, 0))

            expect(inOpenModal(page, 'contact-menu-create')).to.exist
            expect(inOpenModal(page, 'contact-menu-feedback')?.textContent).to.equal('Не удалось создать чат')

            page.destroy()
        } finally {
            openDm.restore()
        }
    })

    it('closes the menu on «Отмена» without creating anything', () => {
        const openDm = sinon.stub(ContactsController, 'openDm').resolves()

        try {
            store.set('contacts', [bob])

            const page = new ContactsPage({} as never)

            click(page.element?.querySelector('[data-testid="contact-item"]'))
            click(inOpenModal(page, 'contact-menu-cancel'))

            expect(openDm.called).to.be.false
            expect(inOpenModal(page, 'contact-menu-create')).to.not.exist

            page.destroy()
        } finally {
            openDm.restore()
        }
    })

    it('opens the delete confirmation with the contact name on the hover cross', () => {
        store.set('contacts', [bob])

        const page = new ContactsPage({} as never)

        try {
            click(page.element?.querySelector('[data-testid="contact-item-delete"]'))

            expect(stateOf(page).deleteTarget?.id).to.eq(9)
            expect(inOpenModal(page, 'delete-contact-text')?.textContent).to.contain('Удалить контакт «bob»?')
        } finally {
            page.destroy()
        }
    })

    it('removes the contact through «Удалить» and closes the confirmation', () => {
        const removeContact = sinon.stub(ContactsController, 'removeContact').resolves()

        try {
            store.set('contacts', [bob])

            const page = new ContactsPage({} as never)

            click(page.element?.querySelector('[data-testid="contact-item-delete"]'))
            click(inOpenModal(page, 'delete-contact-confirm'))

            expect(removeContact.calledOnceWith(9)).to.be.true
            expect(inOpenModal(page, 'delete-contact-confirm')).to.not.exist

            page.destroy()
        } finally {
            removeContact.restore()
        }
    })

    it('cancels the delete without calling the controller', () => {
        const removeContact = sinon.stub(ContactsController, 'removeContact').resolves()

        try {
            store.set('contacts', [bob])

            const page = new ContactsPage({} as never)

            click(page.element?.querySelector('[data-testid="contact-item-delete"]'))
            click(inOpenModal(page, 'delete-contact-cancel'))

            expect(removeContact.called).to.be.false
            expect(inOpenModal(page, 'delete-contact-confirm')).to.not.exist

            page.destroy()
        } finally {
            removeContact.restore()
        }
    })
})
