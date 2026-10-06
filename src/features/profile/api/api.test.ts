import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import { env } from '../../../utils/env.ts'
import type { ProfilePort } from '../ports.ts'
import { ownProfilePort } from './own.ts'
import { practicumProfilePort } from './practicum.ts'
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

describe('profile api adapters', () => {
    it('should select the adapter by env mode', () => {
        const expected: ProfilePort = env.mode === 'own' ? ownProfilePort : practicumProfilePort

        expect(profilePort).to.eq(expected)
    })

    it('should expose all port methods on both adapters', () => {
        for (const port of [practicumProfilePort, ownProfilePort]) {
            for (const method of ['searchUsersByLogin', 'changeProfile', 'changeAvatar'] as const) {
                expect(port, `practicum/own ${method}`).to.have.property(method)
            }
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
