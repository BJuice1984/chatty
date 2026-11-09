import { set } from '../helpers/helpers.ts'
import EventBus from '../core/EventBus.ts'
import Block from '../core/Block.ts'
import type { ChatUser, Message } from './types.ts'


export enum StoreEvents {
    // eslint-disable-next-line no-unused-vars
    Updated = 'updated'
}

export interface AppState {
    chatUsers?: ChatUser[] | undefined
    selectedChat?: number
    // лента историй: тип живёт в фичевом модуле (features/chats/stories),
    // ядро остаётся shape-agnostic — как у chats; каст в срезе модуля
    stories?: { [key: string]: unknown }[]
    messages?: Record<number, Message[]>
    // человекочитаемая ошибка последнего запроса авторизации (сеть/бэкенд):
    // контроллер auth пишет, страницы входа/регистрации показывают под формой
    authError?: string | null
    // запрос авторизации в полёте (2026-11-07-auth-session-ux): страницы
    // входа/регистрации блокируют submit-кнопку и меняют её лейбл; поле
    // только отражает состояние — механики стора не меняются
    authLoading?: boolean
    // Пользователь (2026-11-01-settings): display_name/phone несут РЕАЛЬНЫЕ
    // значения бэкенда (адаптеры фич применяют фолбэки «локальная часть
    // email»/'' для NULL — синтеза display_name=email больше нет),
    // send_read_receipts — серверный флаг «отправлять отчёты о прочтении»
    // (тумблер приватности). Поля обязательны: оба слайса (auth/profile)
    // читают стор в форму AuthUser/ProfileUser
    user?: {
        display_name: string
        first_name: string
        second_name: string
        email: string
        login: string
        phone: string
        id: number
        avatar: string
        send_read_receipts: boolean
    }
    chats?: {
        [key: string]: unknown
    }[]
    // первичная загрузка списка чатов (2026-11-07-messenger-ux-pack-2):
    // страницы показывают лоадер вместо пустого списка; поле только
    // отражает состояние — механика стора не меняется
    chatsLoading?: boolean
}

export interface ComponentProps {
    selectedChat?: number
    selectedChatUsers?: ChatUser[]
    messages?: Message[]
    authError?: string | null
    authLoading?: boolean
    user?: {
        first_name?: string
        second_name?: string
        email?: string
        login?: string
        phone?: string
        display_name?: string
        avatar?: string
    }
    chats?: {
        [key: string]: unknown
    }[]
}

export function shallowEqual<T>(lhs: T, rhs: T): boolean {
    if (lhs === rhs) {
        return true
    }

    if (typeof lhs !== 'object' || lhs === null ||
        typeof rhs !== 'object' || rhs === null) {
        return false
    }

    const lhsKeys = Object.keys(lhs)
    const rhsKeys = Object.keys(rhs)

    if (lhsKeys.length !== rhsKeys.length) {
        return false
    }

    return lhsKeys.every(key =>
        (lhs as Record<string, unknown>)[key] === (rhs as Record<string, unknown>)[key]
    )
}

function getSlice(state: AppState, keypath: string): unknown {
    return keypath.split('.').reduce<unknown>((acc, key) => {
        if (typeof acc !== 'object' || acc === null) {
            return undefined
        }

        return (acc as Record<string, unknown>)[key]
    }, state)
}

export class Store extends EventBus {
    private state: AppState = {}

    public set(keypath: string, data: unknown) {
        const previous = getSlice(this.state, keypath)
        const isObject = typeof previous === 'object' && previous !== null

        // Снимок-строка до мержа (JSON безопасен для значений с функциями —
        // structuredClone бросал на chatUsers с onClick, из-за чего стор
        // вечно держал участников первого чата): helpers.set мутирует
        // предыдущее значение, поэтому сравнение ведём по строке-снапшоту,
        // снятому ДО мержа (LIVE-5).
        const previousSnapshot = isObject ? JSON.stringify(previous) : previous

        set(this.state, keypath, data)

        const changed = isObject
            ? previousSnapshot !== JSON.stringify(getSlice(this.state, keypath))
            : !shallowEqual(previousSnapshot, data)

        if (!changed) {
            return
        }

        this.emit(StoreEvents.Updated, this.getState())
    }

    public update<K extends keyof AppState>(slice: K, data: AppState[K]) {
        this.set(slice, data)
    }

    // Полный сброс состояния (backlog NEXT.md п.2/п.10, 2026-11-09): выход
    // из аккаунта раньше сбрасывал только user — selectedChat, messages,
    // chats, chatUsers, stories и contacts переживали смену аккаунта, и
    // лента предыдущего пользователя была достижима следующему. reset
    // восстанавливает пустое состояние и эмитит Updated: каждый
    // withStore-подписчик перерисуется с пустыми слайсами — единственный
    // честный смысл reset в том, что ЭМИТ обязателен, иначе подписчики
    // останутся жить с последними спроецированными пропсами.
    public reset() {
        this.state = {}
        this.emit(StoreEvents.Updated, this.getState())
    }

    public getState() {
        return this.state
    }
}

const store = new Store()
// window.store = store

// eslint-disable-next-line no-unused-vars
export function withStore(mapStateToProps: (state: AppState) => ComponentProps) {
    return function wrap(Component: typeof Block) {
        return class WithStore extends Component {
            private readonly storeHandler: () => void
            private previousState: ComponentProps

            constructor(props: ComponentProps) {
                const initialState = mapStateToProps(store.getState())

                super({ ...props, ...initialState })

                this.previousState = initialState

                this.storeHandler = () => {
                    const stateProps = mapStateToProps(store.getState())

                    if (shallowEqual(stateProps, this.previousState)) {
                        return
                    }

                    this.previousState = stateProps

                    this.setProps({ ...stateProps })
                }

                store.on(StoreEvents.Updated, this.storeHandler)
            }

            destroy() {
                store.off(StoreEvents.Updated, this.storeHandler)

                super.destroy()
            }
        }
    }
}

export default store
