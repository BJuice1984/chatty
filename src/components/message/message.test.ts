// Пузырь сообщения (chat-ui-polish): сторона mine/theirs модификатором на li,
// время ЧЧ:ММ из ISO-метки, маркер дня только по showDate и NaN-безопасность —
// невалидная метка (фикстуры ws гоняют time вида 't'+id) рендерится без
// времени и маркера и не кидает RangeError из Intl.
// hbs-шаблон грузится тестовым погрузчиком (прецедент — ai-assistant).

import { expect } from 'chai'
import sinon from 'sinon'
import '../../features/ai-assistant/hbs-test-loader.ts'
import { Message } from './message.ts'

// Локальная ISO-метка без зоны: парсится в локальном времени, поэтому
// ожидаемые ЧЧ:ММ и «Сегодня» не зависят от таймзоны машины с тестами
function localIso(date: Date, hhmm = '12:00:00'): string {
    const pad = (value: number) => String(value).padStart(2, '0')

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${hhmm}`
}

const yesterday = () => {
    const date = new Date()

    date.setDate(date.getDate() - 1)

    return date
}

describe('message bubble', () => {
    it('right side: mine modifier on the li', () => {
        const message = new Message({ content: 'привет', user_id: 1, isMine: true, time: localIso(new Date()) })

        expect(message.element?.classList.contains('messenger__container-message_mine')).to.be.true
        message.destroy()
    })

    it('left side: theirs modifier on the li', () => {
        const message = new Message({ content: 'привет', user_id: 2, isMine: false, time: localIso(new Date()) })

        expect(message.element?.classList.contains('messenger__container-message_theirs')).to.be.true
        message.destroy()
    })

    it('system error: yellow _error modifier on the bubble only with isError', () => {
        // провайдер бота недоступен: контроллер пишет сообщение с isError,
        // пузырь подсвечивается жёлтым (chats-social, provider_failed)
        const failed = new Message({ content: '⚠ Ассистент недоступен', user_id: -1, isMine: false, isError: true, time: localIso(new Date()) })
        const normal = new Message({ content: 'привет', user_id: 2, isMine: false, time: localIso(new Date()) })

        expect(failed.element?.querySelector('.messenger__message-bubble')?.classList.contains('messenger__message-bubble_error')).to.be.true
        expect(normal.element?.querySelector('.messenger__message-bubble')?.classList.contains('messenger__message-bubble_error')).to.be.false

        failed.destroy()
        normal.destroy()
    })

    it('renders HH:MM from the ISO time', () => {
        const message = new Message({ content: 'привет', user_id: 1, time: '2026-10-19T09:07:00' })

        expect(message.element?.querySelector('.messenger__message-time')?.textContent?.trim()).to.equal('09:07')
        message.destroy()
    })

    it('renders the day marker only when showDate is set', () => {
        const withMarker = new Message({ content: 'привет', user_id: 1, time: localIso(new Date()), showDate: true })
        const withoutMarker = new Message({ content: 'привет', user_id: 1, time: localIso(new Date()), showDate: false })

        expect(withMarker.element?.querySelector('.messenger__message-day')?.textContent?.trim()).to.equal('Сегодня')
        expect(withoutMarker.element?.querySelector('.messenger__message-day')).to.not.exist

        withMarker.destroy()
        withoutMarker.destroy()
    })

    it('labels yesterday as «Вчера»', () => {
        const message = new Message({ content: 'привет', user_id: 1, time: localIso(yesterday()), showDate: true })

        expect(message.element?.querySelector('.messenger__message-day')?.textContent?.trim()).to.equal('Вчера')
        message.destroy()
    })

    it('labels a date of another year with the year', () => {
        const message = new Message({ content: 'привет', user_id: 1, time: '2020-05-01T10:00:00', showDate: true })
        const label = message.element?.querySelector('.messenger__message-day')?.textContent?.trim() ?? ''

        expect(label).to.include('2020')
        message.destroy()
    })

    it('invalid time: no time node, no day marker, no throw', () => {
        const render = () => {
            const message = new Message({ content: 'привет', user_id: 1, time: 't17', showDate: true })

            expect(message.element?.querySelector('.messenger__message-time')).to.not.exist
            expect(message.element?.querySelector('.messenger__message-day')).to.not.exist
            message.destroy()
        }

        expect(render).to.not.throw()
    })

    it('empty time renders without the time node', () => {
        const message = new Message({ content: 'привет', user_id: 1, time: '' })

        expect(message.element?.querySelector('.messenger__message-time')).to.not.exist
        message.destroy()
    })

    it('missing time renders the bubble anyway', () => {
        const message = new Message({ content: 'привет', user_id: 1 })

        expect(message.element?.querySelector('.messenger__message-content')?.textContent?.trim()).to.equal('привет')
        expect(message.element?.querySelector('.messenger__message-time')).to.not.exist
        message.destroy()
    })
})

// Реакции и реплаи (chats-social): аффордансы только у сообщений с id,
// чипы с подсветкой своего, фиксированный набор эмодзи, блок цитаты —
// NaN-safe (мусорный/пустой сниппет не рендерится).

describe('message reactions affordances', () => {
    it('renders the actions for an identified message and hides them without id', () => {
        const withId = new Message({ content: 'привет', user_id: 1, chat_id: 3, id: 11 })
        const withoutId = new Message({ content: 'привет', user_id: 1 })

        expect(withId.element?.querySelector('[data-testid="message-actions"]')).to.exist
        expect(withId.element?.querySelector('[data-testid="message-reactions-toggle"]')).to.exist
        expect(withId.element?.querySelector('[data-testid="message-reply"]')).to.exist
        expect(withoutId.element?.querySelector('[data-testid="message-actions"]')).to.not.exist

        withId.destroy()
        withoutId.destroy()
    })

    it('opens the fixed emoji set on the affordance click and closes after pick', () => {
        const onSetReaction = sinon.spy()
        const message = new Message({ content: 'привет', user_id: 1, chat_id: 3, id: 11, onSetReaction })

        message.element?.querySelector('[data-testid="message-reactions-toggle"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        const picker = message.element?.querySelector('[data-testid="emoji-picker"]')

        expect(picker).to.exist
        expect(picker?.querySelectorAll('[data-testid="emoji-option"]')).to.have.length(6)

        picker?.querySelector<HTMLButtonElement>('[data-emoji="❤️"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(onSetReaction.calledOnceWith(3, 11, '❤️')).to.be.true
        expect(message.element?.querySelector('[data-testid="emoji-picker"]')).to.not.exist

        message.destroy()
    })

    it('toggles a reaction from the chip click', () => {
        const onSetReaction = sinon.spy()
        const message = new Message({
            content: 'привет',
            user_id: 1,
            chat_id: 3,
            id: 11,
            onSetReaction,
            reactions: [{ emoji: '👍', count: 2, mine: true }],
        })

        message.element?.querySelector<HTMLButtonElement>('[data-testid="reaction-chip"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(onSetReaction.calledOnceWith(3, 11, '👍')).to.be.true

        message.destroy()
    })

    it('renders chips with counts and highlights the own one', () => {
        const message = new Message({
            content: 'привет',
            user_id: 1,
            chat_id: 3,
            id: 11,
            reactions: [
                { emoji: '👍', count: 2, mine: true },
                { emoji: '😂', count: 1, mine: false },
            ],
        })

        const chips = message.element?.querySelectorAll('[data-testid="reaction-chip"]') ?? []

        expect(chips).to.have.length(2)
        expect(chips[0].classList.contains('messenger__reaction-chip_mine')).to.be.true
        expect(chips[1].classList.contains('messenger__reaction-chip_mine')).to.be.false
        expect(chips[0].querySelector('[data-testid="reaction-count"]')?.textContent?.trim()).to.equal('2')

        message.destroy()
    })

    it('renders no chips row for an empty summary', () => {
        const message = new Message({ content: 'привет', user_id: 1, chat_id: 3, id: 11, reactions: [] })

        expect(message.element?.querySelector('[data-testid="message-reactions"]')).to.not.exist

        message.destroy()
    })

    it('emits the reply draft from the reply action', () => {
        const onReply = sinon.spy()
        const message = new Message({ content: 'цитируемое', user_id: 1, chat_id: 3, id: 11, onReply })

        message.element?.querySelector('[data-testid="message-reply"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(onReply.calledOnceWith({ id: 11, snippet: 'цитируемое' })).to.be.true

        message.destroy()
    })
})

describe('message reply quote block', () => {
    it('renders the quoted snippet with the reply label', () => {
        const message = new Message({
            content: 'ответ',
            user_id: 1,
            chat_id: 3,
            id: 12,
            replyTo: { id: 11, user_id: 2, snippet: 'первое сообщение' },
        })

        const quote = message.element?.querySelector('[data-testid="message-quote"]')

        expect(quote?.textContent?.trim()).to.contain('В ответ')
        expect(quote?.textContent?.trim()).to.contain('первое сообщение')

        message.destroy()
    })

    it('NaN-safe: null quote and empty snippet render no block', () => {
        const nullQuote = new Message({ content: 'ответ', user_id: 1, replyTo: null })
        const emptySnippet = new Message({
            content: 'ответ',
            user_id: 1,
            replyTo: { id: 11, user_id: 2, snippet: '' },
        })

        expect(nullQuote.element?.querySelector('[data-testid="message-quote"]')).to.not.exist
        expect(emptySnippet.element?.querySelector('[data-testid="message-quote"]')).to.not.exist

        nullQuote.destroy()
        emptySnippet.destroy()
    })
})
