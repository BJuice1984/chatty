// Мессенджер выбранного чата (stage 4; stage 7 — все действия через пропсы;
// chats-social — модалки, @-поиск, реакции, реплаи; 2026-11-01-chat-leave —
// контекстные меню участников и архивный режим): компонент получает
// поведение колбэками из пропсов (фича chats); компоненты не импортируют ни
// контроллеры, ни фичи. Модальные сценарии собраны на универсальном Modal:
// «добавить пользователя» (дебаунс-поиск по @логину, клик добавляет),
// «удалить чат» (подтверждение) и меню участника по клику его аватара в
// шапке. Состояние модалок/черновика ответа — controller-free UI-состояние,
// живёт в пропсах компонента.
// chat-ui-polish: стороны пузырей/время/маркеры дней (mapTypedMessages) и
// кнопка «назад» мобильного переключения (onBack из chat.ts).
// URL вложения вычисляется из env (fileUrl) — безопасные схемы гарантирует joinUrl.

import Block from '../../core/Block.ts'
import Handlebars from 'handlebars'
import { Button, Input, Message } from '../../utils/types.ts'
import { AppState, withStore } from '../../utils/Store.ts'
import { fileUrl } from '../../utils/env.ts'
import { messageDayKey } from '../message/message.ts'
import template from './messenger.hbs'

// Дебаунс @-поиска: поиск стартует, когда пользователь перестал печатать
export const USER_SEARCH_DEBOUNCE_MS = 300

// Черновик ответа: id цели (REST требует message_id) и сниппет для превью
export interface ReplyDraft {
    id?: number
    snippet: string
}

// Результат поиска пользователей для модалки (контракт порта фичи chats,
// переобъявлен локально: компоненты не импортируют фичи вверх по слоям)
export interface UserSearchEntry {
    id: number
    login: string
    display_name: string
}

interface MessengerProps {
    selectedChat: number
    selectedChatUsers: ChatListUserEntry[]
    messages: Message[]
    inputs: Input[]
    buttons: Button<{ message: string }>[]
    // eslint-disable-next-line no-unused-vars
    onDeleteChat?: (id: number) => void
    // клик по найденному пользователю добавляет его в чат
    // eslint-disable-next-line no-unused-vars
    onAddUser?: (userId: number, chatId: number) => Promise<void> | void
    // дебаунс-поиск @логина для модалки добавления
    // eslint-disable-next-line no-unused-vars
    onSearchUsers?: (login: string) => Promise<UserSearchEntry[]>
    // toggle-реакция (оптимистичный пересчёт — в контроллере фичи)
    // eslint-disable-next-line no-unused-vars
    onSetReaction?: (chatId: number, messageId: number, emoji: string) => void
    // eslint-disable-next-line no-unused-vars
    onSendMessage?: (chatId: number, message: string, replyToId?: number) => void
    // возврат к списку чатов в мобильном переключении (<768)
    onBack?: () => void
    // 2026-11-01-chat-leave: матрица видимости меню участника — контакты
    // вьюера (id), его собственный id и владелец чата; поведение, как везде,
    // колбэками из пропсов (страница фичи ведёт в контроллер)
    contactIds?: number[]
    meId?: number
    ownerId?: number
    // eslint-disable-next-line no-unused-vars
    onAddContact?: (userId: number) => void
    // eslint-disable-next-line no-unused-vars
    onKickUser?: (userId: number, chatId: number) => void
    // eslint-disable-next-line no-unused-vars
    onLeaveChat?: (chatId: number) => void
    // controller-free UI-состояние (внутреннее, поднимается через setProps):
    // модалка добавления пользователя и её данные поиска
    addUserOpen?: boolean
    addUserQuery?: string
    addUserResults?: UserSearchEntry[]
    addUserFeedback?: string
    // модалка подтверждения удаления чата
    deleteModalOpen?: boolean
    // открытое меню участника (клик по его аватару в шапке; null — закрыто)
    menuTarget?: ChatListUserEntry | null
    // черновик ответа: превью над инпутом, уходит с отправкой (reply_to_id)
    replyDraft?: ReplyDraft | null
    // раскрыт ли набор эмодзи у сообщения (переключается самим message)
    reactionsOpen?: boolean
    [key: string]: unknown
}

interface ChatListUserEntry {
    id: number
    avatar: string
    display_name?: string
    onClick?: () => void
    [key: string]: unknown
}

