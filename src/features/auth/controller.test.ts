// Регрессия (сеть/бэкенд недоступны): ошибки запросов авторизации должны
// попадать в стор (authError) и показываться на страницах входа/регистрации,
// а не оставаться только в console («кнопка молчит»). Сетевой сбой несёт свой
// текст, HTTP-отказ — message бэкенда, 401 на /auth/me — тишина (легитимная
// неавторизованность, гард сам уводит на страницу входа).

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import { TransportError } from '../../utils/HTTPTransport.ts'
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
    })

    it('сетевой сбой входа кладёт сообщение об отсутствии связи', async () => {
        const controller = new AuthFeatureController(makePort({
            signin: () => Promise.reject(networkError),
        }))

        await controller.signin({ login: 'ada@example.com', password: 'LongPassword1' })

        expect(store.getState().authError).to.eq(AUTH_NETWORK_ERROR_MESSAGE)
    })

    it('HTTP-отказ входа несёт message бэкенда (401)', async () => {
        const controller = new AuthFeatureController(makePort({
            signin: () => Promise.reject(new TransportError('Неверные учётные данные', 'http', 401)),
        }))

        await controller.signin({ login: 'ada@example.com', password: 'wrong-password' })

        expect(store.getState().authError).to.eq('Неверные учётные данные')
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
            signin: () => Promise.reject(new TransportError('Новые учётные данные', 'http', 401)),
        }))

        await controller.signin({ login: 'ada@example.com', password: 'wrong-password' })

        expect(store.getState().authError).to.eq('Новые учётные данные')
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
