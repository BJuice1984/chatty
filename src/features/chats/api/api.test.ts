import { expect } from 'chai'
import { JSDOM } from 'jsdom'
import { ownChatsPort, toChatInfo } from './own.ts'
import { chatsPort } from './index.ts'

const dom = new JSDOM()
global.document = dom.window.document

const ownChat = {
    id: 3,
    title: 'own chat',
    owner_id: 7,
    is_ai: false,
    created_at: '2026-10-06T00:00:00Z',
}

const unsupportedMethods = [
    'deleteChat',
    'removeUsers',
    'getChatUsers',
    'changeChatAvatar',
    'searchUsers',
] as const

async function captureError(action: () => unknown): Promise<unknown> {
    try {
        await action()
    } catch (e) {
        return e
    }

    return undefined
}

describe('chats api adapter', () => {
    it('should expose the own adapter as the port', () => {
        expect(chatsPort).to.eq(ownChatsPort)

        for (const method of [
            'fetchChats',
            'createChat',
            'deleteChat',
            'getToken',
            'addUsers',
            'removeUsers',
            'getChatUsers',
            'changeChatAvatar',
            'searchUsers',
        ] as const) {
            expect(chatsPort, `own ${method}`).to.have.property(method)
        }
    })

    it('should map own ChatResponse onto ChatInfo with defaults', () => {
        const chat = toChatInfo(ownChat)

        expect(chat.id).to.eq(3)
        expect(chat.title).to.eq('own chat')
        expect(chat.avatar).to.eq('')
        expect(chat.unread_count).to.eq(0)
    })

    it('should return an empty token sentinel for the cookie-auth WS flow', async () => {
        const token = await ownChatsPort.getToken(3)

        expect(token.token).to.eq('')
    })

    it('should reject unsupported own-mode operations explicitly', async () => {
        for (const method of unsupportedMethods) {
            const error = await captureError(
                () => (ownChatsPort[method] as unknown as () => unknown)()
            )

            expect(error, `own ${method}`).to.be.instanceOf(Error)
            expect((error as Error).message, `own ${method}`).to.match(/недоступна в own-режиме/)
        }
    })
})