// Экранирование значений в слот-HTML модалок: объекты не строковируем
// (no-base-to-string), примитивы — через строку, остальное — пусто
const escapeHtml = (value: unknown): string => Handlebars.escapeExpression(
    typeof value === 'string' || typeof value === 'number' ? String(value) : ''
)

// Контент модалки добавления пользователя: поле @-поиска, подсказка,
// фидбек и список находок {display_name, login}. Данные экранируются —
// modal рендерит слот без экранирования. alreadyBadge — текст метки уже
// добавленного (мессенджер не передаёт: дефолт «уже в чате» хранит его
// поведение бит-в-бит; страница контактов переиспользует билдер с
// «уже в контактах», 2026-11-01-contacts)
export function renderAddUserModalContent(props: {
    addUserQuery?: string
    addUserResults?: UserSearchEntry[]
    addUserFeedback?: string
    memberIds?: number[]
    alreadyBadge?: string
}): string {
    const query = props.addUserQuery ?? ''
    const results = props.addUserResults ?? []
    const feedback = props.addUserFeedback ?? ''
    const memberIds = new Set(props.memberIds ?? [])
    const alreadyBadge = props.alreadyBadge ?? 'уже в чате'
    const items = results.map(user => {
        const already = memberIds.has(user.id)
        const disabled = already ? ' disabled' : ''
        const badge = already ? `<span class="modal__result-badge">${escapeHtml(alreadyBadge)}</span>` : ''

        return '<li class="modal__result-item">'
            + `<button type="button" class="modal__result" data-testid="user-search-result" data-user-id="${escapeHtml(user.id)}"${disabled}>`
            + `<span class="modal__result-name">${escapeHtml(user.display_name)}</span>`
            + `<span class="modal__result-login">${escapeHtml(user.login)}</span>${
                badge
            }</button></li>`
    }).join('')
    const emptyHint = query !== '' && items === '' && feedback === ''
        ? '<p class="modal__hint" data-testid="user-search-empty">Никого не нашли — уточните префикс</p>'
        : ''
    const feedbackHtml = feedback !== ''
        ? `<p class="modal__feedback" data-testid="add-user-feedback">${escapeHtml(feedback)}</p>`
        : ''

    return ''
        + '<div class="modal__search-flow">'
        + '<input class="modal__input" type="text" name="user-search" data-testid="user-search-input" '
        + `placeholder="Имя пользователя (email)" value="${escapeHtml(query)}" autocomplete="off" aria-label="Логин для поиска" />`
        + `<p class="modal__hint">Начните вводить начало или полный email — поиск сработает сам</p>${
            feedbackHtml
        }<ul class="modal__results" data-testid="user-search-results">${items}</ul>${
            emptyHint
        }</div>`
}

// Контент модалки удаления чата: текст с названием и пара кнопок
// (подтверждение кликом — удаление owner-only на бэкенде)
export function renderDeleteModalContent(chatTitle: unknown): string {
    return ''
        + '<div class="modal__confirm-flow">'
        + `<p class="modal__text" data-testid="delete-chat-text">Удалить чат «${escapeHtml(chatTitle)}»? `
        + 'Сообщения и участники будут удалены безвозвратно.</p>'
        + '<div class="modal__actions">'
        + '<button type="button" class="modal__button modal__button_danger" data-testid="delete-chat-confirm">Удалить</button>'
        + '<button type="button" class="modal__button" data-testid="delete-chat-cancel">Отмена</button>'
        + '</div>'
        + '</div>'
}

