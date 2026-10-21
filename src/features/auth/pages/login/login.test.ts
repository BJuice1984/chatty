// Регрессия (сеть/бэкенд недоступны): страница входа показывает authError
// из стора под формой — раньше сбой запроса не отображался вовсе. Шаблон
// грузится тестовым погрузчиком (прецедент — messenger/ai-assistant),
// компоненты-хелперы — импортом components.ts, как в прод-сборке main.ts.

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import Handlebars from 'handlebars'
import '../../../ai-assistant/hbs-test-loader.ts'
import type Block from '../../../../core/Block.ts'
import { registerComponent } from '../../../../core/registerComponent.ts'
import * as Components from '../../../../components/components.ts'
import store from '../../../../utils/Store.ts'
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
})
