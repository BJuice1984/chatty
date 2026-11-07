// Регрессия (сеть/бэкенд недоступны): страница входа показывает authError
// из стора под формой — раньше сбой запроса не отображался вовсе. Шаблон
// грузится тестовым погрузчиком (прецедент — messenger/ai-assistant),
// компоненты-хелперы — импортом components.ts, как в прод-сборке main.ts.

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import sinon from 'sinon'
import Handlebars from 'handlebars'
import Router from '../../../../utils/Router.ts'
import { SIGNUP } from '../../../../utils/constants.ts'
import '../../../ai-assistant/hbs-test-loader.ts'
import type Block from '../../../../core/Block.ts'
import { registerComponent } from '../../../../core/registerComponent.ts'
import * as Components from '../../../../components/components.ts'
import store from '../../../../utils/Store.ts'
import AuthController from '../../controller.ts'
import type { SignInRequest } from '../../ports.ts'
import { LoginPage } from './login.ts'

const dom = new JSDOM()
global.document = dom.window.document

Object.entries(Components).forEach(([name, component]) => {
    if (!(name in Handlebars.helpers)) {
        registerComponent(name, component as typeof Block)
    }
})

describe('login page: ошибка авторизации из стора', () => {
    beforeEach(() => {
        store.set('authError', null)
        store.set('authLoading', false)
    })

    it('показывает authError, лежащую в сторе ещё до монтирования', () => {
        // кейс холодной загрузки: bootstrap /auth/me упал по сети, ошибка
        // записана в стор ДО создания страницы — конструктор страницы не
        // должен затирать начальные стор-пропсы (раньше сообщение
        // появлялось только после первого сабмита)
        store.set('authError', 'Нет связи с сервером')

        const page = new LoginPage({})

        expect(page.element?.querySelector('[data-testid="auth-error"]')?.textContent)
            .to.eq('Нет связи с сервером')
    })

    it('показывает authError, появившуюся после монтирования', () => {
        const page = new LoginPage({})

        store.set('authError', 'Нет связи с сервером')

        const error = page.element?.querySelector('[data-testid="auth-error"]')

        expect(error?.textContent).to.eq('Нет связи с сервером')
    })

    it('без ошибки блок не рендерится', () => {
        const page = new LoginPage({})

        expect(page.element?.querySelector('[data-testid="auth-error"]')).to.eq(null)
    })

    it('введённые значения переживают перерисовку с ошибкой (2026-11-07)', () => {
        const page = new LoginPage({})
        const loginInput = page.element?.querySelector<HTMLInputElement>('input[name="login"]')
        const passwordInput = page.element?.querySelector<HTMLInputElement>('input[name="password"]')

        loginInput!.value = 'ada@example.com'
        passwordInput!.value = 'LongPassword1'

        store.set('authError', 'Неверный email или пароль')

        const error = page.element?.querySelector('[data-testid="auth-error"]')
        const loginAfter = page.element?.querySelector<HTMLInputElement>('input[name="login"]')
        const passwordAfter = page.element?.querySelector<HTMLInputElement>('input[name="password"]')

        expect(error?.textContent).to.eq('Неверный email или пароль')
        expect(loginAfter?.value).to.eq('ada@example.com')
        expect(passwordAfter?.value).to.eq('LongPassword1')
    })

    it('значения переживают и лоадер-перерисовку', () => {
        const page = new LoginPage({})
        const loginInput = page.element?.querySelector<HTMLInputElement>('input[name="login"]')

        loginInput!.value = 'ada@example.com'

        store.set('authLoading', true)

        const loginAfter = page.element?.querySelector<HTMLInputElement>('input[name="login"]')

        expect(loginAfter?.value).to.eq('ada@example.com')
    })

    it('в полёте submit-кнопка disabled с лейблом «Signing in…», после — возвращается', () => {
        const page = new LoginPage({})
        const submitBefore = page.element?.querySelector<HTMLButtonElement>('button[type="submit"]')

        expect(submitBefore?.disabled).to.eq(false)
        expect(submitBefore?.textContent?.trim()).to.eq('Sign in')

        store.set('authLoading', true)

        const submitDuring = page.element?.querySelector<HTMLButtonElement>('button[type="submit"]')

        expect(submitDuring?.disabled).to.eq(true)
        expect(submitDuring?.textContent?.trim()).to.eq('Signing in…')

        store.set('authLoading', false)

        const submitAfter = page.element?.querySelector<HTMLButtonElement>('button[type="submit"]')

        expect(submitAfter?.disabled).to.eq(false)
        expect(submitAfter?.textContent?.trim()).to.eq('Sign in')
    })

    it('вторичная кнопка не трогается лоадером', () => {
        const page = new LoginPage({})

        store.set('authLoading', true)

        const secondary = page.element?.querySelector<HTMLButtonElement>('button[type="button"]')

        expect(secondary?.disabled).to.eq(false)
        expect(secondary?.textContent?.trim()).to.eq('Sign up')
    })

    it('переход на sign-up сбрасывает висящую ошибку входа (2026-11-07)', () => {
        const goStub = sinon.stub(Router, 'go')
        const page = new LoginPage({})

        store.set('authError', 'Неверный email или пароль')
        expect(page.element?.querySelector('[data-testid="auth-error"]')).to.be.not.null

        page.element?.querySelector<HTMLButtonElement>('button[type="button"]')?.click()

        expect(store.getState().authError ?? null).to.eq(null)
        expect(page.element?.querySelector('[data-testid="auth-error"]')).to.eq(null)
        expect(goStub.calledOnceWith(SIGNUP)).to.be.true

        goStub.restore()
    })

    // FA-1 (финальный аудит auth-session-ux, follow-up): submit доезжает
    // до обработчика страницы даже через disabled-кнопку (Enter в инпуте) —
    // гвард обязан молчать, пока authLoading в полёте. Пин дергает сам
    // handleSubmitClick (уровень гварда), т.к. Form пересоздаётся на каждом
    // store-эмите и живой submit-путь пинится отдельными Form-тестами
    it('Enter-сабмит в полёте игнорируется гвардом authLoading (FA-1)', () => {
        const signin = sinon.stub(AuthController, 'signin').resolves()

        try {
            const page = new LoginPage({})
            const submitHandler = () => {
                const buttons = (page as unknown as { props: { buttons: { type: string, handleSubmitClick?: (value: SignInRequest) => void }[] } }).props.buttons
                const submit = buttons.find(button => button.type === 'submit')

                submit?.handleSubmitClick?.({ login: 'ada@example.com', password: 'LongPassword1' })
            }

            store.set('authLoading', true)

            submitHandler()

            expect(signin.called).to.be.false

            store.set('authLoading', false)

            submitHandler()

            expect(signin.calledOnce).to.be.true

            page.destroy()
        } finally {
            signin.restore()
        }
    })
})
