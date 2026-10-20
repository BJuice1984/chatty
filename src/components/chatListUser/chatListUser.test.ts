// Элемент списка чатов (chats-social): ИИ-чаты визуально отличимы — бейдж
// ✦ AI рядом с названием и акцентный модификатор корня от is_ai
// (флаг приезжает из toChatInfo own-адаптера).

import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import '../../features/ai-assistant/hbs-test-loader.ts'
import { User } from './chatListUser.ts'

const dom = new JSDOM()
global.document = dom.window.document

describe('chat list user ai badge', () => {
    it('renders the AI badge and the accent modifier for an ai chat', () => {
        const user = new User({ id: 1, title: 'Ассистент', avatar: '', unread_count: 0, is_ai: true })

        const badge = user.element?.querySelector('[data-testid="ai-badge"]')

        expect(badge).to.exist
        expect(badge?.textContent?.trim()).to.contain('AI')
        expect(user.element?.classList.contains('chat-list-user_ai')).to.be.true

        user.destroy()
    })

    it('renders a plain row for a user chat', () => {
        const user = new User({ id: 2, title: 'Обычный чат', avatar: '', unread_count: 0, is_ai: false })

        expect(user.element?.querySelector('[data-testid="ai-badge"]')).to.not.exist
        expect(user.element?.classList.contains('chat-list-user_ai')).to.be.false

        user.destroy()
    })
})
