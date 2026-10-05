import { set } from '../helpers/helpers.ts'
import EventBus from '../core/EventBus.ts'
import Block from '../core/Block.ts'
import { Message } from '../controllers/MessagesController.ts'
import { ChatUser } from '../api/ChatsApi.ts'


export enum StoreEvents {
    // eslint-disable-next-line no-unused-vars
    Updated = 'updated'
}

export interface AppState {
    chatUsers?: ChatUser[] | undefined
    selectedChat?: number
    messages?: Record<number, Message[]>
    user?: {
        display_name: string
        first_name: string
        second_name: string
        email: string
        login: string
        phone: string
        id: number
        avatar: string
    }
    chats?: {
        [key: string]: unknown
    }[]
}

export interface ComponentProps {
    selectedChat?: number
    selectedChatUsers?: ChatUser[]
    messages?: Message[]
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

        // helpers.set мутирует вложенные объекты, поэтому сравниваем с копией
        const previousSnapshot = typeof previous === 'object' && previous !== null
            ? { ...previous as Record<string, unknown> }
            : previous

        set(this.state, keypath, data)

        if (shallowEqual(previousSnapshot, data)) {
            return
        }

        this.emit(StoreEvents.Updated, this.getState())
    }

    public update<K extends keyof AppState>(slice: K, data: AppState[K]) {
        this.set(slice, data)
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
