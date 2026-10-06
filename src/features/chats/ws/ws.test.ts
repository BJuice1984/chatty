import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import { env, joinUrl } from '../../../utils/env.ts'
import { appendMessages, chatMessagesPort, closeAllChatSockets } from './gateway.ts'
import { ownChatUrl, toMessage } from './own.ts'
import type { Message } from '../../../utils/types.ts'

const dom = new JSDOM()
global.document = dom.window.document

const ownResponse = {
    id: 11,
    chat_id: 3,
    user_id: 7,
    content: 'hello',
    file_id: null,
    client_message_id: null,
    created_at: '2026-10-06T00:00:00Z',
}

const ownFileResponse = {
    ...ownResponse,
    id: 12,
    content: null,
    file_id: 5,
}

function message(id: number, content: string): Message {
    return { chat_id: 3, time: `t${id}`, type: 'message', user_id: 7, content }
}

describe('chats ws gateway', () => {
    it('should expose the port through the gateway', () => {
        expect(chatMessagesPort).to.have.property('sendMessage')
        expect(chatMessagesPort).to.have.property('connect')
        expect(closeAllChatSockets).to.be.a('function')
    })

    it('should append a single incoming message to the current list', () => {
        const result = appendMessages([message(1, 'a')], message(2, 'b'))

        expect(result.map(m => m.content)).to.deep.eq(['a', 'b'])
    })

    it('should reverse descending history batches before appending', () => {
        const history = [message(3, 'c'), message(2, 'b'), message(1, 'a')]

        expect(appendMessages([], history).map(m => m.content)).to.deep.eq(['a', 'b', 'c'])
    })

    it('should store own-mode history ascending via a single reversal (RV1 composition)', () => {
        // own.ts передаёт desc-массив бэкенда как есть (только toMessage) —
        // единственный reverse делает appendMessages; живое эхо приклеивается в конец
        const descFromBackend = [ownResponse, { ...ownResponse, id: 10, content: 'first' }]
        const stored = appendMessages([], descFromBackend.map(toMessage))
        const withEcho = appendMessages(stored, toMessage({ ...ownResponse, id: 13, content: 'echo' }))

        expect(withEcho.map(m => m.content)).to.deep.eq(['first', 'hello', 'echo'])
    })

    it('should map own MessageResponse onto the Message DTO', () => {
        const mapped = toMessage(ownResponse)

        expect(mapped.chat_id).to.eq(3)
        expect(mapped.user_id).to.eq(7)
        expect(mapped.time).to.eq('2026-10-06T00:00:00Z')
        expect(mapped.type).to.eq('message')
        expect(mapped.content).to.eq('hello')
        expect(mapped.file_url).to.eq(undefined)
    })

    it('should map own file messages to a safe download URL', () => {
        const mapped = toMessage(ownFileResponse)

        expect(mapped.content).to.eq('')
        expect(mapped.file_url).to.eq(joinUrl(env.filesUrl, '/5/download'))
    })

    it('should build the own WS URL without a token', () => {
        expect(ownChatUrl(3)).to.eq(joinUrl(env.wsUrl, '/ws/chats/3'))
    })
})
