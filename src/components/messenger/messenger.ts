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
import { pruneComponentCache } from '../../core/registerComponent.ts'
import Handlebars from 'handlebars'
import { Button, Input, Message, MessageAttachment } from '../../utils/types.ts'
import { AppState, withStore } from '../../utils/Store.ts'
import { fileUrl } from '../../utils/env.ts'
import { getPreferences, subscribePreferences } from '../../utils/preferences.ts'
import { messageDayKey } from '../message/message.ts'
import {
    deleteFeedScroll,
    getFeedScroll,
    installFeedScrollSync,
    markFeedScrollPlan,
    resolveFeedScrollTarget,
    setFeedScroll,
    setFeedScrollKey,
} from './feed-scroll.ts'
import template from './messenger.hbs'

// Дебаунс @-поиска: поиск стартует, когда пользователь перестал печатать
export const USER_SEARCH_DEBOUNCE_MS = 300

// Фиксированный ключ pending-плейсхолдера бота (2026-11-04 render-perf):
// один плейсхолдер на ленту — контроллер гарантирует максимум один
// isPending-хвост на чат (композер блокируется на время прогона), поэтому
// привязки к вопросу не нужно (review F-1)
export const PENDING_TAIL_CACHE_KEY = 'pending:tail'

// Ключ переиспользования Message-инстанса: реальному сообщению — id:<n>;
// isPending-хвосту без id — фиксированный pending:tail; сообщению без
// идентичности — undefined (кэш не участвует, инстанс строится каждым
// рендером заново, как до keyed-кэша)
function messageCacheKey(message: Message): string | undefined {
    if (typeof message.id === 'number') {
        return `id:${message.id}`
    }

    return message.isPending === true ? PENDING_TAIL_CACHE_KEY : undefined
}

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
    // смена аватара чата из шапки (2026-11-05): скрытый InputFile рядом с
    // заголовком; аффорданс — только владельцу и не в архивном чате
    // eslint-disable-next-line no-unused-vars
    onChatAvatar?: (data: FormData) => void
    // inline-переименование (2026-11-05): коммит по Enter/Escape/focus-out
    // eslint-disable-next-line no-unused-vars
    onRenameChat?: (chatId: number, title: string) => void
    // «+AI» (2026-11-06-chat-create-flow): включает бота в текущем чате
    // eslint-disable-next-line no-unused-vars
    onEnableAi?: (chatId: number) => void
    // UI-флаг «заголовок в режиме инпута» (controller-free, поднимается setProps)
    renamingTitle?: boolean
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
    // бот отвечает в этом чате (isPending-плейсхолдер в ленте): отправка
    // заблокирована — один бот-ран на чат, параллельные вешают провайдера
    botPending?: boolean
    // раскрыт ли набор эмодзи у сообщения (переключается самим message)
    reactionsOpen?: boolean
    // Гейт автозагрузки вложений (2026-11-01-settings): начальное значение —
    // из preferences, живые переключения подъезжают подпиской
    autoDownload?: boolean
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
// 2026-11-02-ui-ux: список вложений пузыря — каждое сообщение с файлом
// получает attachments (файловая строка с иконкой и «Скачать»). Мок-список
// «документов бота» снят 2026-11-03: бот работает и несёт реальное вложение
// ответа (attachment из bot_runs) — входящие в AI-чате рендерятся как все:
// один пункт с настоящим именем файла, когда контракт его несёт
// (file.filename сегодня не наполняется адаптерами — фолбэк «Файл»).
export function mapTypedMessages(
    messages: Message[],
    currentUserId: number | undefined
): (Message & { isMine: boolean; fileUrl?: string; showDate: boolean; attachments?: MessageAttachment[]; cacheKey?: string })[] {
    let previousDayKey: string | undefined

    return messages.map(message => {
        const dayKey = messageDayKey(message.time)
        const showDate = dayKey !== undefined && dayKey !== previousDayKey

        if (dayKey !== undefined) {
            previousDayKey = dayKey
        }

        const isMine = message.user_id === currentUserId
        const fileUrlValue = message.file_url ?? (message.file ? fileUrl(message.file.path) : undefined)
        // готовый список (контроллер дописал найденные документы под ответом
        // бота) приоритетнее одиночной строки собственного вложения
        let attachments: MessageAttachment[] | undefined = message.attachments

        if (attachments == null && fileUrlValue !== undefined) {
            attachments = [{ name: message.file?.filename ?? 'Файл', url: fileUrlValue }]
        }

        return {
            ...message,
            isMine,
            fileUrl: fileUrlValue,
            attachments,
            showDate,
            cacheKey: messageCacheKey(message),
        }
    })
}

