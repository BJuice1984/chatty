// Фича-контроллер chats (stage 4; stage 7 — режимные адаптеры; chats-social —
// реакции, реплаи, chat_deleted): бизнес-логика за портом. Порты по
// умолчанию — адаптеры, выбранные по env.mode: ./api/index.ts (HTTP) и
// ./ws/gateway.ts (WebSocket, замена MessagesController).
//
// Реакции: собственные чипы считаются viewer-side от state.user.id —
// WS-broadcast несёт mine относительно ОТПРАВИТЕЛЯ действия, поэтому чужие
// эхо-флаги не используются никогда: своё действие реконсиляцируется
// REST-ответом toggle (его сводка viewer-relative), чужие — дельтой события.

import store from '../../utils/Store.ts'
import type { ChatInfo, Message, ReactionSummary } from '../../utils/types.ts'
import { chatsPort } from './api/index.ts'
import type { ChatMessagesPort, ChatReactionEvent, ChatsPort, ChatsUserSearchResult } from './ports.ts'
import { chatsSlice } from './store.ts'
import { chatMessagesPort, setChatsEventListeners } from './ws/gateway.ts'

// Применяет дельту события реакции к сводке одного сообщения (чистая функция):
// count ± 1, mine перевычисляется только для действия самого вьюера,
// нулевой чип исчезает. Порядок существующих записей стабилен.
export function applyReactionDelta(
    reactions: ReactionSummary[],
    delta: { user_id: number; emoji: string; active: boolean },
    viewerId: number | undefined
): ReactionSummary[] {
    const existing = reactions.find(item => item.emoji === delta.emoji)
    const nextCount = (existing?.count ?? 0) + (delta.active ? 1 : -1)

    if (nextCount <= 0) {
        return reactions.filter(item => item.emoji !== delta.emoji)
    }

    const mine = delta.user_id === viewerId ? delta.active : existing?.mine ?? false
    const next: ReactionSummary = { emoji: delta.emoji, count: nextCount, mine }

    if (existing === undefined) {
        return [...reactions, next]
    }

    return reactions.map(item => (item.emoji === delta.emoji ? next : item))
}

// Оптимистичный toggle собственного чипа: направление — наоборот текущему
// mine вьюера. Возвращает новую сводку и предсказанный active.
export function toggleOwnReaction(
    reactions: ReactionSummary[],
    viewerId: number,
    emoji: string
): { reactions: ReactionSummary[]; active: boolean } {
    const existing = reactions.find(item => item.emoji === emoji)
    const active = !(existing?.mine ?? false)

    return {
        reactions: applyReactionDelta(reactions, { user_id: viewerId, emoji, active }, viewerId),
        active,
    }
}

// Заменяет реакции одного сообщения в сторе (по id); сообщения без id или
// отсутствующие в загруженной странице не трогаем — их сводка придёт с
// историей/эхо.
function patchMessageReactions(
    chatId: number,
    messageId: number,
    // eslint-disable-next-line no-unused-vars
    transform: (reactions: ReactionSummary[]) => ReactionSummary[]
): void {
    const current = store.getState().messages?.[chatId] ?? []
    const index = current.findIndex(item => item.id === messageId)

    if (index === -1) {
        return
    }

    const message = current[index]
    const patched: Message = {
        ...message,
        reactions: transform(message.reactions ?? []),
    }
    const next = [...current.slice(0, index), patched, ...current.slice(index + 1)]

    store.set(`messages.${chatId}`, next)
}

export class ChatsFeatureController {
    private readonly port: ChatsPort
    private readonly messages: ChatMessagesPort
    // Счётчик in-flight собственных toggle-реакций по ключу chat:message:emoji,
    // а также grace-время: REST-ответ прилетает раньше собственного WS-эха, и
    // если сбросить гвард сразу, эхо ложится поверх серверной сводки —
    // счётчик задваивается до перезагрузки (нашёл оператор). Окно 1500мс
    // закрывает гонку, не мешая второй вкладке (её тоггл — новое окно).
    // WS-эхо собственного действия в полёте пропускаем (его реконсиляцирует
    // REST-ответ), иначе дельта применилась бы дважды
    private readonly inFlightReactions = new Map<string, number>()
    private readonly reactionEchoGrace = new Map<string, number>()

    constructor(
        port: ChatsPort = chatsPort,
        messages: ChatMessagesPort = chatMessagesPort
    ) {
        this.port = port
        this.messages = messages

        // WS-события реакции/удаления чата приходят в адаптер — бизнес-логика
        // здесь (паттерн attachPort из history-модуля; прямой импорт дал бы цикл)
        setChatsEventListeners({
            onReaction: event => this.handleReactionEvent(event),
            onChatDeleted: chatId => this.handleChatDeleted(chatId),
        })
    }

