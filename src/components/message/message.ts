import Block from '../../core/Block.ts'
import template from './message.hbs'

interface MessageProps {
    content: string
    user_id: number
    isMine?: boolean
    // ISO-метка сообщения. Невалидная/пустая — рендер без времени и маркера
    // дня, без throw: Intl на new Date(NaN) кидает RangeError и убил бы
    // рендер всего мессенджера (ws-фикстуры гоняют time вида 't'+id)
    time?: string
    // маркер дня над пузырём: true на первом сообщении дня (считает messenger)
    showDate?: boolean
    [key: string]: unknown
}

const MS_PER_DAY = 86_400_000

// Валидная дата или undefined: мусорная метка трактуется как отсутствующая
function parseTime(time?: string): Date | undefined {
    if (typeof time !== 'string' || time === '') {
        return undefined
    }

    const date = new Date(time)

    return Number.isNaN(date.getTime()) ? undefined : date
}

// Ключ календарного дня (локальный): для сравнения соседних сообщений
export function messageDayKey(time?: string): string | undefined {
    const date = parseTime(time)

    if (date === undefined) {
        return undefined
    }

    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

// Время сообщения ЧЧ:ММ (ru-RU); невалидная метка -> без времени
export function formatMessageTime(time?: string): string | undefined {
    const date = parseTime(time)

    if (date === undefined) {
        return undefined
    }

    return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date)
}

// Маркер дня: «Сегодня»/«Вчера»/локализованная дата; невалидная -> без маркера
export function formatMessageDay(time?: string): string | undefined {
    const date = parseTime(time)

    if (date === undefined) {
        return undefined
    }

    const startOfDay = (value: Date) =>
        new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
    const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(date)) / MS_PER_DAY)

    if (dayDiff === 0) {
        return 'Сегодня'
    }

    if (dayDiff === 1) {
        return 'Вчера'
    }

    // Чужие годы подписываем годом, текущий — короткой датой
    const options: Intl.DateTimeFormatOptions = date.getFullYear() === new Date().getFullYear()
        ? { day: 'numeric', month: 'long' }
        : { day: 'numeric', month: 'long', year: 'numeric' }

    return new Intl.DateTimeFormat('ru-RU', options).format(date)
}

export class Message extends Block {
    constructor(props: MessageProps) {
        super({
            ...props,
        })
    }

    render() {
        const { time, showDate } = this.props as MessageProps

        // Чистое форматирование вида: значения вычисляются здесь, шаблон
        // только рендерит их — невалидная метка даёт undefined и блоки
        // времени/маркера просто не собираются
        return this.compile(template, {
            ...this.props,
            formattedTime: formatMessageTime(time),
            dayMarker: showDate === true ? formatMessageDay(time) : undefined,
        })
    }
}
