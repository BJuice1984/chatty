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
    // Скаляр (текст сообщения) или объект-контент события (ping/history)
    content?: string | Record<string, unknown>
}

// Реконнект (stage 11): база экспоненциального backoff и потолок попыток.
// Интервалы: 1s → 2s → 4s → 8s → 16s, после MAX попыток транспорт отдаёт
// Close наружу (адаптеры чистят свои Map) и реджектит висящий connect().
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_ATTEMPTS = 5

const PING_INTERVAL_MS = 5000

export default class WSTransport extends EventBus {
    private socket: WebSocket | null = null
    // eslint-disable-next-line no-undef
    private pingInterval: number | NodeJS.Timeout | null = null
    // eslint-disable-next-line no-undef
    private reconnectTimeout: number | NodeJS.Timeout | null = null

    // Явное закрытие не реконнектит: флаг отличает обрыв от close() пользователя.
    private intentionalClose = false
    private reconnectAttempts = 0
    // Транспортные обработчики Own EventBus регистрируются однократно
    // (one-subscription semantics): повторный connect()/реконнект не плодит
    // дубли Connected/Close-подписок на общем EventBus.
    private transportHandlersBound = false
    // Резолвер/реджектор текущего connect()-промиса: живёт до open или до
    // исчерпания попыток — раньше промис висел вечно.
    private connectResolve: (() => void) | null = null
    // eslint-disable-next-line no-unused-vars
    private connectReject: ((error: Error) => void) | null = null

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
        this.intentionalClose = false
        this.reconnectAttempts = 0

        // Повторный connect обрывает чужой backoff-таймер: иначе «старый»
        // реконнект мог бы открыть второй сокет поверх нового.
        this.clearReconnectTimer()
        this.clearPing()

        this.bindTransportHandlers()

        return new Promise<void>((resolve, reject) => {
            this.connectResolve = resolve
            this.connectReject = reject

            this.openSocket()
        })
    }

    // Явное закрытие: снимает слушатели сокета напрямую (не ждём close-event),
    // чистит ping-интервал и таймер реконнекта, реджектит висящий connect() и
    // эмитит Close — адаптеры удаляют сокет из своих Map. Реконнекта нет.
    public close() {
        this.intentionalClose = true

        this.clearReconnectTimer()
        this.clearPing()

        this.detachSocket()

        this.rejectPendingConnect(new Error('Соединение закрыто вручную'))

        this.emit(WSTransportEvents.Close)
    }

    private openSocket() {
        this.socket = new WebSocket(this.url)

        this.subscribe(this.socket)
    }

    // Однократная регистрация транспортных обработчиков: резолв connect() по
    // open, реконнект/backoff по close. Раньше каждый connect() добавлял
    // новые Connected/Close-обработчики — при реконнекте они дублировались.
    private bindTransportHandlers() {
        if (this.transportHandlersBound) {
            return
        }

        this.transportHandlersBound = true

        this.on(WSTransportEvents.Connected, () => {
            // Успешный (пере)коннект обнуляет счётчик попыток.
            this.reconnectAttempts = 0

            this.resolvePendingConnect()
        })
    }

    private resolvePendingConnect() {
        this.connectResolve?.()
        this.connectResolve = null
        this.connectReject = null
    }

    private rejectPendingConnect(error: Error) {
        this.connectReject?.(error)
        this.connectResolve = null
        this.connectReject = null
    }

    // Bounded backoff: каждый следующий интервал вдвое больше предыдущего;
    // после RECONNECT_MAX_ATTEMPTS отказываемся — Close наружу + реджект.
    private scheduleReconnect() {
        if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            this.rejectPendingConnect(
                new Error('Не удалось восстановить соединение: исчерпаны попытки')
            )

            this.emit(WSTransportEvents.Close)

            return
        }

        const delay = RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts

        this.reconnectAttempts += 1

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null

            this.openSocket()
        }, delay)
    }

    private clearReconnectTimer() {
        if (this.reconnectTimeout !== null) {
            clearTimeout(this.reconnectTimeout)
            this.reconnectTimeout = null
        }
    }

    private setupPing() {
        this.clearPing()

        this.pingInterval = setInterval(() => {
            // Во время backoff-паузы сокета нет — ping молча пропускаем.
            // content обязателен по контракту WS-события own-бэкенда: без
            // него ping прилетает invalid_event_payload и не получает pong (LIVE-6)
            if (this.socket?.readyState === WebSocket.OPEN) {
                this.send({ type: 'ping', content: {} })
            }
        }, PING_INTERVAL_MS)
    }

    private clearPing() {
        if (this.pingInterval !== null) {
            clearInterval(this.pingInterval)
            this.pingInterval = null
        }
    }

    // Слушатели сокета держим именованными — close() снимает их напрямую,
    // чтобы «мёртвый» сокет не стрелял в транспорт после уборки.
    private readonly handleOpen = () => {
        this.setupPing()

        this.emit(WSTransportEvents.Connected)
    }

    private readonly handleClose = () => {
        this.clearPing()

        this.socket = null

        // Явное закрытие уже разобрано в close(): Close эмитится там.
        if (this.intentionalClose) {
            return
        }

        this.scheduleReconnect()
    }

    private readonly handleError = (event: Event) => {
        this.emit(WSTransportEvents.Error, event)
    }

    // Ошибки парсинга — text-only: лог текстом, без исполнения содержимого.
    private readonly handleMessage = (message: MessageEvent<string>) => {
        try {
            const data = JSON.parse(message.data) as WSTransportMessage

            if (data.type?.length > 0 && data.type === 'pong') {
                return
            }

            this.emit(WSTransportEvents.Message, data)
        } catch (e) {
            console.error('Ошибка сокета сообщений:', e)
        }
    }

    private subscribe(socket: WebSocket) {
        socket.addEventListener('open', this.handleOpen)
        socket.addEventListener('close', this.handleClose)
        socket.addEventListener('error', this.handleError)
        socket.addEventListener('message', this.handleMessage)
    }

    private detachSocket() {
        this.socket?.removeEventListener('open', this.handleOpen)
        this.socket?.removeEventListener('close', this.handleClose)
        this.socket?.removeEventListener('error', this.handleError)
        this.socket?.removeEventListener('message', this.handleMessage)

        this.socket?.close()
        this.socket = null
    }
}
