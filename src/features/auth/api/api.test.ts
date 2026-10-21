import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import type { AuthUser, SignInRequest, SignUpRequest } from '../ports.ts'
import { ownAuthPort, toAuthUser, toLoginBody, toRegisterBody } from './own.ts'
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

describe('auth api adapter', () => {
    it('should expose the own adapter as the port', () => {
        expect(authPort).to.eq(ownAuthPort)

        for (const method of ['signin', 'signup', 'me', 'logout'] as const) {
            expect(authPort, `own ${method}`).to.have.property(method)
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
        // аватар — детерминированный из пула статики (id 7 → 8-я картинка),
        // own-бэкенд аватары пользователей не хранит
        expect(user.avatar).to.eq('/images/avatars/8.svg')
    })

    it('should map the form login field to the backend email credential', () => {
        const request: SignInRequest = { login: 'ada@example.com', password: 'LongPassword1' }

        expect(toLoginBody(request)).to.deep.eq({
            email: 'ada@example.com',
            password: 'LongPassword1',
        })
    })

    it('should build the register body from email and password only', () => {
        const request: SignUpRequest = {
            email: 'ada@example.com',
            password: 'LongPassword1',
            confirm_password: 'LongPassword1',
        }

        // собственный контракт: только email и password; подтверждение —
        // клиентская проверка формы и в запрос не входит
        expect(toRegisterBody(request)).to.deep.eq({
            email: 'ada@example.com',
            password: 'LongPassword1',
        })
    })
})
