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
import { AppState, withStore } from '../../../../utils/Store.ts'
import type { ChatInfo, ChatSearchMatch, ContactInfo } from '../../../../utils/types.ts'
import { emptyValidationMessage } from '../../../../utils/constants.ts'
import { emptyValidator } from '../../../../utils/validators.ts'
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
}

// Карточка списка чатов в пропсах страницы: ChatInfo + декорации
// активного поиска (части подсветки и время последнего совпадения)
interface OrderedChat extends ChatInfo {
    titleParts?: { before: string, match: string, after: string } | null
    snippetParts?: { before: string, match: string, after: string } | null
    searchTime?: string
}

// Порядок пустого запроса — по активности: свежий last_message сверху,
// отсутствующий/битый (NaN) тонет ниже всех дат, ничья — id DESC.
// Всегда новый массив: мэппер withStore обязан давать свежую ссылку на
// chats, иначе shallowEqual погасит перерисовку на любом стор-эмите
function activityOrder(chats: ChatInfo[]): ChatInfo[] {
    const timeOf = (chat: ChatInfo): number => {
        const raw = chat.last_message?.time
        const parsed = raw != null ? Date.parse(raw) : Number.NaN

        return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
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
    // Дочерние Messenger-инстансы пересоздаются перерисовкой (семантика
    // stage 14 — CDM только на дереве момента монтирования), поэтому
    // автоскролл списка сообщений живёт здесь: инстанс страницы стабилен.
    // При открытии чата показываем последние сообщения; новые докручивают
    // список, только если читали низ.
    private pinnedToBottom = true

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
    // клика. Селектор точечный по классу: первый input[type=file] в DOM —
    // скрытый аватарный инпут первого чата списка
    private openStoryPicker(): void {
        const input = this.element?.querySelector<HTMLInputElement>('input.chat-story-file-input')

        input?.click()
    }

    // Перерисовка дочернего Messenger пересоздаёт DOM списка и сбрасывает
    // scrollTop. После рендера: если читали низ — докручиваем (или едем в
    // низ при смене чата), иначе восстанавливаем сохранённую позицию —
    // иначе любая реакция/ре-рендер отбрасывает чтение истории наверх.
    private restoreMessagesScroll(toBottom: boolean): void {
        const before = this.element?.querySelector('.messenger__container') as
            { scrollTop?: number } | undefined
        const saved = before != null && typeof before.scrollTop === 'number' ? before.scrollTop : 0

        const run = () => {
            const container = this.element?.querySelector('.messenger__container') as
                { scrollTop?: number, scrollHeight?: number } | null

            // утиная проверка: jsdom-тесты не дают HTMLElement; элемента
            // может не быть вовсе (изолированные тесты)
            if (container != null && typeof container.scrollHeight === 'number') {
                container.scrollTop = toBottom ? container.scrollHeight : saved
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
                this.refs.create.setProps({ isShown: true })
            },
            onSelectChat: (id: number) => {
                // Любой выбор чата открывает панель — chatListUser стреляет
                // onSelect и на повторном клике по выбранном чате
                this.setProps({ chatPaneOpen: true })
                ChatsController.selectChat(id)
                void ChatsController.getChatUsers(id)
            },
            onBack: () => {
                // Кнопка «назад» в шапке messenger (<768): возврат к списку
                this.setProps({ chatPaneOpen: false })
            },
            // Живой поиск по чатам: бар дебаунсит ввод, страница только
            // прокидывает запрос контроллеру (компонент фич не импортирует)
            onSearchChats: (query: string) => {
                void ChatsController.searchChats(query)
            },
            onChatAvatar: (data: FormData) => {
                void ChatsController.changeChatAvatar(data)
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
            inputs: [
                {
                    label: 'type chat name',
                    name: 'title',
                    validate: emptyValidator,
                    validateMessage: emptyValidationMessage,
                },
            ],
            buttons: [
                {
                    label: 'Create',
                    classType: 'hidden',
                    type: 'submit',
                    handleSubmitClick: (value: { title: string }) => {
                        void ChatsController.create(value)
                    },
                },
            ],
            chats: propsFromStore.chats,
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
    protected componentDidUpdate(oldProps: unknown, newProps: { selectedChat?: number, messages?: unknown[] }) {
        this.restoreUsersScroll()
        this.restoreSearchFocus()

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

        // автоскролл: смена чата — всегда вниз; рост сообщений — только если
        // читали низ (pinnedToBottom обновляется scroll-слушателем из CDM)
        const chatChanged = (oldProps as { selectedChat?: number }).selectedChat !== newProps.selectedChat
        const oldLen = ((oldProps as { messages?: unknown[] }).messages ?? []).length
        const newLen = (newProps.messages ?? []).length

        if (chatChanged) {
            this.pinnedToBottom = true
            this.restoreMessagesScroll(true)
        } else if (newLen > oldLen && this.pinnedToBottom) {
            this.restoreMessagesScroll(true)
        } else {
            // перерисовка без роста (реакция, реплай-черновик): вернуть
            // читаемую позицию, сброшенную пересозданием DOM списка
            this.restoreMessagesScroll(false)
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

        // scroll не всплывает — слушаем контейнер сообщений напрямую; узел
        // умирает вместе с инстансом, утечки нет
        const container = this.element?.querySelector('.messenger__container')

        container?.addEventListener('scroll', () => {
            const el = container as { scrollHeight?: number, scrollTop?: number, clientHeight?: number }

            if (typeof el.scrollHeight === 'number') {
                this.pinnedToBottom = el.scrollHeight - (el.scrollTop ?? 0) - (el.clientHeight ?? 0) < 120
            }
        })
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
    }
})

export const ChatPage = withChats(ChatPageBase as typeof Block)