class MessengerBase extends Block {
    // таймер дебаунса @-поиска: живёт на инстансе — перерисовки его не рвут
    private userSearchDebounce: ReturnType<typeof setTimeout> | null = null
    // План прокрутки ленты на кадр (2026-11-02-ui-ux): память и document-
    // capture синк живут в общем модуле feed-scroll (ими же пользуется
    // страница чата), этот флаг — ЛИЧНАЯ rAF-коалесценция инстанса: план
    // применяется к собственному this.element (контракт review F-5), план
    // брошенного инстанса разрешается в detached-узле и молчит
    private scrollPlanScheduled = false

    // черновик композера между перерисовками (componentDidUpdate снимает,
    // render возвращает в новый DOM — см. 2026-11-06-quick)
    private composerDraft = ''
    // отписка от preferences: тумблер автозагрузки в настройках должен
    // перерисовать вложения открытого чата, а утечка подписки — нет
    private unsubscribePreferences: (() => void) | null = null

    private memoryKey(): number {
        const chatId = (this.props as MessengerProps).selectedChat

        return typeof chatId === 'number' ? chatId : -1
    }

    componentDidMount() {
        installFeedScrollSync()
        setFeedScrollKey(this.memoryKey())

        // пересоздание инстанса: продолжаем сохранённое чтение, если читали
        // не у низа; иначе — последние сообщения
        const memory = getFeedScroll(this.memoryKey())

        this.planMessagesScroll(memory !== undefined && !memory.pinned ? 'preserve' : 'bottom')
    }

    protected componentDidUpdate(oldProps: Record<string, unknown>, newProps: Record<string, unknown>): boolean {
        setFeedScrollKey(this.memoryKey())

        const chatChanged = (oldProps as MessengerProps).selectedChat !== (newProps as MessengerProps).selectedChat

        // 2026-11-06-quick: черновик композера переживает перерисовку —
        // входящее сообщение (WS message → setProps) раньше стирало
        // набираемый текст пересозданием DOM; смена чата черновик не
        // переносит (пишем в другой контекст)
        if (chatChanged) {
            this.composerDraft = ''
        } else {
            const input = this.element?.querySelector<HTMLInputElement>('input.messenger__composer-input')

            this.composerDraft = input?.value ?? ''
        }

        if (chatChanged) {
            deleteFeedScroll(this.memoryKey())
            this.planMessagesScroll('bottom')
        } else {
            // собственные перерисовки (модалки, черновик, реакции) возвращают
            // позицию чтения; стор-управляемые планы никогда не доходят до
            // живого узла (страница пересоздаёт инстанс раньше) — движок
            // страницы (WS-FE-FEED-SCROLL) владеет ими через тот же модуль
            this.planMessagesScroll('preserve')
        }

        return true
    }