    async create(data: { title: string }): Promise<void> {
        try {
            await this.port.createChat(data)
        } catch (e: unknown) {
            console.error('Ошибка при создании чата:', e)
        }

        void this.fetchChats()
    }

    async fetchChats(): Promise<void> {
        let chats: ChatInfo[] = []

        try {
            // meId для правила «единственный собеседник» в аватарах списка:
            // адаптер стор не читает, идентичность передаём параметром
            chats = await this.port.fetchChats(store.getState().user?.id)
        } catch (e: unknown) {
            console.error('Ошибка при получении списка чата:', e)
        }

        for (const chat of chats) {
            try {
                const res = await this.port.getToken(chat.id)

                await this.messages.connect(chat.id, res.token)
            } catch (e: unknown) {
                console.error(`Ошибка при обработке чата с ID ${chat.id}:`, e)
            }
        }

        // аватары диалогов приходят в самом ответе списка (members), отдельных
        // запросов участников на каждый чат больше нет
        chatsSlice.setChats(chats)
    }

    async addUsersToChat(users: number[], chatId: number): Promise<void> {
        try {
            await this.port.addUsers({ users, chatId })
            // паритет с legacy: обновляем и список чатов, и пользователей чата
            void this.fetchChats()
            void this.getChatUsers(chatId)
        } catch (e: unknown) {
            console.error('Ошибка при добавлении пользователей в чат:', e)
        }
    }

    // Поиск пользователей для добавления в чат: метод порта (stage 7 перевёл
    // его из прямого вызова legacy UserApi в контракт ChatsPort). Ответ
    // типизирован {id, login, display_name} — модалка рисует список сама.
    async searchUsers(login: string): Promise<ChatsUserSearchResult[]> {
        try {
            return await this.port.searchUsers({ login })
        } catch (e: unknown) {
            console.error('Ошибка при поиске пользователей:', e)

            return []
        }
    }

    async addUsersByLogin(login: { login: string }, chatId: number): Promise<void> {
        try {
            const found = await this.port.searchUsers(login)

            if (found.length > 0) {
                await this.addUsersToChat(found.map(user => user.id), chatId)
            }
        } catch (e: unknown) {
            console.error('Ошибка при поиске и добавлении пользователя:', e)
        }
    }

    async delete(id: number): Promise<void> {
        try {
            // перед 204 бэкенд рассылает chat_deleted по WS — наш собственный
            // обработчик тоже сбросит выбор чата и закроет сокет
            await this.port.deleteChat({ chatId: id })

            void this.fetchChats()
        } catch (e: unknown) {
            console.error('Ошибка при удалении чата:', e)
        }
    }

    // Toggle-реакция: оптимистичный собственный чип viewer-side, затем REST —
    // его сводка viewer-relative и заменяет локальную; ошибка откатывает тоггл
    async setReaction(chatId: number, messageId: number, emoji: string): Promise<void> {
        const viewerId = store.getState().user?.id

        if (viewerId === undefined) {
            console.error('Реакции недоступны без идентичности пользователя')

            return
        }

        const key = `${chatId}:${messageId}:${emoji}`

        this.inFlightReactions.set(key, (this.inFlightReactions.get(key) ?? 0) + 1)
        patchMessageReactions(chatId, messageId, reactions =>
            toggleOwnReaction(reactions, viewerId, emoji).reactions)

        try {
            const result = await this.port.setReaction({ chatId, messageId, emoji })

            patchMessageReactions(chatId, messageId, () => result.reactions)
        } catch (e: unknown) {
            console.error('Ошибка при переключении реакции:', e)

            // откат: повторный тоггл возвращает прежний чип
            patchMessageReactions(chatId, messageId, reactions =>
                toggleOwnReaction(reactions, viewerId, emoji).reactions)
        } finally {
            const pending = (this.inFlightReactions.get(key) ?? 1) - 1

            if (pending <= 0) {
                this.inFlightReactions.delete(key)
                this.reactionEchoGrace.set(key, Date.now() + 1500)
            } else {
                this.inFlightReactions.set(key, pending)
            }
        }
    }

