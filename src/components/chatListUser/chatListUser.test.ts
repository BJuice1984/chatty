// Элемент списка чатов (chats-social): ИИ-чаты визуально отличимы — бейдж
// ✦ AI рядом с названием и акцентный модификатор корня от is_ai
// (флаг приезжает из toChatInfo own-адаптера).
// 2026-11-01-chat-leave: архивное членство (leftAt из GET /chats) гасит
// карточку — потушенный модификатор корня.

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

// Архивное членство (2026-11-01-chat-leave): выход из чата оставляет его в
// списке — карточка гаснет модификатором от leftAt (null/undefined — актив)
describe('chat list user archived modifier', () => {
    it('renders the dimmed archived modifier for a left chat', () => {
        const user = new User({
            id: 3,
            title: 'Покинутый чат',
            avatar: '',
            unread_count: 0,
            leftAt: '2026-11-01T10:00:00Z',
        })

        expect(user.element?.classList.contains('chat-list-user_archived')).to.be.true

        user.destroy()
    })

    it('keeps the plain row for an active membership', () => {
        const user = new User({
            id: 4,
            title: 'Активный чат',
            avatar: '',
            unread_count: 0,
            leftAt: null,
        })

        expect(user.element?.classList.contains('chat-list-user_archived')).to.be.false

        user.destroy()
    })
})

// 2026-11-07-messenger-ux-pack-2: бейдж AI вынесен из обрезающего заголовка
// в flex-сиблинг — при сколь угодно длинном названии бейдж всегда виден
describe('chat list user badge visibility', () => {
    it('keeps the badge OUTSIDE the truncating title element as a flex sibling', () => {
        const user = new User({
            id: 5,
            title: 'Очень длинное название чата, которое обрезается эллипсисом в одну строку',
            avatar: '',
            unread_count: 0,
            is_ai: true,
        })

        const title = user.element?.querySelector('.chat-list-user__title')
        const row = user.element?.querySelector('.chat-list-user__title-row')
        const badge = user.element?.querySelector('[data-testid="ai-badge"]')

        expect(badge?.parentElement?.classList.contains('chat-list-user__title-row')).to.be.true
        expect(title?.contains(badge as Node)).to.be.false
        expect(row).to.be.not.null

        user.destroy()
    })
})

// 2026-11-07-messenger-ux-pack-2: мёртвый сокет подсвечивает строку красным
// модификатором (в композиции с ai/archived) — источник: стор-ключ wsDeadChats
describe('chat list user dead modifier', () => {
    it('renders the red dead modifier for a socket-dead chat', () => {
        const user = new User({
            id: 6,
            title: 'Оборванный чат',
            avatar: '',
            unread_count: 0,
            isDead: true,
        })

        expect(user.element?.classList.contains('chat-list-user_dead')).to.be.true

        user.destroy()
    })

    it('keeps the plain row for a live chat', () => {
        const user = new User({
            id: 7,
            title: 'Живой чат',
            avatar: '',
            unread_count: 0,
        })

        expect(user.element?.classList.contains('chat-list-user_dead')).to.be.false

        user.destroy()
    })
})

// 2026-11-05-messenger-ux-pack: карточка списка больше НЕ кнопка смены
// аватара — ни скрытого file-инпута, ни кликабельного аватара; аффорданс
// переехал в шапку мессенджера (owner-only)
describe('chat list user avatar affordance removed', () => {
    it('renders no hidden avatar file input', () => {
        const user = new User({ id: 5, title: 'Чат', avatar: '', unread_count: 0 })

        expect(user.element?.querySelector('input[type="file"]')).to.not.exist

        user.destroy()
    })

    it('keeps the avatar presentational: no refs to a picker', () => {
        const user = new User({ id: 6, title: 'Чат', avatar: '', unread_count: 0 })

        const refs = (user as unknown as { refs: Record<string, unknown> }).refs

        expect(refs.fileInput).to.be.undefined
        expect(user.element?.querySelector('.chat-list-user__img')).to.exist

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
            last_message: { time: '2026-10-19T09:07:00', content: 'последняя реплика' },
        })

        const snippet = user.element?.querySelector('.chat-list-user__snippet')
        expect(snippet?.textContent?.trim()).to.equal('последняя реплика')
        expect(snippet?.querySelector('mark')).to.not.exist
        expect(user.element?.querySelector('.chat-list-user__time')?.textContent?.trim()).to.equal('09:07')

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
            last_message: { time: '2026-10-01T01:02:00', content: 'x' },
            searchTime: '2026-10-20T13:45:00',
        })

        expect(user.element?.querySelector('.chat-list-user__time')?.textContent?.trim()).to.equal('13:45')

        user.destroy()
    })

    it('renders an empty time row for an invalid last-message time (no throw)', () => {
        // фикстуры ws гоняют метки вида 't'+id — строка времени пустая,
        // карточка жива (прецедент message.ts)
        const user = new User({
            id: 8,
            title: 'Almond',
            avatar: '',
            unread_count: 0,
            last_message: { time: 't17', content: 'мусорная метка' },
        })

        expect(user.element?.querySelector('.chat-list-user__time')?.textContent?.trim()).to.equal('')

        user.destroy()
    })
})
