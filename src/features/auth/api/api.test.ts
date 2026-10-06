import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import { env } from '../../../utils/env.ts'
import type { AuthPort, AuthUser, SignInRequest, SignUpRequest } from '../ports.ts'
import { ownAuthPort, toAuthUser, toLoginBody, toRegisterBody } from './own.ts'
import { practicumAuthPort } from './practicum.ts'
import { authPort } from './index.ts'

const dom = new JSDOM()
global.document = dom.window.document

const ownResponse = {
    id: 7,
    email: 'ada@example.com',
    role: 'user',
    is_active: true,
    created_at: '2026-10-06T00:00:00Z',
}

describe('auth api adapters', () => {
    it('should select the adapter by env mode', () => {
        const expected: AuthPort = env.mode === 'own' ? ownAuthPort : practicumAuthPort

        expect(authPort).to.eq(expected)
    })

    it('should expose all port methods on both adapters', () => {
        for (const port of [practicumAuthPort, ownAuthPort]) {
            for (const method of ['signin', 'signup', 'me', 'logout'] as const) {
                expect(port, `practicum/own ${method}`).to.have.property(method)
            }
        }
    })

    it('should map own UserResponse onto AuthUser with defaults', () => {
        const user: AuthUser = toAuthUser(ownResponse)

        expect(user.id).to.eq(7)
        expect(user.login).to.eq('ada@example.com')
        expect(user.display_name).to.eq('ada@example.com')
        expect(user.email).to.eq('ada@example.com')
        expect(user.first_name).to.eq('')
        expect(user.second_name).to.eq('')
        expect(user.phone).to.eq('')
        expect(user.avatar).to.eq('')
    })

    it('should map the form login field to the backend email credential', () => {
        const request: SignInRequest = { login: 'ada@example.com', password: 'long-enough-pass' }

        expect(toLoginBody(request)).to.deep.eq({
            email: 'ada@example.com',
            password: 'long-enough-pass',
        })
    })

    it('should build the own register body from email and password only', () => {
        const request: SignUpRequest = {
            login: 'ada',
            password: 'long-enough-pass',
            email: 'ada@example.com',
            first_name: 'Ada',
            second_name: 'Lovelace',
            phone: '+7 000 000 0000',
        }

        // собственный контракт: только email и password; лишние поля формы не отправляются
        expect(toRegisterBody(request)).to.deep.eq({
            email: 'ada@example.com',
            password: 'long-enough-pass',
        })
    })
})
