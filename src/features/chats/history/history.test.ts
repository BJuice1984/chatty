// Тесты history-модуля (stage 11): merge с дедупликацией, слайс, контроллер
// (не грузит параллельно, читает курсор, ошибка текстом) и строка-статус
// (кнопка «загрузить ещё»/loading/error + событие load-more).

import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import store from '../../../utils/Store.ts'
import type { Message } from '../../../utils/types.ts'
import type { ChatMessagesPort } from '../ports.ts'
import { ChatHistoryController, chatHistoryController } from './controller.ts'
import { historyMessageKey, mergeHistoryMessages } from './merge.ts'
import { chatHistorySlice } from './store.ts'
import { CHAT_HISTORY_PAGE_LIMIT, type HistoryMessage } from './types.ts'
import { ChatHistory } from './view.ts'

const dom = new JSDOM()
global.document = dom.window.document

function message(id: number | undefined, content: string, time = `t${id ?? content}`): HistoryMessage {
    return { chat_id: 3, time, type: 'message', user_id: 7, content, id }
}

function plainMessage(content: string): Message {
    return { chat_id: 3, time: `t-${content}`, type: 'message', user_id: 7, content }
}

describe('chats history merge', () => {
    it('keys messages by numeric id when present', () => {
        expect(historyMessageKey(message(11, 'a'))).to.eq('id:11')
    })

    it('falls back to a composite content key for id-less messages', () => {
        const key = historyMessageKey(message(undefined, 'привет'))

        expect(key).to.eq([3, 7, 'tпривет', 'привет'].join('|'))
    })

    it('prepends an older batch in ascending order without duplicates', () => {
        const current = [message(30, 'c'), message(31, 'd')]
        // Бэкенд отдаёт убыванием: 21 старше 20
        const olderBatch = [message(21, 'b'), message(20, 'a')]

        const merged = mergeHistoryMessages(current, olderBatch, 'prepend')

        expect(merged.map(item => item.content)).to.deep.eq(['a', 'b', 'c', 'd'])
    })

    it('appends an initial history batch once and drops repeats after reconnect', () => {
        const first = mergeHistoryMessages([], [message(2, 'b'), message(1, 'a')], 'append')

        expect(first.map(item => item.content)).to.deep.eq(['a', 'b'])

        // Реконнект присылает ту же пачку — дубликатов быть не должно.
        const second = mergeHistoryMessages(first, [message(2, 'b'), message(1, 'a')], 'append')

        expect(second.map(item => item.content)).to.deep.eq(['a', 'b'])
    })

    it('deduplicates overlapping ids between live echo and history batch', () => {
        const current = [message(20, 'эхо'), message(21, 'b')]

        const merged = mergeHistoryMessages(current, [message(20, 'эхо-дубль'), message(19, 'a')], 'prepend')

        expect(merged.map(item => item.content)).to.deep.eq(['a', 'эхо', 'b'])
    })

    it('deduplicates id-less rows by the composite key', () => {
        const current = [plainMessage('привет')]
        const batch = [plainMessage('привет'), plainMessage('пока')]

        const merged = mergeHistoryMessages(current, batch, 'append')

        expect(merged.map(item => item.content)).to.deep.eq(['привет', 'пока'])
    })
})

describe('chats history slice', () => {
    afterEach(() => {
        chatHistorySlice.resetHistory(3)
    })

    it('patches per-chat state without touching other chats', () => {
        chatHistorySlice.patchHistory(3, { cursor: 20, isLoading: true })
        chatHistorySlice.patchHistory(4, { cursor: 40 })

        expect(chatHistorySlice.getHistory(3).cursor).to.eq(20)
        expect(chatHistorySlice.getHistory(3).isLoading).to.be.true
        expect(chatHistorySlice.getHistory(4).cursor).to.eq(40)
        expect(chatHistorySlice.getHistory(4).isLoading).to.be.false

        chatHistorySlice.resetHistory(4)
    })

    it('returns the initial state for an unknown chat', () => {
        expect(chatHistorySlice.getHistory(99)).to.deep.eq({
            cursor: null,
            isLoading: false,
            hasMore: true,
            error: '',
        })
    })
})

