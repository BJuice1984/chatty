import Block from '../../core/Block.ts'
import type { MessageReplyTo, ReactionSummary } from '../../utils/types.ts'
import template from './message.hbs'

// Фикс-набор реакций (stage chats-social): тот же whitelist, что на бэкенде —
// POST /reactions отвергает остальные эмодзи
export const MESSAGE_EMOJI_SET: readonly string[] = ['👍', '❤️', '😂', '😮', '😢', '🙏']

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
    chat_id?: number
    // идентичность сообщения: без id действия реакций/ответа недоступны
    // (REST требует message_id) — аффордансы не рендерятся
    id?: number
    // серверный снимок цитаты: null/мусорный snippet — без блока цитаты
    replyTo?: MessageReplyTo | null
    // сводка реакций (mine вычислена viewer-side контроллером)
    reactions?: ReactionSummary[]
    // eslint-disable-next-line no-unused-vars
    onSetReaction?: (chatId: number, messageId: number, emoji: string) => void
    // eslint-disable-next-line no-unused-vars
    onReply?: (draft: { id?: number; snippet: string }) => void
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
            // Реакции/ответ — делегированные клики с корня: чип тогглит, кнопка
            // «реакции» раскрывает фикс-набор, «ответить» поднимает черновик
            // цитаты. Ключи message_id/chat_id обязаны быть числами — без
            // идентичности действия молчат (NaN-safe, как и весь message)
            events: {
                click: (event: Event) => {
                    const target = event.target as HTMLElement | null
                    const current = this.props as MessageProps

                    const canReact = typeof current.chat_id === 'number' && typeof current.id === 'number'

                    const emojiOption = target?.closest('[data-testid="emoji-option"]') as HTMLElement | null

                    if (canReact && emojiOption?.dataset.emoji != null) {
                        current.onSetReaction?.(current.chat_id as number, current.id as number, emojiOption.dataset.emoji)
                        this.setProps({ reactionsOpen: false })

                        return
                    }

                    const chip = target?.closest('[data-testid="reaction-chip"]') as HTMLElement | null

                    if (canReact && chip?.dataset.emoji != null) {
                        // чип — тот же toggle: сервер сам вставит или снимет
                        current.onSetReaction?.(current.chat_id as number, current.id as number, chip.dataset.emoji)

                        return
                    }

                    if (target?.closest('[data-testid="message-reactions-toggle"]') != null) {
                        this.setProps({ reactionsOpen: (this.props as MessageProps).reactionsOpen !== true })

                        return
                    }

                    if (target?.closest('[data-testid="message-reply"]') != null) {
                        current.onReply?.({
                            id: current.id,
                            snippet: typeof current.content === 'string' ? current.content : '',
                        })
                    }
                },
            } as unknown as Record<string, () => void>,
        })
    }

    render() {
        const { time, showDate, replyTo, reactions } = this.props as MessageProps

        // Цитата NaN-safe: снимок без строки-фрагмента не рендерится
        const quoteSnippet = replyTo != null && typeof replyTo.snippet === 'string'
            ? replyTo.snippet
            : undefined

        // Чистое форматирование вида: значения вычисляются здесь, шаблон
        // только рендерит их — невалидная метка даёт undefined и блоки
        // времени/маркера просто не собираются
        return this.compile(template, {
            ...this.props,
            formattedTime: formatMessageTime(time),
            dayMarker: showDate === true ? formatMessageDay(time) : undefined,
            emojiSet: MESSAGE_EMOJI_SET,
            hasReactions: (reactions?.length ?? 0) > 0,
            quoteSnippet,
        })
    }
}
