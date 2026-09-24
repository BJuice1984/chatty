import EventBus from '../core/EventBus.ts'


export enum WSTransportEvents {
    // eslint-disable-next-line no-unused-vars
    Connected = 'connected',
    // eslint-disable-next-line no-unused-vars
    Error = 'error',
    // eslint-disable-next-line no-unused-vars
    Message = 'message',
    // eslint-disable-next-line no-unused-vars
    Close = 'close'
}

interface WSTransportMessage {
    type: string
    content?: string
}

export default class WSTransport extends EventBus {
    private socket: WebSocket | null = null
    // eslint-disable-next-line no-undef
    private pingInterval: number | NodeJS.Timeout | null = null

    // eslint-disable-next-line no-unused-vars
    constructor(private url: string) {
        super()
    }

    public send(data: WSTransportMessage) {
        if (!this.socket) {
            throw new Error('Socket is not connected')
        }

        this.socket.send(JSON.stringify(data))
    }

    public connect(): Promise<void> {
        this.socket = new WebSocket(this.url)

        this.subscribe(this.socket)

        this.setupPing()

        return new Promise(resolve => {
            this.on(WSTransportEvents.Connected, () => {
                resolve()
            })
        })
    }

    public close() {
        this.socket?.close()
    }

    private setupPing() {
        this.pingInterval = setInterval(() => {
            this.send({ type: 'ping' })
        }, 5000)

        this.on(WSTransportEvents.Close, () => {
            if (this.pingInterval !== null) {
                clearInterval(this.pingInterval)
                this.pingInterval = null
            }
        })
    }

    private subscribe(socket: WebSocket) {
        socket.addEventListener('open', () => {
            this.emit(WSTransportEvents.Connected)
        })
        socket.addEventListener('close', () => {
            this.emit(WSTransportEvents.Close)
        })

        socket.addEventListener('error', e => {
            this.emit(WSTransportEvents.Error, e)
        })

        socket.addEventListener('message', (message: MessageEvent<string>) => {
            try {
                const data = JSON.parse(message.data) as WSTransportMessage

                if (data.type?.length > 0 && data.type === 'pong') {
                    return
                }

                this.emit(WSTransportEvents.Message, data)
            } catch (e) {
                console.error('Ошибка сокета сообщений:', e)
            }
        })
    }
}