describe('chats history controller', () => {
    let controller: ChatHistoryController
    let port: ChatMessagesPort

    beforeEach(() => {
        chatHistorySlice.resetHistory(3)
        controller = new ChatHistoryController()
        port = {
            sendMessage: async () => {},
            connect: async () => {},
            loadHistory: async () => {},
        }
        controller.attachPort(port)
    })

    afterEach(() => {
        chatHistorySlice.resetHistory(3)
    })

    it('does not load before the initial history sets the cursor', () => {
        const loadHistory = sinon.spy(port, 'loadHistory')

        controller.loadOlder(3)

        expect(loadHistory.called).to.be.false
    })

    it('sends loadHistory with the stored cursor and page limit', () => {
        chatHistorySlice.patchHistory(3, { cursor: 42 })

        const loadHistory = sinon.spy(port, 'loadHistory')

        controller.loadOlder(3)

        expect(loadHistory.calledOnceWith(3, 42, CHAT_HISTORY_PAGE_LIMIT)).to.be.true
        expect(chatHistorySlice.getHistory(3).isLoading).to.be.true
    })

    it('does not load in parallel while a request is pending', () => {
        chatHistorySlice.patchHistory(3, { cursor: 42 })

        const loadHistory = sinon.spy(port, 'loadHistory')

        controller.loadOlder(3)
        controller.loadOlder(3)

        expect(loadHistory.calledOnce).to.be.true
    })

    it('stops pagination when hasMore is false', () => {
        chatHistorySlice.patchHistory(3, { cursor: 42, hasMore: false })

        const loadHistory = sinon.spy(port, 'loadHistory')

        controller.loadOlder(3)

        expect(loadHistory.called).to.be.false
    })

    it('recovers with a text error when the port rejects', async () => {
        chatHistorySlice.patchHistory(3, { cursor: 42 })

        controller.attachPort({
            sendMessage: async () => {},
            connect: async () => {},
            loadHistory: () => Promise.reject(new Error('Chat 3 is not connected')),
        })

        controller.loadOlder(3)
        await new Promise(resolve => setTimeout(resolve, 0))

        const state = chatHistorySlice.getHistory(3)

        expect(state.isLoading).to.be.false
        expect(state.error).to.eq('Chat 3 is not connected')
    })

    it('returns the status row to a working state after the load timeout (HD-R3)', () => {
        const clock = sinon.useFakeTimers()

        try {
            chatHistorySlice.patchHistory(3, { cursor: 42 })
            controller.loadOlder(3)

            expect(chatHistorySlice.getHistory(3).isLoading).to.be.true

            // Ответ приходит WS-событием и может потеряться (обрыв сокета):
            // через 10 секунд строка обязана вернуться к рабочему состоянию,
            // а не висеть «Загружаем сообщения…» навсегда.
            clock.tick(10_000)

            const state = chatHistorySlice.getHistory(3)

            expect(state.isLoading).to.be.false
            expect(state.error).to.eq('Не удалось загрузить историю — попробуйте ещё раз')

            // Кнопка повтора снова работает: повторный loadOlder уходит в порт
            const loadHistory = sinon.spy(port, 'loadHistory')

            controller.loadOlder(3)

            expect(loadHistory.calledOnce).to.be.true
        } finally {
            clock.restore()
        }
    })

    it('prepends an older batch, advances the cursor and holds the loading status for UX', async () => {
        const clock = sinon.useFakeTimers()

        try {
            store.set('messages', { 3: [message(30, 'c')] })
            chatHistorySlice.patchHistory(3, { cursor: 30, isLoading: true })

            controller.applyOlderHistory(3, [message(21, 'b'), message(20, 'a')], 20)

            expect((store.getState().messages?.[3] ?? []).map(item => item.content))
                .to.deep.eq(['a', 'b', 'c'])
            // Сообщения и курсор применены сразу, статус держится ещё 2 секунды —
            // мгновенный сброс выглядел бы морганием надписи
            expect(chatHistorySlice.getHistory(3).cursor).to.eq(20)
            expect(chatHistorySlice.getHistory(3).hasMore).to.be.true
            expect(chatHistorySlice.getHistory(3).isLoading).to.be.true

            clock.tick(2000)

            expect(chatHistorySlice.getHistory(3).isLoading).to.be.false
        } finally {
            clock.restore()
        }
    })

    it('closes pagination when the batch is empty or the cursor is null', () => {
        controller.applyOlderHistory(3, [], null)

        expect(chatHistorySlice.getHistory(3).hasMore).to.be.false

        controller.applyInitialHistory(3, [], null)

        expect(chatHistorySlice.getHistory(3).hasMore).to.be.false
    })

    it('initial history appends with dedup and initialises the cursor', () => {
        store.set('messages', { 3: [message(1, 'a')] })

        controller.applyInitialHistory(3, [message(2, 'b'), message(1, 'a-дубль')], 1)

        expect((store.getState().messages?.[3] ?? []).map(item => item.content))
            .to.deep.eq(['a', 'b'])
        expect(chatHistorySlice.getHistory(3).cursor).to.eq(1)
    })
})

