// Регрессия (сеть/бэкенд недоступны): ошибки запросов авторизации должны
// попадать в стор (authError) и показываться на страницах входа/регистрации,
// а не оставаться только в console («кнопка молчит»). Сетевой сбой несёт свой
// текст, известные HTTP-статусы (401/409/422) — человекочитаемый текст карты
// (детали бэкенда — машинные коды), незнакомые — message бэкенда, 401 на
// /auth/me — тишина (легитимная неавторизованность, гард сам уводит на
// страницу входа).

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import sinon from 'sinon'
import { TransportError } from '../../utils/HTTPTransport.ts'
import Router from '../../utils/Router.ts'
import store from '../../utils/Store.ts'
import { AUTH_NETWORK_ERROR_MESSAGE, AuthFeatureController } from './controller.ts'
import type { AuthPort, AuthUser } from './ports.ts'

const dom = new JSDOM()
global.document = dom.window.document

const networkError = new TransportError('Ошибка сети. Запрос не выполнен', 'network')

const user: AuthUser = {
    id: 7,
    login: 'ada@example.com',
    email: 'ada@example.com',
    first_name: '',
    second_name: '',
    display_name: 'ada',
    phone: '',
    avatar: '',
    send_read_receipts: true,
}

function makePort(overrides: Partial<AuthPort> = {}): AuthPort {
    return {
        signin: async () => undefined,
        signup: async () => undefined,
        me: async () => user,
        logout: async () => undefined,
        ...overrides,
    }
}

describe('auth controller: ошибки запросов видны в сторе', () => {
    beforeEach(() => {
        store.set('authError', null)
        store.set('authLoading', false)
    })

    it('сетевой сбой входа кладёт сообщение об отсутствии связи', async () => {
        const controller = new AuthFeatureController(makePort({
            signin: () => Promise.reject(networkError),
        }))

        await controller.signin({ login: 'ada@example.com', password: 'LongPassword1' })

        expect(store.getState().authError).to.eq(AUTH_NETWORK_ERROR_MESSAGE)
    })

    it('401 входа — человекочитаемый текст, а не код бэкенда (invalid_credentials)', async () => {
        const controller = new AuthFeatureController(makePort({
            signin: () => Promise.reject(new TransportError('invalid_credentials', 'http', 401, { detail: 'invalid_credentials' })),
        }))

        await controller.signin({ login: 'ada@example.com', password: 'wrong-password' })

        expect(store.getState().authError).to.eq('Неверный email или пароль')
    })

    it('409 регистрации — текст о занятом email', async () => {
        const controller = new AuthFeatureController(makePort({
            signup: () => Promise.reject(new TransportError('email_already_registered', 'http', 409)),
        }))

        await controller.signup({
            email: 'ada@example.com',
            password: 'LongPassword1',
            confirm_password: 'LongPassword1',
        })

        expect(store.getState().authError).to.eq('Этот email уже зарегистрирован')
    })

    it('422 — текст о проверке полей (email/пароль от 12 символов)', async () => {
        const controller = new AuthFeatureController(makePort({
            signup: () => Promise.reject(new TransportError('Validation error', 'http', 422)),
        }))

        await controller.signup({
            email: 'not-an-email',
            password: 'short',
            confirm_password: 'short',
        })

        expect(store.getState().authError).to.eq('Проверьте поля: email — корректный адрес, пароль — минимум 12 символов')
    })

    it('незнакомый HTTP-статус остаётся с message бэкенда', async () => {
        const controller = new AuthFeatureController(makePort({
            signin: () => Promise.reject(new TransportError('Сервер отклонил запрос', 'http', 403)),
        }))

        await controller.signin({ login: 'ada@example.com', password: 'wrong-password' })

        expect(store.getState().authError).to.eq('Сервер отклонил запрос')
    })

    it('сетевой сбой регистрации виден так же', async () => {
        const controller = new AuthFeatureController(makePort({
            signup: () => Promise.reject(networkError),
        }))

        await controller.signup({
            email: 'ada@example.com',
            password: 'LongPassword1',
            confirm_password: 'LongPassword1',
        })

        expect(store.getState().authError).to.eq(AUTH_NETWORK_ERROR_MESSAGE)
    })

    it('повторная попытка затирает прошлую ошибку актуальной', async () => {
        store.set('authError', 'старая ошибка')
        const controller = new AuthFeatureController(makePort({
            signin: () => Promise.reject(new TransportError('Новая ошибка', 'http', 403)),
        }))

        await controller.signin({ login: 'ada@example.com', password: 'wrong-password' })

        expect(store.getState().authError).to.eq('Новая ошибка')
    })

    it('bootstrap /auth/me при сетевом сбое: пользователь сброшен, ошибка видна', async () => {
        const controller = new AuthFeatureController(makePort({
            me: () => Promise.reject(networkError),
        }))

        await controller.fetchUser()

        expect(store.getState().user ?? null).to.eq(null)
        expect(store.getState().authError).to.eq(AUTH_NETWORK_ERROR_MESSAGE)
    })

    it('401 на /auth/me — тишина: легитимная неавторизованность', async () => {
        const controller = new AuthFeatureController(makePort({
            me: () => Promise.reject(new TransportError('Unauthorized', 'http', 401)),
        }))

        await controller.fetchUser()

        expect(store.getState().authError ?? null).to.eq(null)
    })
})

describe('auth controller: authLoading — честное состояние полёта', () => {
    beforeEach(() => {
        store.set('authError', null)
        store.set('authLoading', false)
        // успешный signin зовёт Router.go — pushState протекает в общий
        // jsdom-history и ломает счётчики Router-тестов; глушим навигацию
        sinon.stub(Router, 'go')
    })

    afterEach(() => {
        sinon.restore()
    })

    it(' signin в полёте держит authLoading=true, после успеха сбрасывает', async () => {
        let resolveSignin!: () => void
        const controller = new AuthFeatureController(makePort({
            signin: () => new Promise<void>(resolve => {
                resolveSignin = resolve
            }),
        }))

        const flight = controller.signin({ login: 'ada@example.com', password: 'LongPassword1' })

        expect(store.getState().authLoading).to.eq(true)

        resolveSignin()
        await flight

        expect(store.getState().authLoading).to.eq(false)
    })

    it('signin после отказа тоже сбрасывает authLoading (finally, не только успех)', async () => {
        const controller = new AuthFeatureController(makePort({
            signin: () => Promise.reject(networkError),
        }))

        await controller.signin({ login: 'ada@example.com', password: 'wrong-password' })

        expect(store.getState().authLoading).to.eq(false)
        expect(store.getState().authError).to.eq(AUTH_NETWORK_ERROR_MESSAGE)
    })

    it('signup зеркалит поведение: полёт true, отказ сбрасывает', async () => {
        const controller = new AuthFeatureController(makePort({
            signup: () => Promise.reject(new TransportError('email_already_registered', 'http', 409)),
        }))

        const flight = controller.signup({
            email: 'ada@example.com',
            password: 'LongPassword1',
            confirm_password: 'LongPassword1',
        })

        await flight

        expect(store.getState().authLoading).to.eq(false)
        expect(store.getState().authError).to.eq('Этот email уже зарегистрирован')
    })
})
