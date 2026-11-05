// Иконки шапки списка чатов (2026-11-05-messenger-ux-pack): вторая иконка —
// «Пометить всё прочитанными» (бывшие настройки), активна только при
// наличии непрочитанных.

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import sinon from 'sinon'
import '../../features/ai-assistant/hbs-test-loader.ts'
import { HeaderIcons } from './headerIcons.ts'

const dom = new JSDOM()
global.document = dom.window.document

describe('header icons mark-all-read', () => {
    it('renders the create-chat icon and the mark-all-read icon with the new alt', () => {
        const icons = new HeaderIcons({ src: '', alt: '', onClick: () => {} })

        const images = icons.element?.querySelectorAll('img.chat__header-icon')

        expect(images?.length).to.eq(2)
        expect(images?.[0]?.getAttribute('src')).to.eq('/images/start-chat-icon.svg')
        expect(images?.[1]?.getAttribute('src')).to.eq('/images/mark-all-read-icon.svg')
        expect(images?.[1]?.getAttribute('alt')).to.eq('Иконка. Пометить всё прочитанными')

        icons.destroy()
    })

    it('disables the mark-all-read icon without unread (modifier + aria + no dispatch)', () => {
        const onMarkAllRead = sinon.spy()
        const icons = new HeaderIcons({ src: '', alt: '', onClick: () => {}, hasUnread: false, onMarkAllRead })

        const second = icons.element?.querySelectorAll('img.chat__header-icon')[1]

        expect(second?.classList.contains('chat__header-icon_disabled')).to.be.true
        expect(second?.getAttribute('aria-disabled')).to.eq('true')

        second?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

        expect(onMarkAllRead.called).to.be.false

        icons.destroy()
    })

    it('fires onMarkAllRead from an active icon when unread exists', () => {
        const onMarkAllRead = sinon.spy()
        const icons = new HeaderIcons({ src: '', alt: '', onClick: () => {}, hasUnread: true, onMarkAllRead })

        const second = icons.element?.querySelectorAll('img.chat__header-icon')[1]

        expect(second?.classList.contains('chat__header-icon_disabled')).to.be.false

        second?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

        expect(onMarkAllRead.calledOnce).to.be.true

        icons.destroy()
    })
})
