// Нижняя панель (2026-11-01-contacts): иконка «Контакты» стала маршрутом —
// Router.go(CONTACTS) и активная подсветка на /contacts; «Чаты» прежняя —
// Router.go(MESSENGER), активна на /messenger. Путь читается при
// конструировании, поэтому каждый кейс собирает свой jsdom с нужным url.

import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import Handlebars from 'handlebars'
import '../../features/ai-assistant/hbs-test-loader.ts'
import type Block from '../../core/Block.ts'
import { registerComponent } from '../../core/registerComponent.ts'
import * as Components from '../components.ts'
import Router from '../../utils/Router.ts'
import { CONTACTS, MESSENGER } from '../../utils/constants.ts'
import { BottomBar } from './bottomBar.ts'

const dom = new JSDOM('<body></body>', { url: 'http://localhost:3000/messenger' })
global.document = dom.window.document

Object.entries(Components).forEach(([name, component]) => {
    if (!(name in Handlebars.helpers)) {
        registerComponent(name, component as typeof Block)
    }
})

const mountAt = (pathname: string): void => {
    global.document = new JSDOM('<body></body>', { url: `http://localhost:3000${pathname}` }).window.document
}

// события — из окна текущего document: домены jsdom у кейсов разные
const viewOf = (): typeof window =>
    (document.defaultView ?? window) as typeof window

const itemByAlt = (bar: { element?: Element | null }, alt: string): Element | null =>
    bar.element?.querySelector(`img[alt="${alt}"]`)?.closest('.chat-bottom-bar__item') ?? null

describe('bottom bar contacts route', () => {
    afterEach(() => {
        mountAt('/messenger')
    })

    it('navigates to /contacts from the contacts icon', () => {
        const go = sinon.stub(Router, 'go')

        try {
            const bar = new BottomBar()

            itemByAlt(bar, 'Иконка. Контакты')?.dispatchEvent(new (viewOf().MouseEvent)('click', { bubbles: true }))

            expect(go.calledOnceWith(CONTACTS)).to.be.true

            bar.destroy()
        } finally {
            go.restore()
        }
    })

    it('keeps the chats icon on /messenger', () => {
        mountAt(CONTACTS)
        const go = sinon.stub(Router, 'go')

        try {
            const bar = new BottomBar()

            itemByAlt(bar, 'Иконка. Чаты')?.dispatchEvent(new (viewOf().MouseEvent)('click', { bubbles: true }))

            expect(go.calledOnceWith(MESSENGER)).to.be.true

            bar.destroy()
        } finally {
            go.restore()
        }
    })

    it('highlights the contacts icon on /contacts while chats stays plain', () => {
        mountAt(CONTACTS)

        const bar = new BottomBar()

        expect(itemByAlt(bar, 'Иконка. Контакты')?.classList.contains('chat-bottom-bar__item_active')).to.be.true
        expect(itemByAlt(bar, 'Иконка. Чаты')?.classList.contains('chat-bottom-bar__item_active')).to.be.false

        bar.destroy()
    })

    it('highlights the chats icon on /messenger while contacts stays plain', () => {
        const bar = new BottomBar()

        expect(itemByAlt(bar, 'Иконка. Чаты')?.classList.contains('chat-bottom-bar__item_active')).to.be.true
        expect(itemByAlt(bar, 'Иконка. Контакты')?.classList.contains('chat-bottom-bar__item_active')).to.be.false

        bar.destroy()
    })
})
