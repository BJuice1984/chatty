import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import UsersAPI from '../../api/UserApi.ts'
import { ChatsFeatureController } from './controller.ts'
import { chatsSlice } from './store.ts'
import type { ChatsPort } from './ports.ts'

const dom = new JSDOM()
global.document = dom.window.document

function makePort(overrides: Partial<ChatsPort> = {}): ChatsPort {
    return {
        fetchChats: async () => [],
        createChat: async () => undefined,
        deleteChat: async () => undefined,
        // eslint-disable-next-line no-unused-vars
        getToken: async (chatId: number) => ({ token: `token-${chatId}` }),
        addUsers: async () => undefined,
        removeUsers: async () => undefined,
        getChatUsers: async () => [],
        changeChatAvatar: async () => ({ avatar: '' }),
        ...overrides,
    }
}

describe('chats feature boundary', () => {
    afterEach(() => {
        chatsSlice.setChats([])
    })

    it('should expose the port through the controller (boundary smoke)', () => {
        const port = makePort()
        const messages = {
            // eslint-disable-next-line no-unused-vars
            sendMessage: async () => undefined,
            // eslint-disable-next-line no-unused-vars
            connect: async () => undefined,
        }
        const controller = new ChatsFeatureController(port, messages)

        expect(controller).to.be.instanceOf(ChatsFeatureController)
    })

    it('should store fetched chats in the slice and connect sockets per chat', async () => {
        const connect = sinon.spy()
        const port = makePort({
            fetchChats: async () => [
                { id: 1, title: 'one', avatar: '', unread_count: 0 },
                { id: 2, title: 'two', avatar: '', unread_count: 0 },
            ],
        })
        const controller = new ChatsFeatureController(port, {
            // eslint-disable-next-line no-unused-vars
            sendMessage: async () => undefined,
            connect,
        })

        await controller.fetchChats()

        expect(chatsSlice.getChats().map(chat => chat.id)).to.deep.eq([1, 2])
        expect(connect.calledTwice).to.be.true
        expect(connect.firstCall.args).to.deep.eq([1, 'token-1'])
    })

    it('should select a chat through the slice', () => {
        chatsSlice.selectChat(42)

        expect(chatsSlice.getSelectedChat()).to.eq(42)
    })

    it('should add users by login through the port and refresh both lists', async () => {
        const searchStub = sinon.stub(UsersAPI, 'searchUsers').resolves([
            { id: 101, login: 'ada' },
        ] as never)
        const addUsers = sinon.stub().resolves()
        const getChatUsers = sinon.stub().resolves([])
        const fetchChats = sinon.stub().resolves([])
        const port = makePort({
            addUsers,
            getChatUsers,
            fetchChats,
        })
        const controller = new ChatsFeatureController(port, {
            // eslint-disable-next-line no-unused-vars
            sendMessage: async () => undefined,
            // eslint-disable-next-line no-unused-vars
            connect: async () => undefined,
        })

        try {
            await controller.addUsersByLogin({ login: 'ada' }, 7)

            expect(searchStub.calledWith({ login: 'ada' })).to.be.true
            expect(addUsers.calledOnce).to.be.true
            expect(addUsers.firstCall.args[0]).to.deep.eq({ users: [101], chatId: 7 })
            expect(getChatUsers.calledWith(7)).to.be.true
            expect(fetchChats.calledOnce).to.be.true
        } finally {
            searchStub.restore()
        }
    })
})
