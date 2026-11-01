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
        // 2026-11-01-settings: display_name нет в ответе → фолбэк локальной
        // частью email (синтез display_name=email убран — он затирал правки имени)
        expect(user.display_name).to.eq('ada')
        expect(user.email).to.eq('ada@example.com')
        expect(user.first_name).to.eq('')
        expect(user.second_name).to.eq('')
        expect(user.phone).to.eq('')
        // флаг отчётов о прочтении отсутствует на старых ответах → true
        expect(user.send_read_receipts).to.be.true
        // аватар — детерминированный из пула статики (id 7 → 8-я картинка):
        // avatar_url в ответе нет
        expect(user.avatar).to.eq('/images/avatars/8.svg')
    })

    // 2026-11-01-settings: профильные поля ответа — РЕАЛЬНЫЕ значения
    it('should map the REAL display_name, phone and send_read_receipts', () => {
        const user = toAuthUser({
            ...ownResponse,
            display_name: 'Ada Lovelace',
            phone: '+7 000 000 0000',
            send_read_receipts: false,
        })

        expect(user.display_name).to.eq('Ada Lovelace')
        expect(user.phone).to.eq('+7 000 000 0000')
        expect(user.send_read_receipts).to.be.false
    })

    it('should fall back display_name null to the email local part and phone null to empty', () => {
        const user = toAuthUser({ ...ownResponse, display_name: null, phone: null })

        expect(user.display_name).to.eq('ada')
        expect(user.phone).to.eq('')
    })

    it('should map the uploaded avatar_url onto AuthUser, null falls back to the pool', () => {
        const uploaded = toAuthUser({ ...ownResponse, avatar_url: '12/download' })

        // файловый путь как есть: компоненты аватаров резолвят не-слэшевые
        // значения через fileUrl
        expect(uploaded.avatar).to.eq('12/download')
        expect(toAuthUser({ ...ownResponse, avatar_url: null }).avatar).to.eq('/images/avatars/8.svg')
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
