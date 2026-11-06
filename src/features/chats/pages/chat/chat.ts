// Feature-страница чатов (stage 4): замена src/pages/chat.
// Компоненты (User/Messenger) получают поведение через пропсы — компоненты
// не могут импортировать фичи вверх по слоям.
// chats-social: колбэки @-поиска, добавления пользователя, реакций и
// реплаев; chatPaneOpen дополнительно сбрасывается при очистке selectedChat
// (WS chat_deleted сбрасывает выбор через контроллер).
// 2026-11-01-chat-leave: колбэки меню участника (контакт/кик/выход) и
// пропсы его матрицы видимости (contactIds/meId/ownerId) уходят в Messenger,
// карточка списка получает leftAt для потушенного архивного модификатора.
// stories: лента приходит из стора (срез features/chats/stories), страница
// сохраняет только жизненный цикл UI — таймер автозакрытия и фокус оверлея
// принадлежат именно странице, потому что hbs-дети пересоздаются каждой
// перерисовкой родителя (старые без destroy() и без повторного CDM) — таймер
// внутри вьюера стал бы зомби. Пропсы stories страница не пишет: единственный
// писатель — StoriesController (иначе оптимистичный патч гонялся бы с
// withStore-мэппингом на любом постороннем store.set).

import Block from '../../../../core/Block.ts'
import store, { AppState, withStore } from '../../../../utils/Store.ts'
import {
    deleteFeedScroll,
    getFeedScroll,
    installFeedScrollSync,
    markFeedScrollPlan,
    resolveFeedScrollTarget,
    setFeedScroll,
    setFeedScrollKey,
} from '../../../../components/messenger/feed-scroll.ts'
import type { ChatInfo, ChatSearchMatch, ContactInfo } from '../../../../utils/types.ts'
import ChatsController from '../../controller.ts'
import StoriesController from '../../stories/controller.ts'
import type { StoryDto } from '../../stories/ports.ts'
import { isStoryAlive } from '../../stories/ttl.ts'
import type { ViewerStory } from '../../../../components/story/storyViewer/storyViewer.ts'
import { buildHighlightParts } from '../../../../utils/highlight.ts'
import { getChatSearchBarMemory } from '../../../../components/searchBar/searchBar.ts'
import type { ChatSearchState } from '../../store.ts'
import template from './chat.hbs'

// Длительность показа истории; дубль живёт в CSS-анимации прогресс-бара
// (src/scss/components/story-viewer.scss) — держать синхронно
export const STORY_VIEW_DURATION_MS = 5000

// id add-плитки: её клик открывает пикер вместо вьюера
const ADD_STORY_ID = 'add-story'

export interface StoryItem {
    // серверные id строкифицируются при построении рендер-списка: единый
    // тип id через страницу (add-плитка id не числовой)
    id: string
    owner: string
    src: string
    alt: string
    // выделенная (непросмотренная) рамка; add-плитка поле не задаёт
    isUnread?: boolean
    // своя история: зелёная рамка и удаление из вьюера
    isOwn?: boolean
    extraClass?: string
    type?: 'add'
}

interface ChatPageProps {
    // лента из стора (срез features/chats/stories): тип модуля — дубль
    // внутри одной фичи разъезжался бы с контрактом
    stories: StoryDto[]
    // открытая в viewer история (или null); id открытой хранит openedStoryId
    viewerStory?: ViewerStory | null
    chats?: ChatInfo[]
    selectedChat: number
    // мобильное переключение (<768): true — показана панель чата, список
    // скрыт; false — список. Модификатор корня chat_pane-open в chat.hbs
    chatPaneOpen?: boolean
    // матрица видимости меню участника (2026-11-01-chat-leave): id контактов
    // вьюера, его собственный id и владелец выбранного чата
    contactIds?: number[]
    meId?: number
    ownerId?: number
    // есть ли хоть одна пилюля непрочитанных (2026-11-05): гейт иконки
    // «Пометить всё прочитанными» в шапке списка
    hasUnread?: boolean
}

// Карточка списка чатов в пропсах страницы: ChatInfo + декорации
// активного поиска (части подсветки и время последнего совпадения)
interface OrderedChat extends ChatInfo {
    titleParts?: { before: string, match: string, after: string } | null
    snippetParts?: { before: string, match: string, after: string } | null
    searchTime?: string
}