    // WS-эхо реакции: собственное действие в полёте уже отражено оптимистично и
    // будет реконсиляцировано REST-ответом — пропускаем, чтобы не считать
    // дважды; всё остальное применяем дельтой viewer-side
    private handleReactionEvent(event: ChatReactionEvent): void {
        const viewerId = store.getState().user?.id
        const key = `${event.chat_id}:${event.message_id}:${event.emoji}`

        if (viewerId !== undefined && event.user_id === viewerId) {
            // в полёте — точно своё отражение; в grace-окне после REST —
            // позднее эхо уже учтённого тоггла
            const graceUntil = this.reactionEchoGrace.get(key)

            if (this.inFlightReactions.has(key)) {
                return
            }

            if (graceUntil !== undefined) {
                if (Date.now() < graceUntil) {
                    return
                }

                this.reactionEchoGrace.delete(key)
            }
        }

        patchMessageReactions(event.chat_id, event.message_id, reactions =>
            applyReactionDelta(reactions, event, viewerId))
    }

    // WS chat_deleted: сброс выбора (панель возвращается к списку), закрытие
    // сокета чата без реконнекта, обновление списка чатов
    private handleChatDeleted(chatId: number): void {
        store.set('selectedChat', undefined)
        void this.messages.closeChat(chatId)
        void this.fetchChats()
    }

    async changeChatAvatar(userData: FormData): Promise<void> {
        try {
            const { avatar } = await this.port.changeChatAvatar(userData)

            // точечный патч одного чата из ответа загрузки — без рефетча
            // всего списка (рефетч заодно гонял бы WS-connect-цикл по
            // каждому чату); id чата читаем из той же формы, что и адаптер
            // (кликнутая плитка — не обязательно selectedChat)
            const chatId = Number(userData.get('chatId'))
            const chats = (store.getState().chats ?? []) as ChatInfo[]

            chatsSlice.setChats(
                chats.map(item =>
                    item.id === chatId
                        ? { ...item, avatar }
                        : item
                )
            )
        } catch (e: unknown) {
            console.error('Ошибка при изменении аватара чата:', e)
        }
    }

    async getChatUsers(id: number): Promise<void> {
        try {
            const users = await this.port.getChatUsers(id)

            users.forEach(user => {
                user.onClick = () => void this.deleteChatUsers({ users: [user.id], chatId: id })
            })

            chatsSlice.setChatUsers(users)
        } catch (e: unknown) {
            console.error('Ошибка при получении пользователей чата:', e)
        }
    }

    sendMessage(chatId: number, message: string, replyToId?: number): Promise<void> {
        const result = this.messages.sendMessage(chatId, message, replyToId)

        // is_ai-чат: после отправки запускаем ассистента. Свой broadcast с id
        // уже в сторе (WS быстрее REST-прогона); провал модели показываем
        // системным сообщением в чате — иначе для пользователя это молчание
        const chat = (store.getState().chats ?? []).find(
            item => (item as { id?: number }).id === chatId
        ) as { is_ai?: boolean } | undefined

        if (chat?.is_ai === true) {
            void this.runBotForLastOwnMessage(chatId)
        }

        return result
    }

    private async runBotForLastOwnMessage(chatId: number): Promise<void> {
        const userId = store.getState().user?.id
        const messages = store.getState().messages?.[chatId] ?? []
        const own = [...messages]
            .reverse()
            .find(item => item.user_id === userId && typeof (item as { id?: number }).id === 'number') as { id?: number } | undefined

        if (own?.id === undefined) {
            return
        }

        try {
            const run = await this.port.runBot?.(chatId, own.id)

            if (run?.status === 'failed') {
                const reason = run.error_kind ?? 'unknown'
                const list = store.getState().messages?.[chatId] ?? []

                store.set(`messages.${chatId}`, [
                    ...list,
                    {
                        chat_id: chatId,
                        time: new Date().toISOString(),
                        type: 'message',
                        user_id: -1,
                        content: `⚠ Ассистент недоступен (${reason}). Попробуйте позже.`,
                        isError: true,
                    },
                ])
            }
        } catch (e: unknown) {
            console.error('Ошибка при запуске ассистента:', e)
        }
    }

    selectChat(id: number): void {
        chatsSlice.selectChat(id)

        // открытие чата прочитывает его: серверная пометка уходит с выдачей
        // истории (MessageService.history -> mark_read), а пилюлю гасим в
        // списке сразу, локально — без перечитывания всего списка
        const chats = (store.getState().chats ?? []).map(chat =>
            (chat as { id?: number }).id === id
                ? { ...chat, unread_count: 0 }
                : chat)

        store.set('chats', chats)
    }

    private async deleteChatUsers(data: { users: number[]; chatId: number }): Promise<void> {
        try {
            await this.port.removeUsers(data)
            void this.getChatUsers(data.chatId)
        } catch (e: unknown) {
            console.error('Ошибка при удалении пользователя из чата:', e)
        }
    }
}

export default new ChatsFeatureController()
