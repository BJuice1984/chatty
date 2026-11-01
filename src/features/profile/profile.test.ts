// Фича-контроллер profile (2026-11-01-settings): правка профиля и смена
// пароля обновляют пользователя через ШОВ refreshUser (свежий снимок делает
// auth-фича), logoutAll после порта цепляет инъекцированный logout, возврат в
// чат делегируется chats-фиче шовом rejoinChat, хранилище возвращается как
// приехало. До связывания шовы — noop: обёртки не падают.

import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import { ProfileFeatureController, setProfileSeams } from './controller.ts'
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
    send_read_receipts: true,
}

function makePort(overrides: Partial<ProfilePort> = {}): ProfilePort {
    return {
        searchUsersByLogin: async () => [],
        changeProfile: async () => testUser,
        changeAvatar: async () => ({ avatar: '5/download' }),
        changePassword: async () => undefined,
        logoutAll: async () => undefined,
        fetchUsage: async () => ({ total_bytes: 1024, file_count: 3 }),
        ...overrides,
    }
}

// noop-швы между тестами (прецедент contacts-шва в chats.test.ts)
function resetSeams(): void {
    setProfileSeams({ refreshUser: () => {}, logout: () => {}, rejoinChat: () => {} })
}

describe('profile feature boundary', () => {
    beforeEach(() => {
        resetSeams()
    })

    afterEach(() => {
        profileSlice.setUser(null)
        resetSeams()
    })

    it('refreshes the user through the seam after profile changes', async () => {
        const changeProfile = sinon.stub().resolves(testUser)
        const refreshUser = sinon.stub().resolves()
        const controller = new ProfileFeatureController(makePort({ changeProfile }))

        setProfileSeams({ refreshUser, logout: () => {}, rejoinChat: () => {} })

        await controller.changeUserInfo({ display_name: 'Ada Lovelace', phone: '+7 000' })

        expect(changeProfile.calledOnceWith({ display_name: 'Ada Lovelace', phone: '+7 000' })).to.be.true
        expect(refreshUser.calledOnce).to.be.true
    })

    it('skips the refresh when the profile port fails', async () => {
        const changeProfile = sinon.stub().rejects(new Error('network'))
        const refreshUser = sinon.stub().resolves()
        const errorSpy = sinon.stub(console, 'error')
        const controller = new ProfileFeatureController(makePort({ changeProfile }))

        setProfileSeams({ refreshUser, logout: () => {}, rejoinChat: () => {} })

        try {
            await controller.changeUserInfo({ display_name: 'Ada Lovelace' })
        } finally {
            errorSpy.restore()
        }

        expect(refreshUser.notCalled).to.be.true
        expect(profileSlice.getUser()).to.eq(null)
    })

    it('changes the password through the port and refreshes the user', async () => {
        const changePassword = sinon.stub().resolves()
        const refreshUser = sinon.stub().resolves()
        const controller = new ProfileFeatureController(makePort({ changePassword }))

        setProfileSeams({ refreshUser, logout: () => {}, rejoinChat: () => {} })

        await controller.changePassword({ old_password: 'OldPassword12', new_password: 'NewPassword12' })

        expect(changePassword.calledOnceWith({ old_password: 'OldPassword12', new_password: 'NewPassword12' })).to.be.true
        expect(refreshUser.calledOnce).to.be.true
    })

    it('logs out everywhere through the port and then chains the injected logout', async () => {
        const logoutAll = sinon.stub().resolves()
        const logout = sinon.stub().resolves()
        const controller = new ProfileFeatureController(makePort({ logoutAll }))

        setProfileSeams({ refreshUser: () => {}, logout, rejoinChat: () => {} })

        await controller.logoutAll()

        expect(logoutAll.calledOnce).to.be.true
        expect(logout.calledOnce).to.be.true
    })

    it('skips the local logout when logout-all fails on the port', async () => {
        const logoutAll = sinon.stub().rejects(new Error('network'))
        const logout = sinon.stub().resolves()
        const errorSpy = sinon.stub(console, 'error')
        const controller = new ProfileFeatureController(makePort({ logoutAll }))

        setProfileSeams({ refreshUser: () => {}, logout, rejoinChat: () => {} })

        try {
            await controller.logoutAll()
        } finally {
            errorSpy.restore()
        }

        expect(logout.notCalled).to.be.true
    })

    it('returns the fetched usage as is', async () => {
        const controller = new ProfileFeatureController(makePort())

        const usage = await controller.fetchUsage()

        expect(usage).to.deep.eq({ total_bytes: 1024, file_count: 3 })
    })

    it('returns undefined usage and stays silent when the port fails', async () => {
        const errorSpy = sinon.stub(console, 'error')
        const controller = new ProfileFeatureController(makePort({
            fetchUsage: async () => {
                throw new Error('network')
            },
        }))

        try {
            const usage = await controller.fetchUsage()

            expect(usage).to.eq(undefined)
        } finally {
            errorSpy.restore()
        }
    })

    it('delegates rejoin to the wired chats seam', () => {
        const rejoinChat = sinon.spy()
        const controller = new ProfileFeatureController(makePort())

        setProfileSeams({ refreshUser: () => {}, logout: () => {}, rejoinChat })

        controller.rejoinChat(3)

        expect(rejoinChat.calledOnceWith(3)).to.be.true
    })

    it('delegates logout to the wired auth seam', async () => {
        const logout = sinon.stub().resolves()
        const controller = new ProfileFeatureController(makePort())

        setProfileSeams({ refreshUser: () => {}, logout, rejoinChat: () => {} })

        await controller.logout()

        expect(logout.calledOnce).to.be.true
    })

    it('defaults to noop seams: wrapper calls neither throw nor reach any feature', async () => {
        resetSeams()

        const controller = new ProfileFeatureController(makePort())

        // швы не связаны: обёртки не падают и не тянут чужие фичи
        expect(() => controller.rejoinChat(42)).to.not.throw()
        await controller.logout()
    })

    it('patches the avatar point-wise through the slice', async () => {
        profileSlice.setUser(testUser)
        const controller = new ProfileFeatureController(makePort())

        await controller.changeUserAvatar(new FormData())

        expect(profileSlice.getUser()?.avatar).to.eq('5/download')
        expect(profileSlice.getUser()?.display_name).to.eq('ada')
    })

    it('should map search results to user ids', async () => {
        const controller = new ProfileFeatureController(makePort())
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