// Порядок пустого запроса — по активности: свежий last_message сверху,
// отсутствующий — fallback на created_at (2026-11-05: свежесозданный чат
// без сообщений поднимается в верх списка, а не тонет), битый (NaN) тонет
// ниже всех дат, ничья — id DESC.
// Всегда новый массив: мэппер withStore обязан давать свежую ссылку на
// chats, иначе shallowEqual погасит перерисовку на любом стор-эмите
function activityOrder(chats: ChatInfo[]): ChatInfo[] {
    const timeOf = (chat: ChatInfo): number => {
        const candidates = [chat.last_message?.time, chat.created_at]
        const parsed = candidates
            .map(raw => (raw != null ? Date.parse(raw) : Number.NaN))
            .find(value => !Number.isNaN(value))

        return parsed === undefined ? Number.NEGATIVE_INFINITY : parsed
    }

    return [...chats].sort((left, right) => {
        const byTime = timeOf(right) - timeOf(left)

        return byTime !== 0 ? byTime : right.id - left.id
    })
}

// Порядок активного запроса: только чаты из результатов и строго в
// порядке сервера; каждой карточке — части подсветки и время совпадения.
// matched_in message/both без сниппета (R-F2) рисуется без mark
function searchOrder(chats: ChatInfo[], query: string, results: ChatSearchMatch[]): OrderedChat[] {
    const byId = new Map(chats.map(chat => [chat.id, chat]))
    const ordered: OrderedChat[] = []

    for (const result of results) {
        const chat = byId.get(result.chat_id)

        if (chat == null) {
            continue
        }

        const wantsTitle = result.matched_in === 'title' || result.matched_in === 'both'
        const wantsSnippet = result.matched_in !== 'title' && result.snippet != null

        ordered.push({
            ...chat,
            titleParts: wantsTitle ? buildHighlightParts(chat.title, query) : undefined,
            snippetParts: wantsSnippet ? result.snippet : undefined,
            searchTime: result.last_match_at ?? undefined,
        })
    }

    return ordered
}

class ChatPageBase extends Block {
    // Стор-управляемый автоскролл ленты (2026-11-02-ui-ux) живёт здесь:
    // инстанс страницы стабилен, а дочерние Messenger-инстансы пересоздаются
    // каждой перерисовкой без CDM/CDU — их собственные планы до живого узла
    // не доходили (мертвый путь прежней реализации). Память и document-
    // capture синк — в общем модуле feed-scroll (им же пользуется Messenger
    // для preserve после собственных перерисовок: модалки, черновик, меню);
    // план применяется к собственному элементу страницы, поздние CDU
    // каскада перезаписывают поле — последний побеждает
    private pendingScrollPlan: 'bottom' | 'preserve' | null = null
    private scrollPlanScheduled = false

    // Снимок ленты выбранного чата (рост хвоста против роста головы:
    // «загрузить ещё» добавляет в голову и не должно прыгать в низ)
    private lastFeedSnapshot: {
        chatId: number
        len: number
        headId: number | undefined
        tailPending: boolean
    } | null = null

    // Статичная add-плитка первой в рендер-списке: реальные истории
    // приносит стор (features/chats/stories), мок-плитки убраны
    private static addStoryTile(): StoryItem {
        return {
            id: ADD_STORY_ID,
            owner: 'You story',
            extraClass: 'chat-story__container_type_add-story',
            src: '/images/add-story-icon.svg',
            alt: 'Иконка. Создать историю',
            type: 'add',
        }
    }

    // Рендер-список: add-плитка + серверные истории из пропсов стора
    // (числовые id строкифицируются — единый тип id через страницу)
    private get renderStories(): StoryItem[] {
        const feed = (this.pageProps.stories ?? []).filter(story => isStoryAlive(story.createdAt))

        return [ChatPageBase.addStoryTile(), ...feed.map(story => ({
            id: String(story.id),
            owner: story.owner,
            src: story.src,
            alt: story.alt,
            isUnread: !story.viewed,
            isOwn: story.isOwn === true,
        }))]
    }

    // Таймер автозакрытия вьюера: владелец — стабильный инстанс страницы
    // (вьюер как hbs-ребёнок пересоздаётся и не имеет destroy-гарантий).
    // Перевзвод всегда через clearTimeout — двойных таймеров не бывает.
    private storyTimer: ReturnType<typeof setTimeout> | null = null

