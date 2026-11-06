// Фича-контроллер profile (2026-11-01-settings): правка профиля и смена
// пароля обновляют пользователя через ШОВ refreshUser (свежий снимок делает
// auth-фича), logoutAll после порта цепляет ЛОКАЛЬНЫЙ выход (шов
// localSignOut — куки уже сняты бэкендом), возврат в чат делегируется
// chats-фиче шовом rejoinChat, хранилище возвращается как приехало.
// До связывания шовы — noop: обёртки не падают.

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
    setProfileSeams({ refreshUser: () => {}, logout: () => {}, localSignOut: () => {}, rejoinChat: () => {} })
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

        setProfileSeams({ refreshUser, logout: () => {}, localSignOut: () => {}, rejoinChat: () => {} })

        await controller.changeUserInfo({ display_name: 'Ada Lovelace', phone: '+7 000' })

        expect(changeProfile.calledOnceWith({ display_name: 'Ada Lovelace', phone: '+7 000' })).to.be.true
        expect(refreshUser.calledOnce).to.be.true
    })

    it('skips the refresh when the profile port fails', async () => {
        const changeProfile = sinon.stub().rejects(new Error('network'))
        const refreshUser = sinon.stub().resolves()
        const errorSpy = sinon.stub(console, 'error')
        const controller = new ProfileFeatureController(makePort({ changeProfile }))

        setProfileSeams({ refreshUser, logout: () => {}, localSignOut: () => {}, rejoinChat: () => {} })

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

        setProfileSeams({ refreshUser, logout: () => {}, localSignOut: () => {}, rejoinChat: () => {} })

        await controller.changePassword({ old_password: 'OldPassword12', new_password: 'NewPassword12' })

        expect(changePassword.calledOnceWith({ old_password: 'OldPassword12', new_password: 'NewPassword12' })).to.be.true
        expect(refreshUser.calledOnce).to.be.true
    })

    it('logout-all chains the LOCAL sign-out seam, not a second server logout', async () => {
        // 2026-11-07: /auth/logout-all сам снимает все куки — следующий POST
        // /auth/logout едет с пустым csrf и падает 403; локальный выход
        // (сброс стора + редирект) делает отдельный шов localSignOut
        const logoutAll = sinon.stub().resolves()
        const logout = sinon.stub().resolves()
        const localSignOut = sinon.stub().resolves()
        const controller = new ProfileFeatureController(makePort({ logoutAll }))

        setProfileSeams({ refreshUser: () => {}, logout, localSignOut, rejoinChat: () => {} })

        await controller.logoutAll()

        expect(logoutAll.calledOnce).to.be.true
        expect(localSignOut.calledOnce).to.be.true
        expect(logout.notCalled).to.be.true
    })

    it('skips the local sign-out when logout-all fails on the port', async () => {
        const logoutAll = sinon.stub().rejects(new Error('network'))
        const localSignOut = sinon.stub().resolves()
        const errorSpy = sinon.stub(console, 'error')
        const controller = new ProfileFeatureController(makePort({ logoutAll }))

        setProfileSeams({ refreshUser: () => {}, logout: () => {}, localSignOut, rejoinChat: () => {} })

        try {
            await controller.logoutAll()
        } finally {
            errorSpy.restore()
        }

        expect(localSignOut.notCalled).to.be.true
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

        setProfileSeams({ refreshUser: () => {}, logout: () => {}, localSignOut: () => {}, rejoinChat })

        controller.rejoinChat(3)

        expect(rejoinChat.calledOnceWith(3)).to.be.true
    })

    it('delegates logout to the wired auth seam', async () => {
        const logout = sinon.stub().resolves()
        const controller = new ProfileFeatureController(makePort())

        setProfileSeams({ refreshUser: () => {}, logout, localSignOut: () => {}, rejoinChat: () => {} })

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