// Контент меню участника (2026-11-01-chat-leave, узор меню контактов):
// матрица видимости — чужой аватар: «Добавить в контакты» (id НЕ в контактах
// вьюера) и «Удалить из чата» (вьюер — владелец); собственный аватар:
// «Удалиться из чата»; «Отмена» — всегда. Данные экранируются — modal
// рендерит слот без экранирования
export function renderChatMemberMenuContent(options: {
    target?: { id?: number, display_name?: string } | null
    contactIds?: number[]
    meId?: number
    ownerId?: number
}): string {
    const id = typeof options.target?.id === 'number' ? options.target.id : undefined
    const name = options.target?.display_name ?? ''
    const contacts = new Set(options.contactIds ?? [])
    const isSelf = id !== undefined && options.meId !== undefined && id === options.meId
    const isOwner = options.meId !== undefined && options.ownerId !== undefined && options.meId === options.ownerId
    const actions: string[] = []

    if (id !== undefined && !isSelf && !contacts.has(id)) {
        actions.push('<button type="button" class="modal__button" data-testid="member-menu-add-contact">Добавить в контакты</button>')
    }

    if (id !== undefined && !isSelf && isOwner) {
        actions.push('<button type="button" class="modal__button modal__button_danger" data-testid="member-menu-kick">Удалить из чата</button>')
    }

    if (isSelf) {
        actions.push('<button type="button" class="modal__button modal__button_danger" data-testid="member-menu-leave">Удалиться из чата</button>')
    }

    actions.push('<button type="button" class="modal__button" data-testid="member-menu-cancel">Отмена</button>')

    const nameHtml = `<p class="modal__text" data-testid="member-menu-name">${escapeHtml(name)}</p>`

    return `<div class="modal__confirm-flow">${nameHtml}<div class="modal__actions">${actions.join('')}</div></div>`
}

// Пропсы Message, вычисленные из DTO: сторона пузыря, безопасный URL
// вложения и showDate — маркер вешается на первое сообщение дня (сравнение
// календарных дней соседних time). Невалидная метка маркера не даёт и
// цепочку дней не рвёт: день без ключа просто пропускается.
export function mapTypedMessages(
    messages: Message[],
    currentUserId: number | undefined
): (Message & { isMine: boolean; fileUrl?: string; showDate: boolean })[] {
    let previousDayKey: string | undefined

    return messages.map(message => {
        const dayKey = messageDayKey(message.time)
        const showDate = dayKey !== undefined && dayKey !== previousDayKey

        if (dayKey !== undefined) {
            previousDayKey = dayKey
        }

        return {
            ...message,
            isMine: message.user_id === currentUserId,
            fileUrl: message.file_url ?? (message.file ? fileUrl(message.file.path) : undefined),
            showDate,
        }
    })
}

class MessengerBase extends Block {
    // таймер дебаунса @-поиска: живёт на инстансе — перерисовки его не рвут
    private userSearchDebounce: ReturnType<typeof setTimeout> | null = null
    // Автоскролл: перерисовки пересоздают список (сброс scrollTop) и даже
    // сам инстанс Messenger. Механика: на входе CDU ещё живой узел даёт
    // актуальную позицию (FLOW_RENDER после CDU); узловой указатель отличает
    // первый CDU каскада от последующих; модульная память по chatId спасает
    // позицию при пересоздании инстанса (CDM нового продолжает чтение).
    private static scrollMemory = new Map<number, { top: number, pinned: boolean }>()
    // модульный scroll-синк: событие — единственный всегда-верный источник
    // позиции (DOM-снятие на CDU-входе не ловит перерисовки инстанса)
    private static currentScrollKey = -1
    private static scrollSyncInstalled = false
    // метка времени последнего планового кадра скролла: перерисовка,
    // сбрасывая scrollTop в ноль, порождает scroll-событие с top=0, которое
    // без этой метки затирало бы сохранённую позицию чтения
    private static lastPlanAt = 0

    private static installScrollSync(): void {
        if (MessengerBase.scrollSyncInstalled || typeof document === 'undefined') {
            return
        }

        MessengerBase.scrollSyncInstalled = true

        document.addEventListener('scroll', (event: Event) => {
            const el = event.target as { className?: unknown, scrollTop?: number, scrollHeight?: number, clientHeight?: number }

            if (typeof el.className !== 'string' || !el.className.includes('messenger__container')) {
                return
            }

            if (typeof el.scrollHeight !== 'number') {
                return
            }

            const top = el.scrollTop ?? 0

            // сброс-эхо сразу после планового кадра игнорируем
            if (top === 0 && Date.now() - MessengerBase.lastPlanAt < 300) {
                return
            }

            const pinned = el.scrollHeight - top - (el.clientHeight ?? 0) < 120

            MessengerBase.scrollMemory.set(MessengerBase.currentScrollKey, { top, pinned })
        }, true)
    }

    private scrollPlan: 'bottom' | 'preserve' | null = null
    private scrollPlanScheduled = false

    private memoryKey(): number {
        const chatId = (this.props as MessengerProps).selectedChat

        return typeof chatId === 'number' ? chatId : -1
    }