    // id открытой истории: пишется в openStory, читается единым close-путём
    // (viewerStory-объект id не несёт — вьюер презентационный)
    private openedStoryId: string | null = null

    // Block хранит пропсы под базовым Props; страница читает свои поля
    private get pageProps(): ChatPageProps {
        return this.props as unknown as ChatPageProps
    }

    private storyById(id: string): StoryItem | undefined {
        return this.renderStories.find(story => story.id === id)
    }

    private openStory(id: string): void {
        const story = this.storyById(id)

        if (story == null) {
            return
        }

        if (this.storyTimer != null) {
            clearTimeout(this.storyTimer)
        }

        this.storyTimer = setTimeout(() => this.closeStory(id), STORY_VIEW_DURATION_MS)
        this.openedStoryId = id
        this.setProps({
            viewerStory: {
                owner: story.owner,
                src: story.src,
                alt: story.alt,
                isOwn: story.isOwn === true,
            },
        })
        this.focusViewer()
    }

    // Сброс вьюера без маркировки просмотра (общая часть close-путей)
    private closeViewer(): void {
        if (this.storyTimer != null) {
            clearTimeout(this.storyTimer)
            this.storyTimer = null
        }

        this.openedStoryId = null
        this.setProps({ viewerStory: null })
    }

    // Единый close-путь (таймаут, бэкдроп, крестик, Escape): сбрасывает
    // вьюер и маркирует просмотр. Срез стора контроллер патчит синхронно
    // ДО POST — кольцо гаснет через withStore, сама страница stories-пропсы
    // не пишет (null — сброс без открытой)
    private closeStory(id: string | null): void {
        this.closeViewer()

        if (id != null && id !== ADD_STORY_ID) {
            StoriesController.markViewed(Number(id))
        }
    }

