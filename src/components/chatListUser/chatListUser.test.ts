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

// Живой поиск (2026-10-26-chat-search): совпадение подсвечивается <mark>
// в заголовке и/или сниппете; без частей строка остаётся обычной последней
// репликой. Сервер отдаёт сырые подстроки — вставка только после
// экранирования (escape-then-wrap).
describe('chat list user search highlight', () => {
    it('marks the matched fragment in the title', () => {
        const user = new User({
            id: 7,
            title: 'Design chat',
            avatar: '',
            unread_count: 0,
            titleParts: { before: 'De', match: 'sign', after: ' chat' },
        })

        const mark = user.element?.querySelector('.chat-list-user__title mark')
        expect(mark?.textContent).to.equal('sign')
        expect(user.element?.querySelector('.chat-list-user__title')?.textContent).to.contain('Design chat')

        user.destroy()
    })

    it('marks the snippet and keeps the title plain', () => {
        const user = new User({
            id: 7,
            title: 'Almond',
            avatar: '',
            unread_count: 0,
            last_message: { time: '10:00', content: 'calm sea' },
            snippetParts: { before: 'ca', match: 'lm', after: ' sea' },
        })

        const mark = user.element?.querySelector('.chat-list-user__snippet mark')
        expect(mark?.textContent).to.equal('lm')
        expect(user.element?.querySelector('.chat-list-user__snippet')?.textContent).to.contain('calm sea')
        expect(user.element?.querySelector('.chat-list-user__title mark')).to.not.exist

        user.destroy()
    })

    it('renders the plain last-message line without a query', () => {
        const user = new User({
            id: 7,
            title: 'Almond',
            avatar: '',
            unread_count: 0,
            last_message: { time: '10:00', content: 'последняя реплика' },
        })

        const snippet = user.element?.querySelector('.chat-list-user__snippet')
        expect(snippet?.textContent?.trim()).to.equal('последняя реплика')
        expect(snippet?.querySelector('mark')).to.not.exist
        expect(user.element?.querySelector('.chat-list-user__time')?.textContent).to.equal('10:00')

        user.destroy()
    })

    it('escapes the raw snippet parts (XSS)', () => {
        const user = new User({
            id: 7,
            title: 'Безопасность',
            avatar: '',
            unread_count: 0,
            snippetParts: { before: '<script>', match: 'alert', after: '</script>' },
        })

        const snippet = user.element?.querySelector('.chat-list-user__snippet')
        expect(snippet?.innerHTML).to.not.contain('<script')
        expect(snippet?.innerHTML).to.contain('&lt;script&gt;')
        expect(snippet?.querySelector('mark')?.textContent).to.equal('alert')

        user.destroy()
    })

    it('falls back to the plain content when the match has no snippet', () => {
        // R-F2: matched_in 'both' без окна сниппета — без mark и без падения
        const user = new User({
            id: 7,
            title: 'Almond',
            avatar: '',
            unread_count: 0,
            last_message: { time: '10:00', content: 'реплика без окна' },
            titleParts: { before: 'Al', match: 'mo', after: 'nd' },
            snippetParts: null,
        })

        const snippet = user.element?.querySelector('.chat-list-user__snippet')
        expect(snippet?.textContent?.trim()).to.equal('реплика без окна')
        expect(snippet?.querySelector('mark')).to.not.exist
        expect(user.element?.querySelector('.chat-list-user__title mark')?.textContent).to.equal('mo')

        user.destroy()
    })

    it('shows the search time instead of the last-message time while searching', () => {
        const user = new User({
            id: 7,
            title: 'Almond',
            avatar: '',
            unread_count: 0,
            last_message: { time: '2026-01-01T00:00:00Z', content: 'x' },
            searchTime: '2026-10-20T10:00:00Z',
        })

        expect(user.element?.querySelector('.chat-list-user__time')?.textContent).to.equal('2026-10-20T10:00:00Z')

        user.destroy()
    })
})