    componentDidMount() {
        MessengerBase.installScrollSync()
        MessengerBase.currentScrollKey = this.memoryKey()

        // пересоздание инстанса: продолжаем сохранённое чтение, если читали
        // не у низа; иначе — последние сообщения
        const memory = MessengerBase.scrollMemory.get(this.memoryKey())

        this.planMessagesScroll(memory !== undefined && !memory.pinned ? 'preserve' : 'bottom')
    }

    protected componentDidUpdate(oldProps: Record<string, unknown>, newProps: Record<string, unknown>): boolean {
        MessengerBase.currentScrollKey = this.memoryKey()

        const chatChanged = (oldProps as MessengerProps).selectedChat !== (newProps as MessengerProps).selectedChat
        const oldLen = ((oldProps as MessengerProps).messages ?? []).length
        const newLen = ((newProps as MessengerProps).messages ?? []).length

        if (chatChanged) {
            MessengerBase.scrollMemory.delete(this.memoryKey())
            this.planMessagesScroll('bottom')
        } else {
            // рост (новое сообщение) докручивает, если читали низ; перерисовка
            // без роста (реакция, черновик) возвращает позицию чтения
            this.planMessagesScroll(newLen > oldLen ? 'preserve' : 'preserve')
        }

        return true
    }

    // Один план на кадр: последовательные CDU не перебивают друг друга
    // мгновенными (уже сброшенными) значениями.
    private planMessagesScroll(plan: 'bottom' | 'preserve'): void {
        this.scrollPlan = plan

        if (this.scrollPlanScheduled) {
            return
        }

        this.scrollPlanScheduled = true
        const run = () => {
            this.scrollPlanScheduled = false
            MessengerBase.lastPlanAt = Date.now()
            const container = this.element?.querySelector('.messenger__container') as
                { scrollTop?: number, scrollHeight?: number } | null
            const action = this.scrollPlan
            const key = this.memoryKey()

            MessengerBase.currentScrollKey = key

            const memory = MessengerBase.scrollMemory.get(key)

            this.scrollPlan = null

            // утиная проверка: jsdom-тесты не дают HTMLElement; элемента
            // может не быть вовсе (изолированные тесты)
            if (container == null || typeof container.scrollHeight !== 'number') {
                return
            }

            if (action === 'bottom' || memory === undefined || memory.pinned) {
                container.scrollTop = container.scrollHeight
                MessengerBase.scrollMemory.set(key, { top: container.scrollTop, pinned: true })
            } else {
                container.scrollTop = memory.top
            }

        }

        // CDU выполняется до FLOW_RENDER — скроллим в следующем кадре
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run)
        } else {
            setTimeout(run, 0)
        }
    }

    // Отправка из composer-формы: текст читается на момент сабмита,
    // selectedChat — из this.props (LIVE-7), ответ уходит с reply_to_id
    private handleComposerSubmit(form: HTMLFormElement): void {
        const input = form.querySelector<HTMLInputElement>('input[name="message"]')
        const text = (input?.value ?? '').trim()

        if (text === '') {
            return
        }

        const { onSendMessage, selectedChat, replyDraft } = this.props as MessengerProps

        if (typeof selectedChat === 'number') {
            onSendMessage?.(selectedChat, text, replyDraft?.id)

            if (replyDraft != null) {
                this.setProps({ replyDraft: null })
            }
        }

        if (input != null) {
            input.value = ''
        }
    }

    constructor(propsFromStore: MessengerProps) {
        super({
            ...propsFromStore,
            // controller-free UI-состояние модалок и черновика ответа
            addUserOpen: false,
            addUserQuery: '',
            addUserResults: [],
            addUserFeedback: '',
            deleteModalOpen: false,
            replyDraft: null,
            menuTarget: null,
            // черновик ответа: пузырь поднял событие — превью над инпутом
            onReplyToMessage: (draft: ReplyDraft | null) => {
                this.setProps({ replyDraft: draft })
            },
            onCloseAddUser: () => {
                this.setProps({ addUserOpen: false, addUserResults: [], addUserFeedback: '' })
            },
            onCloseDelete: () => {
                this.setProps({ deleteModalOpen: false })
            },
            onCloseMemberMenu: () => {
                this.setProps({ menuTarget: null })
            },
            // Колбэк обязан жить в пропсах: this.props обновляется setProps,
            // а замыкание конструктора застывало на старом selectedChat (LIVE-7)
            // Кнопка «назад» — сырой <button> в messenger.hbs; клик ловится
            // делегированием с корня (прецедент — chat-history), колбэк
            // читается из this.props на момент клика (LIVE-7)
            events: {
                submit: (event: Event) => {
                    const form = event.target as HTMLFormElement

                    event.preventDefault()

                    if (form?.dataset?.testid === 'composer-form') {
                        this.handleComposerSubmit(form)
                    }
                },
                click: (event: Event) => {
                    const target = event.target as HTMLElement | null

                    if (target?.closest('[data-testid="messenger-back"]') != null) {
                        (this.props as MessengerProps).onBack?.()

                        return
                    }

                    if (target?.closest('[data-testid="reply-cancel"]') != null) {
                        this.setProps({ replyDraft: null })

                        return
                    }

                    // клик по аватару участника в шапке: меню участника.
                    // Архивный чат (leftAt) — меню нет вовсе; участник ищется
                    // в selectedChatUsers по data-user-id обёртки аватара
                    const avatarHost = target?.closest('[data-testid="chat-user-avatar"]') as HTMLElement | null

                    if (avatarHost != null) {
                        const chatInfo = (this.props as MessengerProps).chatInfo as { leftAt?: string | null } | undefined

                        if (chatInfo?.leftAt == null) {
                            const userId = Number(avatarHost.dataset.userId)
                            const users = (this.props as MessengerProps).selectedChatUsers ?? []
                            const user = users.find(entry => entry.id === userId)

                            if (user != null) {
                                this.setProps({ menuTarget: user })
                            }
                        }

                        return
                    }

                    const resultButton = target?.closest('[data-testid="user-search-result"]') as HTMLElement | null

                    if (resultButton != null && !(resultButton as HTMLButtonElement).disabled) {
                        const userId = Number(resultButton.dataset.userId)
                        const { onAddUser, selectedChat } = this.props as MessengerProps

                        if (Number.isInteger(userId) && typeof selectedChat === 'number') {
                            this.setProps({ addUserFeedback: 'Добавляем…' })
                            void Promise.resolve(onAddUser?.(userId, selectedChat))
                                .then(() => {
                                    this.setProps({ addUserFeedback: 'Пользователь добавлен' })
                                })
                                .catch(() => {
                                    this.setProps({ addUserFeedback: 'Не удалось добавить пользователя' })
                                })
                        }

                        return
                    }

                    if (target?.closest('[data-testid="delete-chat-confirm"]') != null) {
                        const { onDeleteChat, selectedChat } = this.props as MessengerProps

                        this.setProps({ deleteModalOpen: false })

                        if (typeof selectedChat === 'number') {
                            onDeleteChat?.(selectedChat)
                        }

                        return
                    }

                    if (target?.closest('[data-testid="delete-chat-cancel"]') != null) {
                        this.setProps({ deleteModalOpen: false })

                        return
                    }

                    // действия меню участника: читаются из this.props на
                    // момент клика (LIVE-7); меню закрывается всегда
                    if (target?.closest('[data-testid="member-menu-add-contact"]') != null) {
                        const { menuTarget, onAddContact } = this.props as MessengerProps

                        this.setProps({ menuTarget: null })

                        if (menuTarget != null) {
                            onAddContact?.(menuTarget.id)
                        }

                        return
                    }

                    if (target?.closest('[data-testid="member-menu-kick"]') != null) {
                        const { menuTarget, onKickUser, selectedChat } = this.props as MessengerProps

                        this.setProps({ menuTarget: null })

                        if (menuTarget != null && typeof selectedChat === 'number') {
                            onKickUser?.(menuTarget.id, selectedChat)
                        }

                        return
                    }

                    if (target?.closest('[data-testid="member-menu-leave"]') != null) {
                        const { onLeaveChat, selectedChat } = this.props as MessengerProps

                        this.setProps({ menuTarget: null })

                        if (typeof selectedChat === 'number') {
                            onLeaveChat?.(selectedChat)
                        }

                        return
                    }

                    if (target?.closest('[data-testid="member-menu-cancel"]') != null) {
                        this.setProps({ menuTarget: null })
                    }
                },
                // поиск пользователя: ввод (начало или полный email) ->
                // дебаунс -> onSearchUsers -> список находок; перерисовка
                // только по ответу, фокус возвращаем
                input: (event: Event) => {
                    const target = event.target as HTMLElement | null

                    if (target?.closest('[data-testid="user-search-input"]') == null) {
                        return
                    }

                    // значение уходит в поиск как введено: логин — полный
                    // email, «@» из него не вырезается
                    const query = (target as HTMLInputElement).value

                    if (this.userSearchDebounce != null) {
                        clearTimeout(this.userSearchDebounce)
                    }

                    if (query.trim() === '') {
                        this.setProps({ addUserQuery: '', addUserResults: [], addUserFeedback: '' })

                        return
                    }

                    this.userSearchDebounce = setTimeout(() => {
                        const { onSearchUsers } = this.props as MessengerProps

                        void onSearchUsers?.(query.trim())
                            .then(results => {
                                this.setProps({ addUserQuery: query, addUserResults: results ?? [] })
                                this.refocusSearchInput()
                            })
                            .catch(() => {
                                this.setProps({ addUserFeedback: 'Поиск не удался — попробуйте ещё раз' })
                            })
                    }, USER_SEARCH_DEBOUNCE_MS)
                },
            } as unknown as Record<string, () => void>,
            headerButtons: [
                {
                    extraClass: 'close',
                    // подтверждение удаления — модалка; сам id читается из
                    // this.props на момент клика по «Удалить» (LIVE-7)
                    handleClick: () => {
                        this.setProps({ deleteModalOpen: true })
                    },
                },
                {
                    extraClass: 'cross',
                    handleClick: () => {
                        this.setProps({ addUserOpen: true, addUserResults: [], addUserFeedback: '' })
                    },
                },
            ],
        })
    }

    // фокус в поле поиска после перерисовки по ответу поиска: DOM заменён,
    // возвращаем пользователя туда, где он печатал
    private refocusSearchInput(): void {
        const input = this.element?.querySelector<HTMLInputElement>('[data-testid="user-search-input"]')

        if (input != null) {
            input.focus()

            const end = input.value.length

            input.setSelectionRange(end, end)
        }
    }

    destroy() {
        if (this.userSearchDebounce != null) {
            clearTimeout(this.userSearchDebounce)
        }

        super.destroy()
    }

    render() {
        const props = this.props as MessengerProps
        const chatInfo = props.chatInfo as { title?: unknown, leftAt?: string | null } | undefined
        const chatTitle = chatInfo?.title
        // архивное членство (left_at из GET /chats): чат только читается —
        // меню участников, кнопка «+» и композер скрыты, история скроллится
        const archived = chatInfo?.leftAt != null
        const menuTarget = props.menuTarget ?? null
        const headerButtons = (props.headerButtons as { extraClass?: string }[] | undefined) ?? []
        const visibleHeaderButtons = archived
            ? headerButtons.filter(button => button.extraClass !== 'cross')
            : headerButtons

        return this.compile(template, {
            ...props,
            archived,
            headerButtons: visibleHeaderButtons,
            menuTitle: menuTarget?.display_name ?? '',
            menuOpen: menuTarget != null,
            menuContent: renderChatMemberMenuContent({
                target: menuTarget,
                contactIds: props.contactIds,
                meId: props.meId,
                ownerId: props.ownerId,
            }),
            addUserContent: renderAddUserModalContent({
                ...props,
                memberIds: ((props).selectedChatUsers ?? [])
                    .map(member => (member as { id?: number }).id)
                    .filter((id): id is number => typeof id === 'number'),
            }),
            deleteContent: renderDeleteModalContent(chatTitle),
        })
    }
}

const withMessenger = withStore((state: AppState) => {
    const selectedChatId = state.selectedChat

    if (
        selectedChatId == null ||
        state.messages === undefined ||
        state.messages[selectedChatId] === undefined
    ) {
        return {
            selectedChat: undefined,
            messages: [],
        }
    }

    const messages = mapTypedMessages(state.messages[selectedChatId], state.user?.id)

    const chatInfo = state.chats?.find(chat => chat.id === selectedChatId)

    return {
        selectedChat: state.selectedChat,
        selectedChatUsers: state.chatUsers,
        messages,
        chatInfo,
    }
})

export const Messenger = withMessenger(MessengerBase as typeof Block)