    // Фокус на оверлей ради Escape: ставится при открытии и после каждой
    // перерисовки (replaceWith сбрасывает фокус на body). Гвард в кадре:
    // история могла закрыться внутри кадра — не трогаем мёртвый оверлей.
    private focusViewer(): void {
        const run = () => {
            if (this.pageProps.viewerStory == null) {
                return
            }

            const overlay = this.element?.querySelector<HTMLElement>('.chat-story-viewer')

            if (typeof overlay?.focus === 'function') {
                overlay.focus()
            }
        }

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run)
        } else {
            setTimeout(run, 0)
        }
    }

    // Делегированный change с корня страницы (переживает перерисовки —
    // _addEvents перевешивает events; слушатель в CDM умер бы на первом
    // ре-рендере после fetchChats): скрытый input выбора фото истории.
    // Гвардия по классу, а не по type=file: в списке чатов свои скрытые
    // file-инпуты аватаров (InputFile name=avatar), их выбор не должен
    // уезжать на бэкенд историей
    private handleStoryFileChange(event: Event): void {
        const target = event.target as HTMLInputElement | null

        if (
            target == null ||
            typeof target.className !== 'string' ||
            !target.className.includes('chat-story-file-input')
        ) {
            return
        }

        const file = target.files != null && target.files.length > 0 ? target.files[0] : undefined

        // сброс до чтения: повторный выбор того же файла тоже стреляет change
        target.value = ''

        if (file != null) {
            // файл уходит на бэкенд, лента рефетчится контроллером — своя
            // новая история приходит первой с кольцом с сервера; без
            // оптимистичного blob-вставления
            void StoriesController.uploadStory(file)
        }
    }

    // Открытие пикера add-плиткой: ref на сыром HTML не существует (refs
    // собираются только из компонент-хелперов) — querySelector в момент
    // клика. Селектор точечный по классу (карточки чатов больше не несут
    // своих file-инпутов — аватар чата меняется из шапки мессенджера)
    private openStoryPicker(): void {
        const input = this.element?.querySelector<HTMLInputElement>('input.chat-story-file-input')

        input?.click()
    }

    // Снимок ленты выбранного чата из стора (маппер страницы сообщений не
    // несёт — прежняя ветка роста сравнивала undefined-массивы и никогда
    // не срабатывала): длина, id головы (отличие = prepend истории) и
    // pending-хвост (плейсхолдер «Ассистент печатает…» всегда пинит низ)
    private feedSnapshot(): { chatId: number, len: number, headId: number | undefined, tailPending: boolean } | null {
        const chatId = (this.props as unknown as ChatPageProps).selectedChat

        if (typeof chatId !== 'number') {
            return null
        }

        const messages = (store.getState().messages ?? {})[chatId] as { id?: number, isPending?: boolean }[] | undefined

        if (messages == null) {
            return { chatId, len: 0, headId: undefined, tailPending: false }
        }

        return {
            chatId,
            len: messages.length,
            headId: messages[0]?.id,
            tailPending: messages[messages.length - 1]?.isPending === true,
        }
    }

    // Один план на кадр: последовательные CDU каскада перезаписывают поле,
    // последний выигрывает; цель считает общий модуль, применение — к
    // собственному элементу страницы (контракт review F-5)
    private planFeedScroll(plan: 'bottom' | 'preserve'): void {
        this.pendingScrollPlan = plan

        if (this.scrollPlanScheduled) {
            return
        }

        this.scrollPlanScheduled = true

        const run = () => {
            this.scrollPlanScheduled = false

            const action = this.pendingScrollPlan

            this.pendingScrollPlan = null

            // снимок ленты обновляется ОДИН раз на кадр: каждый CDU каскада
            // решает против прошлого снимка, иначе поздние CDU того же
            // эмита «не видят» рост и переигрывают решение на preserve
            this.lastFeedSnapshot = this.feedSnapshot()

            if (action == null) {
                return
            }

            markFeedScrollPlan()

            const chatId = (this.props as unknown as ChatPageProps).selectedChat
            const container = this.element?.querySelector('.messenger__container') as
                { scrollTop?: number, scrollHeight?: number } | null

            if (typeof chatId !== 'number') {
                return
            }

            setFeedScrollKey(chatId)

            // утиная проверка: jsdom-тесты не дают HTMLElement; элемента
            // может не быть вовсе (изолированные тесты, пустая страница)
            if (container == null || typeof container.scrollHeight !== 'number') {
                return
            }

            const target = resolveFeedScrollTarget(chatId, action)

            if (target === 'bottom') {
                container.scrollTop = container.scrollHeight
                setFeedScroll(chatId, { top: container.scrollTop, pinned: true })
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
    constructor(propsFromStore: ChatPageProps) {
        super({
            // 2026-11-01-contacts: страница, смонтированная с уже выбранным
            // чатом (возврат на /messenger после openDm из /contacts),
            // стартует с открытой панелью — раньше живой выбор игнорировался
            // и мобильный вход всегда показывал список
            chatPaneOpen: propsFromStore.selectedChat != null,
            // единая точка входа для плиток: add-плитка открывает пикер,
            // обычная — вьюер с автозакрытием
            onSelectStory: (id?: string) => {
                if (id === ADD_STORY_ID) {
                    this.openStoryPicker()

                    return
                }

                if (id != null) {
                    this.openStory(id)
                }
            },
            onCloseViewer: () => {
                // id открытой истории хранит страница (openedStoryId);
                // viewerStory-объект id не несёт — вьюер презентационный
                this.closeStory(this.openedStoryId)
            },
            onDeleteViewer: () => {
                // удаление своей истории: вьюер закрывается БЕЗ маркировки
                // просмотра — история исчезает из ленты после рефетча
                const id = this.openedStoryId

                this.closeViewer()

                if (id != null && id !== ADD_STORY_ID) {
                    void StoriesController.deleteStory(Number(id))
                }
            },
            onClick: () => {
                // One-click создание (2026-11-06-chat-create-flow): кнопка
                // «Создать чат» шапки списка сразу рождает чат «Чат с» —
                // карточка поднимается вверху списка, селект открывает
                // мессенджер справа (createAndSelect сам гонит порядок
                // POST → fetchChats → select)
                void ChatsController.createAndSelect()
            },
            onSelectChat: (id: number) => {
                // Любой выбор чата открывает панель — chatListUser стреляет
                // onSelect и на повторном клике по выбранном чате
                this.setProps({ chatPaneOpen: true })
                ChatsController.selectChat(id)
                void ChatsController.getChatUsers(id)
            },
            onBack: () => {
                // Кнопка «назад» в шапке messenger (<768): возврат к списку.
                // Сбрасываем ВЫБОР в сторе, а не локальный флаг — иначе
                // повторный заход ре-дедуцирует chatPaneOpen из живого
                // selectedChat и открывает прежний чат
                // (2026-11-04-mobile-back-deselect); панель схлопывает
                // CDU-гвард в этом же store-эмите
                ChatsController.closeChatFeed()
            },
            // Живой поиск по чатам: бар дебаунсит ввод, страница только
            // прокидывает запрос контроллеру (компонент фич не импортирует)
            onSearchChats: (query: string) => {
                void ChatsController.searchChats(query)
            },
            onChatAvatar: (data: FormData) => {
                void ChatsController.changeChatAvatar(data)
            },
            // inline-переименование из шапки мессенджера: оптимистичный патч
            // и откат — в контроллере (2026-11-05-messenger-ux-pack)
            onRenameChat: (chatId: number, title: string) => {
                void ChatsController.renameChat(chatId, title)
            },
            // «+AI» из шапки мессенджера (2026-11-06-chat-create-flow):
            // оптимистичный is_ai-патч и откат — в контроллере
            onEnableAi: (chatId: number) => {
                void ChatsController.enableAi(chatId)
            },
            // «Пометить всё прочитанными» — иконка в шапке списка
            // (2026-11-05-messenger-ux-pack): активна только при непрочитанных
            onMarkAllRead: () => {
                void ChatsController.markAllRead()
            },
            onDeleteChat: (id: number) => {
                void ChatsController.delete(id)
            },
            // @-поиск для модалки добавления: контроллер ходит в GET /users
            onSearchUsers: async (login: string) => ChatsController.searchUsers(login),
            // клик по найденному пользователю добавляет его в чат
            onAddUser: async (userId: number, chatId: number) => {
                await ChatsController.addUsersToChat([userId], chatId)
            },
            onSendMessage: (chatId: number, message: string, replyToId?: number) => {
                void ChatsController.sendMessage(chatId, message, replyToId)
            },
            onSetReaction: (chatId: number, messageId: number, emoji: string) => {
                void ChatsController.setReaction(chatId, messageId, emoji)
            },
            // меню участника (2026-11-01-chat-leave): контакт — через шов
            // contacts-фичи, кик — owner-only на бэкенде, собственный выход
            // архивирует членство и сбрасывает выбор (контроллер)
            onAddContact: (userId: number) => {
                ChatsController.addContact(userId)
            },
            onKickUser: (userId: number, chatId: number) => {
                void ChatsController.removeUsersFromChat([userId], chatId)
            },
            onLeaveChat: (chatId: number) => {
                void ChatsController.leaveChat(chatId)
            },
            chats: propsFromStore.chats,
            // selectedChat обязан проброситься и при рождении: без него
            // первый стор-эмит выглядит «сменой чата» (undefined -> id) и
            // стирает память прокрутки (2026-11-02-ui-ux)
            selectedChat: propsFromStore.selectedChat,
            // лента историй из стора (мэппинг withChats): конструктор
            // перечисляет пропсы явно — stories обязана проброситься сюда,
            // иначе потеряется между withStore и Block
            stories: propsFromStore.stories ?? [],
            // матрица видимости меню участника: пробрасывается тем же
            // перечислением (иначе потерялась бы между withStore и Block)
            contactIds: propsFromStore.contactIds ?? [],
            meId: propsFromStore.meId,
            ownerId: propsFromStore.ownerId,
            events: {
                // делегированный change (см. handleStoryFileChange)
                change: (event: Event) => {
                    this.handleStoryFileChange(event)
                },
            } as unknown as Record<string, () => void>,
        })

        // снимок ленты при рождении (selectedChat проброшен выше): первый
        // стор-эмит до CDM всё равно отличит рост хвоста от prepend
        this.lastFeedSnapshot = this.feedSnapshot()
    }

    // Скролл списка чатов: перерисовки страницы (выделение выбранного и
    // пр.) пересоздают DOM списка и сбрасывают позицию. Узор как у списка
    // сообщений: модульная память + document-capture scroll-синк (событие —
    // единственный всегда-верный источник) + восстановление в кадре.
    private static usersScroll = 0
    private static usersSyncInstalled = false

    private static installUsersSync(): void {
        if (ChatPageBase.usersSyncInstalled || typeof document === 'undefined') {
            return
        }

        ChatPageBase.usersSyncInstalled = true

        document.addEventListener('scroll', (event: Event) => {
            const el = event.target as { className?: unknown, scrollTop?: number }

            if (typeof el.className !== 'string' || !el.className.includes('chat__container-users-list')) {
                return
            }

            if (typeof el.scrollTop === 'number') {
                ChatPageBase.usersScroll = el.scrollTop
            }
        }, true)
    }

    private restoreUsersScroll(): void {
        const run = () => {
            const list = this.element?.querySelector('.chat__container-users-list') as
                { scrollTop?: number } | null

            if (list != null && typeof list.scrollTop === 'number') {
                list.scrollTop = ChatPageBase.usersScroll
            }
        }

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run)
        } else {
            setTimeout(run, 0)
        }
    }

    // Фокус/каретка поиска: перерисовка страницы пересоздаёт инпут бара
    // (hbs-дети не получают CDM/CDU), поэтому восстановление принадлежит
    // странице — по статической памяти бара, в кадре после рендера
    // (узор restoreUsersScroll; review F-3)
    private restoreSearchFocus(): void {
        const { wasFocused, caret } = getChatSearchBarMemory()

        if (!wasFocused) {
            return
        }

        const run = () => {
            const input = this.element?.querySelector<HTMLInputElement>('input[name="chat_search"]')

            if (input == null) {
                return
            }

            input.focus()
            input.setSelectionRange(caret, caret)
        }

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run)
        } else {
            setTimeout(run, 0)
        }
    }

    // chat_deleted (WS): контроллер очистил selectedChat в сторе — withStore
    // принёс undefined в пропсы, панель возвращается к списку чатов.
    // Гвардия по переходу «был выбор → пропал»: панель не захлопывается,
    // пока чат ещё не выбирали (мобильный вход на страницу)
    protected componentDidUpdate(oldProps: unknown, newProps: { selectedChat?: number }) {
        this.restoreUsersScroll()
        this.restoreSearchFocus()

        // Программный селект (createAndSelect) открывает панель — симметрично
        // сбросу ниже: клик по карточке открывает её сам (onSelectChat), а
        // смена выбора извне обязана показать мессенджер и на мобиле
        // (2026-11-06-chat-create-flow); setProps идемпотентен — повторный
        // клик по выбранной карточке ничего не ломает
        if (
            newProps.selectedChat !== undefined &&
            (oldProps as { selectedChat?: number }).selectedChat !== newProps.selectedChat &&
            (this.props as { chatPaneOpen?: boolean }).chatPaneOpen !== true
        ) {
            this.setProps({ chatPaneOpen: true })
        }

        if (
            (oldProps as { selectedChat?: number }).selectedChat !== undefined &&
            newProps.selectedChat === undefined &&
            (this.props as { chatPaneOpen?: boolean }).chatPaneOpen === true
        ) {
            this.setProps({ chatPaneOpen: false })
        }

        // вьюер открыт: перерисовка заменила сфокусированный узел оверлея —
        // возвращаем фокус, иначе Escape (keydown на корне вьюера) умрёт
        if (this.pageProps.viewerStory != null) {
            this.focusViewer()
        }

        // автоскролл (решения читают СТОР — маппер страницы сообщений не
        // несёт): смена чата — память чата очищается, всегда низ; рост
        // ХВОСТА (длина выросла, голова та же — append, а не «загрузить
        // ещё») докручивает при прижатом низе или pending-плейсхолдере;
        // прочее (prepend истории, реакции, чужие перерисовки) — вернуть
        // сохранённую позицию чтения
        const chatChanged = (oldProps as { selectedChat?: number }).selectedChat !== newProps.selectedChat

        if (chatChanged) {
            if (typeof newProps.selectedChat === 'number') {
                deleteFeedScroll(newProps.selectedChat)
            }

            this.lastFeedSnapshot = this.feedSnapshot()
            this.planFeedScroll('bottom')
        } else {
            const snapshot = this.feedSnapshot()
            const previous = this.lastFeedSnapshot

            const tailGrew = snapshot != null
                && previous != null
                && previous.chatId === snapshot.chatId
                && snapshot.len > previous.len
                && previous.headId === snapshot.headId
            const memory = snapshot != null ? getFeedScroll(snapshot.chatId) : undefined
            const pinned = memory?.pinned ?? true

            if (tailGrew && (pinned || snapshot?.tailPending === true)) {
                this.planFeedScroll('bottom')
            } else {
                this.planFeedScroll('preserve')
            }
        }

        return true
    }

    // Уход с маршрута: таймер вьюера обязан умереть вместе со страницей —
    // иначе сработает по пустому инстансу после демонтирования
    destroy(): void {
        if (this.storyTimer != null) {
            clearTimeout(this.storyTimer)
            this.storyTimer = null
        }

        super.destroy()
    }

    componentDidMount() {
        ChatPageBase.installUsersSync()

        // Список чатов нужен при каждом заходе на страницу (LIVE-3): SPA-вход
        // после логина не повторяет bootstrap из main.ts. CDM диспатчится
        // Router-ом при монтировании; уход с маршрута уничтожает инстанс,
        // поэтому возврат монтирует свежий и фетч повторяется.
        void ChatsController.fetchChats()
        // бутстрап списка контактов (2026-11-01-chat-leave): слайс сегодня
        // наполняет только страница контактов, а условный пункт «Добавить в
        // контакты» нужен уже на холодном входе в /messenger — обновляем
        // при каждом заходе (инъекция contacts-фичи, review F-5)
        ChatsController.refreshContacts()
        // лента историй — так же на каждом заходе (мок-стадия убрана)
        void StoriesController.fetchStories()
        // живые кольца: глобальный stories-сокет открывается вместе с
        // лентой; идемпотентен — повторные заходы переиспользуют соединение
        StoriesController.connectStoriesSocket()

        // скролл-движок: document-capture синк модуля feed-scroll живёт
        // вечно и переживает перерисовки (прежний per-node слушатель умирал
        // вместе с узлом на первой же перерисовке — причина мёртвого
        // автоскролла); ключ чата ставится при входе и каждым планом
        installFeedScrollSync()
        setFeedScrollKey(typeof this.props.selectedChat === 'number' ? this.props.selectedChat : -1)
        this.lastFeedSnapshot = this.feedSnapshot()

        // Вход на страницу с уже выбранным чатом (возврат из /contacts по
        // openDm): CDU-перехода «смена чата» нет — первый рендер монтируется
        // сразу с историей, скроллим низ вручную
        if (this.props.selectedChat != null) {
            this.planFeedScroll('bottom')
        }
    }

    render() {
        // рендер-список историй (add-плитка + стор) подменяет сырой пропс:
        // шаблон по-прежнему итерирует stories, chat.hbs не меняется
        return this.compile(template, { ...this.props, stories: this.renderStories })
    }
}

