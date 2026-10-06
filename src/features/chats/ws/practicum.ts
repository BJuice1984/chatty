// Practicum-реализация WS-шлюза (stage 7): логика MessagesController,
// перенесённая в фичу chats. URL — chatWebSocketUrl(userId, chatId, token)
// (env.wsUrl + /ws/chats/{user}/{chat}/{token}); при коннекте запрашивается
// история ({type:'get old'}), входящие пишутся в слайс messages.

import WSTransport, { WSTransportEvents } from '../../../utils/WSTransport.ts'
import { chatWebSocketUrl } from '../../../utils/env.ts'
import store from '../../../utils/Store.ts'
import type { Message } from '../../../utils/types.ts'
import { appendMessages } from './gateway.ts'

export class PracticumWsAdapter {
    private sockets: Map<number, WSTransport> = new Map()

    async connect(id: number, token: string): Promise<void> {
        if (this.sockets.has(id)) {
            return
        }

        const userId = store.getState().user?.id

        if (userId == null) {
            throw new Error('User is not authenticated')
        }

        const wsTransport = new WSTransport(chatWebSocketUrl(userId, id, token))

        this.sockets.set(id, wsTransport)

        await wsTransport.connect()

        wsTransport.on(WSTransportEvents.Message, message => {
            store.set(`messages.${id}`, appendMessages(
                store.getState().messages?.[id] ?? [],
                message as Message | Message[]
            ))
        })
        wsTransport.on(WSTransportEvents.Close, () => this.sockets.delete(id))

        wsTransport.send({ type: 'get old', content: '0' })
    }

    sendMessage(id: number, message: string): Promise<void> {
        const socket = this.sockets.get(id)

        if (!socket) {
            return Promise.reject(new Error(`Chat ${id} is not connected`))
        }

        socket.send({ type: 'message', content: message })

        return Promise.resolve()
    }

    closeAll(): void {
        this.sockets.forEach(socket => socket.close())
        this.sockets.clear()
    }
}
