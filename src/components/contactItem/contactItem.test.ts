// Карточка контакта (2026-11-01-contacts): пользовательские данные — только
// через двойные скобки шаблона (XSS-пин: login с <script> рендерится
// текстом); клики по карточке и hover-кресту расходятся в свои колбэки с
// id контакта. Шаблон грузится тестовым погрузчиком (прецедент chatListUser),
// компонент-хелпер ChatAvatar — импортом components.ts, как в прод-сборке.

import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import '../../features/ai-assistant/hbs-test-loader.ts'
import Handlebars from 'handlebars'
import type Block from '../../core/Block.ts'
import { registerComponent } from '../../core/registerComponent.ts'
import * as Components from '../components.ts'
import { ContactItem } from './contactItem.ts'

const dom = new JSDOM()
global.document = dom.window.document

Object.entries(Components).forEach(([name, component]) => {
    if (!(name in Handlebars.helpers)) {
        registerComponent(name, component as typeof Block)
    }
})

describe('contact item card', () => {
    it('renders the avatar, display name and login', () => {
        const item = new ContactItem({
            id: 9,
            title: 'bob',
            subtitle: 'bob@example.com',
            avatar: '/images/pool/avatar-9.svg',
        })

        expect(item.element?.querySelector('.contact-item__title')?.textContent).to.equal('bob')
        expect(item.element?.querySelector('.contact-item__subtitle')?.textContent).to.equal('bob@example.com')
        expect(item.element?.querySelector('.contact-item__avatar img')?.getAttribute('src')).to.equal('/images/pool/avatar-9.svg')

        item.destroy()
    })

    it('renders a script-bearing login as text (XSS)', () => {
        const item = new ContactItem({
            id: 9,
            title: '<b>имя</b>',
            subtitle: '<script>alert(1)</script>@example.com',
            avatar: '',
        })

        const root = item.element as HTMLElement

        expect(root.querySelector('script')).to.not.exist
        expect(root.querySelector('.contact-item__subtitle')?.innerHTML).to.contain('&lt;script&gt;')
        expect(root.querySelector('.contact-item__subtitle')?.textContent).to.contain('<script>alert(1)</script>')
        expect(root.querySelector('.contact-item__title')?.innerHTML).to.contain('&lt;b&gt;')

        item.destroy()
    })

    it('fires onClick with the contact id on a card click', () => {
        const onClick = sinon.spy()
        const item = new ContactItem({
            id: 12,
            title: 'ada',
            subtitle: 'ada@example.com',
            avatar: '',
            onClick,
        })

        item.element?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

        expect(onClick.calledOnceWith(12)).to.be.true

        item.destroy()
    })

    it('fires onDelete instead of onClick on the hover cross', () => {
        const onClick = sinon.spy()
        const onDelete = sinon.spy()
        const item = new ContactItem({
            id: 12,
            title: 'ada',
            subtitle: 'ada@example.com',
            avatar: '',
            onClick,
            onDelete,
        })

        item.element?.querySelector('[data-testid="contact-item-delete"]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

        expect(onDelete.calledOnceWith(12)).to.be.true
        expect(onClick.called).to.be.false

        item.destroy()
    })
})
