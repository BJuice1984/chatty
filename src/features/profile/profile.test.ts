import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import { ProfileFeatureController } from './controller.ts'
import { practicumProfilePort } from './api/practicum.ts'
import { profileSlice } from './store.ts'
import type { ProfilePort } from './ports.ts'

const dom = new JSDOM()
global.document = dom.window.document

const testUser = {
    id: 7,
    first_name: 'Ada',
    second_name: 'Lovelace',
    display_name: 'ada',
    login: 'ada',
    email: 'ada@example.com',
    phone: '+7 000 000 0000',
    avatar: '',
}

function makePort(): ProfilePort {
    return {
        searchUsersByLogin: async () => [],
        changeProfile: async () => testUser,
        changeAvatar: async () => testUser,
    }
}

describe('profile feature boundary', () => {
    afterEach(() => {
        profileSlice.setUser(null)
    })

    it('should expose the default Practicum port adapter', () => {
        expect(practicumProfilePort).to.have.property('searchUsersByLogin')
        expect(practicumProfilePort).to.have.property('changeProfile')
        expect(practicumProfilePort).to.have.property('changeAvatar')
    })

    it('should write profile changes into the slice through the port', async () => {
        const controller = new ProfileFeatureController(makePort(), async () => undefined)

        await controller.changeUserInfo({
            first_name: 'Ada',
            second_name: 'Lovelace',
            display_name: 'ada',
            login: 'ada',
            email: 'ada@example.com',
            phone: '+7 000 000 0000',
        })

        expect(profileSlice.getUser()?.id).to.eq(7)
        expect(profileSlice.getUser()?.display_name).to.eq('ada')
    })

    it('should keep the slice untouched when the port fails', async () => {
        const port = makePort()
        port.changeProfile = async () => {
            throw new Error('network')
        }
        const errorSpy = sinon.stub(console, 'error')
        const controller = new ProfileFeatureController(port, async () => undefined)

        try {
            await controller.changeUserInfo({
                first_name: 'x',
                second_name: 'y',
                display_name: 'z',
                login: 'l',
                email: 'e@e.e',
                phone: '123',
            })
        } finally {
            errorSpy.restore()
        }

        expect(profileSlice.getUser()).to.eq(null)
    })

    it('should delegate logout to the injected action', async () => {
        const logout = sinon.stub().resolves()
        const controller = new ProfileFeatureController(makePort(), logout)

        await controller.logout()

        expect(logout.calledOnce).to.be.true
    })

    it('should map search results to user ids', async () => {
        const controller = new ProfileFeatureController(makePort(), async () => undefined)
        const spy = sinon.stub(controller, 'searchUserByLogin')
        spy.resolves([101])

        try {
            const ids = await controller.searchUserByLogin({ login: 'ada' })

            expect(ids).to.deep.eq([101])
        } finally {
            spy.restore()
        }
    })
})