    // Один план на кадр: последовательные CDU не перебивают друг друга
    // мгновенными (уже сброшенными) значениями. Цель считает общий модуль,
    // применение — только к собственному элементу инстанса.
    private planMessagesScroll(plan: 'bottom' | 'preserve'): void {
        if (this.scrollPlanScheduled) {
            return
        }

        this.scrollPlanScheduled = true
        const run = () => {
            this.scrollPlanScheduled = false
            markFeedScrollPlan()
            const container = this.element?.querySelector('.messenger__container') as
                { scrollTop?: number, scrollHeight?: number } | null
            const key = this.memoryKey()

            setFeedScrollKey(key)

            // утиная проверка: jsdom-тесты не дают HTMLElement; элемента
            // может не быть вовсе (изолированные тесты, брошенные инстансы)
            if (container == null || typeof container.scrollHeight !== 'number') {
                return
            }

            const target = resolveFeedScrollTarget(key, plan)

            if (target === 'bottom') {
                container.scrollTop = container.scrollHeight
                setFeedScroll(key, { top: container.scrollTop, pinned: true })
            } else {
                container.scrollTop = target.top
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

        // бот ещё отвечает — сабмит игнорируется целиком: текст и черновик
        // остаются в композере, уйдут следующим сабмитом после ответа
        if ((this.props as MessengerProps).botPending === true) {
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

        // отправка пишет в стор (optimistic + pending-плейсхолдер) — лента
        // перерисовывается и пересоздаёт DOM композера, фокус падает;
        // возвращаем его в следующем кадре, когда перерисовка сошла
        const restoreFocus = () => {
            this.element?.querySelector<HTMLInputElement>('input[name="message"]')?.focus()
        }

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(restoreFocus)
        } else {
            setTimeout(restoreFocus, 0)
        }
    }

    constructor(propsFromStore: MessengerProps) {
        super({
            ...propsFromStore,
            // гейт автозагрузки вложений: стартует из preferences, дальше
            // живёт подпиской (тумблер в настройках применяет сразу)
            autoDownload: getPreferences().autoDownload,
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
                dblclick: (event: Event) => {
                    const target = event.target as HTMLElement | null

                    // заголовок → инпут переименования; архивный чат
                    // (leftAt) — read-only, аффорданса нет (2026-11-05)
                    if (target?.closest('[data-testid="chat-title"]') != null) {
                        if ((this.props as MessengerProps & { chatInfo?: { leftAt?: string | null } }).chatInfo?.leftAt == null) {
                            this.setProps({ renamingTitle: true })
                            this.focusTitleInput()
                        }
                    }
                },
                keydown: (event: Event) => {
                    const target = event.target as HTMLElement | null
                    const key = (event as KeyboardEvent).key

                    // ТОЛЬКО Enter и Escape сохраняют (решение оператора:
                    // без подтверждения, Esc — не отмена) и закрывают ввод;
                    // прочие клавиши проходят в инпут — название набирается
                    // с клавиатуры (review TF-1: коммит на любой клавише
                    // глотал символы и закрывал редактор)
                    if (
                        target?.closest('[data-testid="chat-title-input"]') != null &&
                        (key === 'Enter' || key === 'Escape')
                    ) {
                        event.preventDefault()
                        this.commitTitleInput()
                    }
                },
                focusout: (event: Event) => {
                    const target = event.target as HTMLElement | null

                    // клик вне инпута = сохранение (если значение валидно)
                    if (target?.closest('[data-testid="chat-title-input"]') != null) {
                        this.commitTitleInput()
                    }
                },
                click: (event: Event) => {
                    const target = event.target as HTMLElement | null

                    // клик по аватару чата в шапке: пикер загрузки — только
                    // владелец и только активное членство (гейт дублирует
                    // серверный require_owned); props читаются на момент клика
                    if (target?.closest('[data-testid="chat-avatar-slot"]') != null) {
                        const props = this.props as MessengerProps

                        if (
                            props.meId != null &&
                            props.ownerId === props.meId &&
                            (props.chatInfo as { leftAt?: string | null } | undefined)?.leftAt == null
                        ) {
                            this.refs.avatarInput?.element?.click()
                        }

                        return
                    }

                    if (target?.closest('[data-testid="messenger-back"]') != null) {
                        (this.props as MessengerProps).onBack?.()

                        return
                    }

                    if (target?.closest('[data-testid="reply-cancel"]') != null) {
                        this.setProps({ replyDraft: null })

                        return
                    }

                    // подсказка пустого чата: кнопка «добавить» открывает ту
                    // же модалку поиска, что и «+» шапки (узор открытия cross)
                    if (target?.closest('[data-testid="empty-chat-add"]') != null) {
                        this.setProps({ addUserOpen: true, addUserQuery: '', addUserResults: [], addUserFeedback: '' })
                        this.refocusSearchInput()

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
                        // полная очистка: немедленный setProps перерисовывает
                        // модалку и пересоздаёт инпут — возвращаем фокус и
                        // каретку, пользователь продолжает печатать
                        this.setProps({ addUserQuery: '', addUserResults: [], addUserFeedback: '' })
                        this.refocusSearchInput()

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
                        // открытие модалки поиска: черновой запрос прошлого
                        // сеанса не тянется в новый, ввод начинается сразу —
                        // фокус в поле в следующем кадре (перерисовка
                        // пересоздаёт инпут, живой фокус мгновенно потерять
                        // не успеваем, но DOM уже новый)
                        this.setProps({ addUserOpen: true, addUserQuery: '', addUserResults: [], addUserFeedback: '' })
                        this.refocusSearchInput()
                    },
                },
            ],
        })

        // живой тумблер автозагрузки: настройка применяется к открытому чату
        this.unsubscribePreferences = subscribePreferences(preferences => {
            this.setProps({ autoDownload: preferences.autoDownload })
        })
    }

    // фокус в поле поиска после перерисовки (открытие модалки, очистка
    // запроса, ответ поиска): DOM заменён, возвращаем пользователя туда,
    // где он печатал; кадр — перерисовка должна сойти до фокуса
    private refocusSearchInput(): void {
        const run = () => {
            const input = this.element?.querySelector<HTMLInputElement>('[data-testid="user-search-input"]')

            if (input != null) {
                input.focus()

                const end = input.value.length

                input.setSelectionRange(end, end)
            }
        }

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run)
        } else {
            setTimeout(run, 0)
        }
    }

    // фокус в инпут переименования после перерисовки: заголовок превратился
    // в <input> — курсор в конец, чтобы править название сразу
    private focusTitleInput(): void {
        const run = () => {
            const input = this.element?.querySelector<HTMLInputElement>('[data-testid="chat-title-input"]')

            if (input != null) {
                input.focus()

                const end = input.value.length

                input.setSelectionRange(end, end)
            }
        }

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run)
        } else {
            setTimeout(run, 0)
        }
    }

    // Сохранение переименования (Enter/Escape/клик вне — все сохраняют):
    // пустое или неизменённое значение — тихий откат без запроса; валидное —
    // onRenameChat (контроллер делает оптимистичный патч и откат по ошибке)
    private commitTitleInput(): void {
        const input = this.element?.querySelector<HTMLInputElement>('[data-testid="chat-title-input"]')

        if (input == null) {
            return
        }

        const value = input.value.trim()
        const { onRenameChat, selectedChat, chatInfo } = this.props as MessengerProps
        const currentTitle = (chatInfo as { title?: unknown } | undefined)?.title

        this.setProps({ renamingTitle: false })

        if (
            value !== '' &&
            value !== currentTitle &&
            typeof selectedChat === 'number'
        ) {
            onRenameChat?.(selectedChat, value)
        }
    }

    destroy() {
        if (this.userSearchDebounce != null) {
            clearTimeout(this.userSearchDebounce)
        }

        this.unsubscribePreferences?.()
        this.unsubscribePreferences = null

        super.destroy()
    }

    render() {
        const props = this.props as MessengerProps
        const chatInfo = props.chatInfo as
            | { title?: unknown, leftAt?: string | null, avatar?: unknown, is_ai?: boolean, auto_titled?: boolean }
            | undefined
        const chatTitle = chatInfo?.title
        // архивное членство (left_at из GET /chats): чат только читается —
        // меню участников, кнопка «+» и композер скрыты, история скроллится
        const archived = chatInfo?.leftAt != null
        // аватар чата в шапке: смена — только владелец и только активное
        // членство (серверный require_owned + read-only архива); остальным —
        // просто картинка без аффорданса
        const canEditAvatar = !archived && props.meId != null && props.ownerId === props.meId
        const chatAvatar = typeof chatInfo?.avatar === 'string' ? chatInfo.avatar : ''
        const menuTarget = props.menuTarget ?? null
        // авто-название (2026-11-06-chat-create-flow): заголовок НЕ-архивного
        // auto_titled-чата — сразу инпут (механика renamingTitle без dblclick);
        // ручной rename гасит флаг оптимистично — заголовок становится h2
        const autoTitleInput = !archived && chatInfo?.auto_titled === true
        const isAiChat = chatInfo?.is_ai === true
        // подсказка пустого чата: гейт чисто по данным — нет сообщений, нет
        // соучастников кроме меня, не архивный и не AI (оператор 2026-11-06)
        const coMembers = (props.selectedChatUsers ?? [])
            .map(member => (member as { id?: number }).id)
            .filter((id): id is number => typeof id === 'number' && id !== props.meId)
        const emptyChatHint = !archived && !isAiChat && (props.messages ?? []).length === 0 && coMembers.length === 0
        // «+AI» первым в ряду кнопок: включает бота в текущем чате; в AI-чате
        // кнопка уже активна (подсветка, клики игнорирует), архивный чат её
        // не показывает вовсе (вместе с cross)
        const aiButton = {
            extraClass: isAiChat ? 'ai ai_active' : 'ai',
            handleClick: isAiChat
                ? () => {}
                : () => {
                    const live = this.props as MessengerProps

                    if (typeof live.selectedChat === 'number') {
                        live.onEnableAi?.(live.selectedChat)
                    }
                },
        }
        const headerButtons = (props.headerButtons as { extraClass?: string }[] | undefined) ?? []
        const visibleHeaderButtons = (archived
            ? headerButtons.filter(button => button.extraClass !== 'cross')
            : [aiButton, ...headerButtons])

        const fragment = this.compile(template, {
            ...props,
            archived,
            canEditAvatar,
            canRename: !archived,
            chatAvatar,
            autoTitleInput,
            emptyChatHint,
            // renamingTitle (dblclick) ИЛИ авто-режим — шаблон один инпут
            renamingTitle: props.renamingTitle === true || autoTitleInput,
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

        // вернуть черновик в свежий DOM: render вызывается ПОСЛЕ
        // componentDidUpdate (значение уже снято со старого узла), а fragment
        // ещё не вставлен — value едет с узлом в документ
        const draft = this.composerDraft
        const nextInput = fragment.querySelector<HTMLInputElement>('input.messenger__composer-input')

        if (draft !== '' && nextInput != null) {
            nextInput.value = draft
        }

        return fragment
    }
}

const withMessenger = withStore((state: AppState) => {
    const selectedChatId = state.selectedChat

    if (
        selectedChatId == null ||
        state.messages === undefined ||
        state.messages[selectedChatId] === undefined
    ) {
        // ленты нет — кэш Message-инстансов тоже пуст: осевшие записи
        // роняются (уход со страницы/снятие выбора не оставляют хвостов)
        pruneComponentCache(new Set())

        return {
            selectedChat: undefined,
            messages: [],
        }
    }

    // AI-чат нужен только для блокировки композера на время бот-рана
    // (botPending): мок-вложения сняты, ответы бота рендерят реальный файл
    const isAiChat = (state.chats?.find(chat => chat.id === selectedChatId) as { is_ai?: boolean } | undefined)?.is_ai === true

    const messages = mapTypedMessages(state.messages[selectedChatId], state.user?.id)

    // кэш живёт размером с текущую ленту: смена чата и удаление сообщения
    // роняют и destroy'ят осевшие ключи (неограниченного роста нет)
    pruneComponentCache(new Set(
        messages.flatMap(item => (item.cacheKey != null ? [item.cacheKey] : []))
    ))

    const chatInfo = state.chats?.find(chat => chat.id === selectedChatId)

    // один бот-ран на чат: пока isPending-плейсхолдер жив, композер блокируется
    const botPending = isAiChat === true
        && state.messages[selectedChatId].some(
            item => (item as { isPending?: boolean }).isPending === true
        )

    return {
        selectedChat: state.selectedChat,
        selectedChatUsers: state.chatUsers,
        messages,
        chatInfo,
        botPending,
    }
})

export const Messenger = withMessenger(MessengerBase as typeof Block)
