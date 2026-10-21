// Регрессия той же механики, что и login.test.ts: страница регистрации
// показывает authError из стора, включая значение, записанное ДО
// монтирования (bootstrap /auth/me при лежащем сервере). Шаблон грузится
// тестовым погрузчиком (прецедент — messenger/ai-assistant), компоненты —
// импортом components.ts, как в прод-сборке main.ts.

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import Handlebars from 'handlebars'
import '../../../ai-assistant/hbs-test-loader.ts'
import type Block from '../../../../core/Block.ts'
import { registerComponent } from '../../../../core/registerComponent.ts'
import * as Components from '../../../../components/components.ts'
import store from '../../../../utils/Store.ts'
import { RegisterPage } from './register.ts'

const dom = new JSDOM()
global.document = dom.window.document

Object.entries(Components).forEach(([name, component]) => {
    if (!(name in Handlebars.helpers)) {
        registerComponent(name, component as typeof Block)
    }
})

describe('register page: ошибка авторизации из стора', () => {
    beforeEach(() => {
        store.set('authError', null)
    })

    it('показывает authError, лежащую в сторе ещё до монтирования', () => {
        store.set('authError', 'Нет связи с сервером')

        const page = new RegisterPage({})

        expect(page.element?.querySelector('[data-testid="auth-error"]')?.textContent)
            .to.eq('Нет связи с сервером')
    })

    it('показывает authError, появившуюся после монтирования', () => {
        const page = new RegisterPage({})

        store.set('authError', 'Сервер не отвечает')

        const error = page.element?.querySelector('[data-testid="auth-error"]')

        expect(error?.textContent).to.eq('Сервер не отвечает')
    })

    it('без ошибки блок не рендерится', () => {
        const page = new RegisterPage({})

        expect(page.element?.querySelector('[data-testid="auth-error"]')).to.eq(null)
    })
})
