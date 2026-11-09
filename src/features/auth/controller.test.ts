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
import { SIGNIN } from '../../utils/constants.ts'
import store from '../../utils/Store.ts'
import { AUTH_NETWORK_ERROR_MESSAGE, AuthFeatureController, registerSessionTeardown } from './controller.ts'
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

describe('auth controller: localSignOut — локальный выход после logout-all', () => {
    beforeEach(() => {
        store.set('user', null)
        store.set('authError', null)
        store.set('authLoading', false)
        sinon.stub(Router, 'go')
    })

    afterEach(() => {
        sinon.restore()
    })

    it('сбрасывает пользователя и уходит на страницу входа без серверного запроса', async () => {
        // 2026-11-07: /auth/logout-all сам снимает все куки — повторный
        // POST /auth/logout падает 403 по пустому csrf; выход остаётся локальным
        const controller = new AuthFeatureController(makePort())
        const go = Router.go as sinon.SinonStub

        store.set('user', { id: 5, login: 'ada@example.com' } as never)

        await controller.localSignOut()

        expect(store.getState().user ?? null).to.eq(null)
        expect(go.calledOnceWith(SIGNIN)).to.be.true
    })
})

describe('auth controller: выход сбрасывает сессию целиком (backlog п.2/п.10)', () => {
    // Живой смоук 2026-11-09: при выходе и входе другим аккаунтом
    // мессенджер показывал выбранный чат и ленту ПРЕДЫДУЩЕГО пользователя —
    // logout сбрасывал только user; сюда же п.10: мёртвый чат-сокет после
    // ре-логина ронял эхо и запуск бота
    beforeEach(() => {
        sinon.stub(Router, 'go')
    })

    afterEach(() => {
        sinon.restore()
        registerSessionTeardown(() => {})
        store.reset()
    })

    const seedSession = () => {
        store.set('user', { id: 1, login: 'ada@example.com' } as never)
        store.set('selectedChat', 5)
        store.set('messages', { 5: [{ id: 1, chat_id: 5, user_id: 1 } as never] })
        store.set('chats', [{ id: 5, title: 'Чат' } as never])
        store.set('chatUsers', [{ user_id: 2 } as never])
        store.set('stories', [{} as never])
        store.set('contacts', [{} as never])
    }

    it('logout очищает ВСЕ слайсы стора, а не только user', async () => {
        const controller = new AuthFeatureController(makePort())
        seedSession()

        await controller.logout()

        const state = store.getState() as Record<string, unknown>
        expect(state.user ?? null).to.eq(null)
        expect(state.selectedChat).to.be.undefined
        expect(state.messages).to.be.undefined
        expect(state.chats).to.be.undefined
        expect(state.chatUsers).to.be.undefined
        expect(state.stories).to.be.undefined
        // contacts пишется фичей через строковый keypath — в AppState тип
        // не входит, но переживать выход он обязан так же
        expect(state.contacts).to.be.undefined
    })

    it('logout гасит realtime-сокеты через сеансный шов ДО сброса стора', async () => {
        const teardown = sinon.spy(() => {
            // шов обязан отработать по ЖИВОМУ стору — до reset
            if (store.getState().user == null) {
                throw new Error('teardown вызван после сброса стора')
            }
        })
        registerSessionTeardown(teardown)
        const controller = new AuthFeatureController(makePort())
        seedSession()

        await controller.logout()

        expect(teardown.calledOnce).to.be.true
    })

    it('logout при лежащем сервере всё равно завершает локальную сессию', async () => {
        const controller = new AuthFeatureController(makePort({
            logout: () => Promise.reject(networkError),
        }))
        seedSession()

        await controller.logout()

        expect(store.getState().user ?? null).to.eq(null)
        expect(store.getState().selectedChat).to.be.undefined
        expect((Router.go as sinon.SinonStub).calledWith(SIGNIN)).to.be.true
    })

    it('localSignOut сбрасывает всё состояние, не только пользователя', () => {
        const controller = new AuthFeatureController(makePort())
        seedSession()

        controller.localSignOut()

        const state = store.getState()
        expect(state.user ?? null).to.eq(null)
        expect(state.selectedChat).to.be.undefined
        expect(state.messages).to.be.undefined
        expect(state.chats).to.be.undefined
    })
})
