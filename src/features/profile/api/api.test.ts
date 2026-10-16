import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import { ownProfilePort } from './own.ts'
import { profilePort } from './index.ts'

const dom = new JSDOM()
global.document = dom.window.document

async function captureError(action: () => unknown): Promise<unknown> {
    try {
        await action()
    } catch (e) {
        return e
    }

    return undefined
}

describe('profile api adapter', () => {
    it('should expose the own adapter as the port', () => {
        expect(profilePort).to.eq(ownProfilePort)

        for (const method of ['searchUsersByLogin', 'changeProfile', 'changeAvatar'] as const) {
            expect(profilePort, `own ${method}`).to.have.property(method)
        }
    })

    it('should reject all own-mode profile operations explicitly', async () => {
        const formData = new FormData()
        const errors = await Promise.all([
            captureError(() => ownProfilePort.searchUsersByLogin({ login: 'ada' })),
            captureError(() => ownProfilePort.changeProfile({} as never)),
            captureError(() => ownProfilePort.changeAvatar(formData)),
        ])

        for (const error of errors) {
            expect(error).to.be.instanceOf(Error)
            expect((error as Error).message).to.match(/недоступна в own-режиме/)
        }
    })
})
