// Регрессия LIVE-7: колбэки отправки/удаления читают this.props на момент
// клика, а не замыкание конструктора — selectedChat появляется только после
// выбора чата, конструкторное значение навсегда осталось бы undefined.
// chat-ui-polish: mapTypedMessages вешает showDate на первое сообщение дня.
// hbs-шаблон грузится тестовым погрузчиком (прецедент — ai-assistant).

import { expect } from 'chai'
import sinon from 'sinon'
import '../../features/ai-assistant/hbs-test-loader.ts'
import { mapTypedMessages, Messenger } from './messenger.ts'
import store from '../../utils/Store.ts'
import type { Message } from '../../utils/types.ts'

interface SubmitButton {
    type: string
    handleSubmitClick?: (value: { message: string }) => void
}

interface HeaderButton {
    extraClass: string
    handleClick?: () => void
}

function propsOf(messenger: unknown): {
    buttons: SubmitButton[]
    headerButtons: HeaderButton[]
} {
    return (messenger as unknown as { props: { buttons: SubmitButton[]; headerButtons: HeaderButton[] } }).props
}

describe('mapTypedMessages day markers', () => {
    // Локальная ISO-метка без зоны: день метки не зависит от таймзоны машины
    const iso = (date: Date) => {
        const pad = (value: number) => String(value).padStart(2, '0')

        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T12:00:00`
    }

    const dayAgo = (days: number) => {
        const date = new Date()

        date.setDate(date.getDate() - days)

        return date
    }

    const dto = (time: string): Message => ({ chat_id: 1, time, type: 'message', user_id: 7, content: `m-${time}` })

    it('flags the first message of each day with showDate', () => {
        const typed = mapTypedMessages([
            dto(iso(dayAgo(2))),
            dto(iso(dayAgo(1))),
            dto(iso(new Date())),
            dto(iso(new Date())),
        ], 7)

        expect(typed.map(message => message.showDate)).to.deep.equal([true, true, true, false])
    })

    it('keeps showDate off when the day does not change', () => {
        const typed = mapTypedMessages([
            dto(iso(new Date())),
            dto(iso(new Date())),
        ], 7)

        expect(typed.map(message => message.showDate)).to.deep.equal([true, false])
    })

    it('invalid time gets no marker and does not break the day chain', () => {
        const typed = mapTypedMessages([
            dto(iso(new Date())),
            dto('t1'),
            dto(iso(new Date())),
        ], 7)

        expect(typed.map(message => message.showDate)).to.deep.equal([true, false, false])
    })

    it('first message after an invalid one still marks a new day', () => {
        const typed = mapTypedMessages([
            dto('t1'),
            dto(iso(dayAgo(1))),
        ], 7)

        expect(typed.map(message => message.showDate)).to.deep.equal([false, true])
    })

    it('maps the bubble side and passes time through', () => {
        const nowIso = iso(new Date())
        const typed = mapTypedMessages([
            { ...dto(nowIso), user_id: 7 },
            { ...dto(nowIso), user_id: 42 },
        ], 7)

        expect(typed[0].isMine).to.be.true
        expect(typed[1].isMine).to.be.false
        expect(typed[0].time).to.equal(nowIso)
    })
})

describe('messenger action dispatch', () => {
    afterEach(() => {
        store.set('messages', undefined)
        store.set('selectedChat', undefined)
    })

    it('carries the current selectedChat into the send callback (LIVE-7)', () => {
        const onSendMessage = sinon.spy()
        const messenger = new Messenger({ onSendMessage } as never)

        try {
            // Чат выбрали ПОСЛЕ монтирования — Store обновляет пропсы через withStore
            store.set('messages', { 5: [] })
            store.set('selectedChat', 5)

            const send = propsOf(messenger).buttons.find(button => button.type === 'submit')

            send?.handleSubmitClick?.({ message: 'привет' })

            expect(onSendMessage.calledOnceWith(5, 'привет')).to.be.true
        } finally {
            messenger.destroy()
        }
    })

    it('keeps the send dispatch silent until a chat is selected (LIVE-7)', () => {
        const onSendMessage = sinon.spy()
        const messenger = new Messenger({ onSendMessage } as never)

        try {
            const send = propsOf(messenger).buttons.find(button => button.type === 'submit')

            send?.handleSubmitClick?.({ message: 'привет' })

            expect(onSendMessage.called).to.be.false
        } finally {
            messenger.destroy()
        }
    })

    it('carries the current selectedChat into the delete-chat callback (LIVE-7)', () => {
        const onDeleteChat = sinon.spy()
        const messenger = new Messenger({ onDeleteChat } as never)

        try {
            store.set('messages', { 7: [] })
            store.set('selectedChat', 7)

            const close = propsOf(messenger).headerButtons.find(button => button.extraClass === 'close')

            close?.handleClick?.()

            expect(onDeleteChat.calledOnceWith(7)).to.be.true
        } finally {
            messenger.destroy()
        }
    })
})
