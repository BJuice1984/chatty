// Пузырь сообщения (chat-ui-polish): сторона mine/theirs модификатором на li,
// время ЧЧ:ММ из ISO-метки, маркер дня только по showDate и NaN-безопасность —
// невалидная метка (фикстуры ws гоняют time вида 't'+id) рендерится без
// времени и маркера и не кидает RangeError из Intl.
// hbs-шаблон грузится тестовым погрузчиком (прецедент — ai-assistant).

import { expect } from 'chai'
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
