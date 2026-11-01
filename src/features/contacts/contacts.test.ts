import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import store from '../../utils/Store.ts'
import { ContactsFeatureController, setChatOpener } from './controller.ts'
import { contactsSlice } from './store.ts'
import type { ContactsPort } from './ports.ts'
import type { ContactInfo } from '../../utils/types.ts'

const dom = new JSDOM()
global.document = dom.window.document

const bob: ContactInfo = { id: 9, login: 'bob@example.com', display_name: 'bob', avatar: '' }
const ada: ContactInfo = { id: 12, login: 'ada@example.com', display_name: 'ada', avatar: '' }

function makePort(overrides: Partial<ContactsPort> = {}): ContactsPort {
    return {
        fetchContacts: async () => [],
        addContact: async () => undefined,
        removeContact: async () => undefined,
        searchUsers: async () => [],
        createDm: async () => ({ chatId: 0 }),
        ...overrides,
    }
}

describe('contacts feature boundary', () => {
    afterEach(() => {
        contactsSlice.setContacts([])
        // модульный опенер — общий на файл: возвращаем noop-эквивалент,
        // чтобы связывание одного теста не будило соседей
        setChatOpener(() => {})
    })

    it('should expose the port through the controller (boundary smoke)', () => {
        const controller = new ContactsFeatureController(makePort())

        expect(controller).to.be.instanceOf(ContactsFeatureController)
    })

    // ДО любого setChatOpener в этом файле: пиннуем дефолт — до связывания
    // композицией openDm резолвится, а не падает «chatOpener is not a
    // function»
    it('should survive openDm before the composition wires the opener', async () => {
        const controller = new ContactsFeatureController(makePort({
            createDm: async () => ({ chatId: 3 }),
        }))

        await controller.openDm(9)
    })

    it('should store fetched contacts in the slice', async () => {
        const port = makePort({ fetchContacts: async () => [bob, ada] })
        const controller = new ContactsFeatureController(port)

        await controller.fetchContacts()

        expect(contactsSlice.getContacts()).to.deep.eq([bob, ada])
    })

    // прецедент fetchChats: ошибка порта логируется и гасит список — слайс
    // пишется всегда, страница не держит призраков старого состояния
    it('should write an empty list into the slice when the port rejects', async () => {
        contactsSlice.setContacts([bob])
        const port = makePort({
            fetchContacts: async () => {
                throw new Error('boom')
            },
        })
        const controller = new ContactsFeatureController(port)

        await controller.fetchContacts()

        expect(contactsSlice.getContacts()).to.deep.eq([])
    })

    it('should add a contact through the port and refetch the list', async () => {
        const addContact = sinon.stub().resolves()
        const fetchContacts = sinon.stub().resolves([bob])
        const port = makePort({ addContact, fetchContacts })
        const controller = new ContactsFeatureController(port)

        await controller.addContact(9)

        expect(addContact.calledOnceWith(9)).to.be.true
        expect(fetchContacts.calledOnce).to.be.true
        expect(contactsSlice.getContacts()).to.deep.eq([bob])
    })

    it('should still refetch after the add port call rejects', async () => {
        const addContact = sinon.stub().rejects(new Error('boom'))
        const fetchContacts = sinon.stub().resolves([])
        const port = makePort({ addContact, fetchContacts })
        const controller = new ContactsFeatureController(port)

        await controller.addContact(9)

        expect(fetchContacts.calledOnce).to.be.true
    })

    it('should remove a contact through the port and refetch the list', async () => {
        const removeContact = sinon.stub().resolves()
        const fetchContacts = sinon.stub().resolves([])
        const port = makePort({ removeContact, fetchContacts })
        const controller = new ContactsFeatureController(port)

        await controller.removeContact(9)

        expect(removeContact.calledOnceWith(9)).to.be.true
        expect(fetchContacts.calledOnce).to.be.true
    })

    it('should search users typed for the add-contact modal', async () => {
        const searchUsers = sinon.stub().resolves([{ id: 9, login: 'bob@example.com', display_name: 'bob' }])
        const controller = new ContactsFeatureController(makePort({ searchUsers }))

        const results = await controller.searchUsers('bob')

        expect(searchUsers.calledOnceWith('bob')).to.be.true
        expect(results).to.deep.eq([{ id: 9, login: 'bob@example.com', display_name: 'bob' }])
    })

    it('should keep the search silent on port failure', async () => {
        const searchUsers = sinon.stub().rejects(new Error('boom'))
        const controller = new ContactsFeatureController(makePort({ searchUsers }))

        const results = await controller.searchUsers('bob')

        expect(results).to.deep.eq([])
    })

    it('should pass the DM chat id to the injected opener', async () => {
        const opener = sinon.spy()
        setChatOpener(opener)
        const createDm = sinon.stub().resolves({ chatId: 5 })
        const controller = new ContactsFeatureController(makePort({ createDm }))

        await controller.openDm(9)

        expect(createDm.calledOnceWith(9)).to.be.true
        expect(opener.calledOnceWith(5)).to.be.true
    })

    it('should not wake the opener when the DM port rejects', async () => {
        const opener = sinon.spy()
        setChatOpener(opener)
        const createDm = sinon.stub().rejects(new Error('boom'))
        const controller = new ContactsFeatureController(makePort({ createDm }))

        await controller.openDm(9)

        expect(opener.notCalled).to.be.true
    })

    it('should expose the contacts slice over the store cast idiom', () => {
        contactsSlice.setContacts([ada])

        expect((store.getState() as { contacts?: ContactInfo[] }).contacts).to.deep.eq([ada])
        expect(contactsSlice.getContacts()).to.deep.eq([ada])
    })
})