describe('chats history view', () => {
    beforeEach(() => {
        chatHistorySlice.resetHistory(3)
    })

    afterEach(() => {
        chatHistorySlice.resetHistory(3)
        store.set('selectedChat', undefined)
    })

    function render() {
        return new ChatHistory({} as never)
    }

    it('renders the load-more button when there is older history', () => {
        store.set('selectedChat', 3)
        chatHistorySlice.patchHistory(3, { cursor: 20, hasMore: true })

        const view = render()

        expect(view.element?.querySelector('[data-testid="chat-history-more"]')).to.exist
    })

    it('renders the loading state instead of the button', () => {
        store.set('selectedChat', 3)
        chatHistorySlice.patchHistory(3, { cursor: 20, isLoading: true, hasMore: true })

        const view = render()

        expect(view.element?.querySelector('[data-testid="chat-history-loading"]')).to.exist
        expect(view.element?.querySelector('[data-testid="chat-history-more"]')).to.not.exist
    })

    it('renders a text-only error state with a retry button', () => {
        store.set('selectedChat', 3)
        chatHistorySlice.patchHistory(3, {
            cursor: 20,
            error: '<script>alert(1)</script>сокет недоступен',
        })

        const view = render()
        const error = view.element?.querySelector('[data-testid="chat-history-error"]')

        expect(error?.querySelector('script')).to.not.exist
        expect(error?.innerHTML).to.contain('&lt;script&gt;')
        expect(view.element?.querySelector('[data-testid="chat-history-retry"]')).to.exist
    })

    it('renders an empty row when there is nothing more to load', () => {
        store.set('selectedChat', 3)
        chatHistorySlice.patchHistory(3, { cursor: 20, hasMore: false })

        const view = render()

        expect(view.element?.querySelector('[data-testid="chat-history-more"]')).to.not.exist
        expect(view.element?.querySelector('[data-testid="chat-history-loading"]')).to.not.exist
    })

    it('emits load-more into the controller on button click', () => {
        store.set('selectedChat', 3)
        chatHistorySlice.patchHistory(3, { cursor: 20, hasMore: true })

        const loadOlder = sinon.stub(chatHistoryController, 'loadOlder')

        try {
            const view = render()
            const button = view.element?.querySelector<HTMLButtonElement>('[data-testid="chat-history-more"]')

            button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

            expect(loadOlder.calledOnceWith(3)).to.be.true
        } finally {
            loadOlder.restore()
        }
    })
})
