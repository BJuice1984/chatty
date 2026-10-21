// Универсальный модальный слой (chats-social): оболочка с заголовком и
// слотом-контентом, закрытие по крестику, бэкдропу и Escape; клик внутри
// диалога модалку не закрывает. aria: role=dialog + aria-modal + aria-hidden
// в закрытом состоянии.

import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import '../../features/ai-assistant/hbs-test-loader.ts'
import { Modal } from './modal.ts'

const dom = new JSDOM()
global.document = dom.window.document

function clickOn(element: Element): void {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('modal layer', () => {
    it('renders the open shell with title, aria and the content slot', () => {
        const modal = new Modal({ title: 'Заголовок', content: '<p data-testid="slot">тело</p>', isOpen: true })

        expect(modal.element?.classList.contains('modal_open')).to.be.true
        expect(modal.element?.getAttribute('aria-hidden')).to.eq('false')
        expect(modal.element?.querySelector('[data-testid="modal-title"]')?.textContent?.trim()).to.eq('Заголовок')
        expect(modal.element?.querySelector('.modal__dialog')?.getAttribute('role')).to.eq('dialog')
        expect(modal.element?.querySelector('.modal__dialog')?.getAttribute('aria-modal')).to.eq('true')
        expect(modal.element?.querySelector('[data-testid="slot"]')?.textContent?.trim()).to.eq('тело')

        modal.destroy()
    })

    it('stays hidden with aria-hidden when closed', () => {
        const modal = new Modal({ title: 'Заголовок', isOpen: false })

        expect(modal.element?.classList.contains('modal_closed')).to.be.true
        expect(modal.element?.getAttribute('aria-hidden')).to.eq('true')

        modal.destroy()
    })

    it('closes by the cross button', () => {
        const onClose = sinon.spy()
        const modal = new Modal({ title: 'Заголовок', isOpen: true, onClose })

        clickOn(modal.element!.querySelector('[data-testid="modal-close"]')!)

        expect(onClose.calledOnce).to.be.true

        modal.destroy()
    })

    it('closes by the backdrop click', () => {
        const onClose = sinon.spy()
        const modal = new Modal({ title: 'Заголовок', isOpen: true, onClose })

        clickOn(modal.element!.querySelector('[data-testid="modal-backdrop"]')!)

        expect(onClose.calledOnce).to.be.true

        modal.destroy()
    })

    it('keeps open on a click inside the dialog and its content', () => {
        const onClose = sinon.spy()
        const modal = new Modal({ title: 'Заголовок', isOpen: true, onClose, content: '<button type="button" data-testid="inner">действие</button>' })

        clickOn(modal.element!.querySelector('[data-testid="inner"]')!)
        clickOn(modal.element!.querySelector('.modal__dialog')!)

        expect(onClose.called).to.be.false

        modal.destroy()
    })

    it('closes on Escape and ignores other keys', () => {
        const onClose = sinon.spy()
        const modal = new Modal({ title: 'Заголовок', isOpen: true, onClose })

        modal.element!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(onClose.called).to.be.false

        modal.element!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        expect(onClose.calledOnce).to.be.true

        modal.destroy()
    })
})
