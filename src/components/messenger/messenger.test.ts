// Регрессия LIVE-7: колбэки отправки/удаления читают this.props на момент
// клика, а не замыкание конструктора — selectedChat появляется только после
// выбора чата, конструкторное значение навсегда осталось бы undefined.
// hbs-шаблон грузится тестовым погрузчиком (прецедент — ai-assistant).

import { expect } from 'chai'
import sinon from 'sinon'
import '../../features/ai-assistant/hbs-test-loader.ts'
import { Messenger } from './messenger.ts'
import store from '../../utils/Store.ts'

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