const withChats = withStore((state: AppState) => {
    // chatSearch не объявлен в AppState — каст-идиом chatHistory
    // (history/store.ts): чтение приведением, utils/Store.ts не трогаем
    const search = (state as AppState & { chatSearch?: ChatSearchState }).chatSearch
    const allChats = (state.chats as ChatInfo[] | undefined) ?? []
    // активный запрос — только найденные чаты в порядке сервера; иначе
    // полный список по активности; ссылка на chats всегда новая — любой
    // стор-эмит (WS-патч, ответ поиска, сброс) перерисовывает список
    const chats = search != null && search.query !== ''
        ? searchOrder(allChats, search.query, search.results)
        : activityOrder(allChats)
    // контакты (2026-11-01-chat-leave): слайс contacts-фичи, ключ в
    // AppState не объявлен — тот же каст-идиом (страница контактов)
    const contacts = (state as AppState & { contacts?: ContactInfo[] }).contacts
    // владелец выбранного чата: «Удалить из чата» — только ему
    const ownerId = state.selectedChat == null
        ? undefined
        : allChats.find(chat => chat.id === state.selectedChat)?.owner_id

    return {
        chats,
        selectedChat: state.selectedChat,
        // лента историй (срез features/chats/stories) — рендер-список
        // (add-плитка + строковые id) страница строит в render()
        stories: state.stories as StoryDto[] | undefined,
        // матрица видимости меню участника
        contactIds: (contacts ?? []).map(contact => contact.id),
        meId: state.user?.id,
        ownerId,
        // есть ли непрочитанные: гейтит иконку «Пометить всё прочитанными»
        hasUnread: allChats.some(chat => chat.unread_count > 0),
    }
})

export const ChatPage = withChats(ChatPageBase as typeof Block)
