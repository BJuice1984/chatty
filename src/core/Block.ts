import isEqual from '../helpers/isEqual.ts'
import EventBus from './EventBus.ts'
import { nanoid } from 'nanoid'

export interface Props {
    events?: Record<string, () => void>
    [key: string]: unknown
}

interface WithChildren {
    // eslint-disable-next-line no-unused-vars
    __children?: { embed: (content: DocumentFragment) => void }[]
}

class Block<T extends Props = Props> {
    static EVENTS = {
        INIT: 'init',
        FLOW_CDM: 'flow:component-did-mount',
        FLOW_CDU: 'flow:component-did-update',
        FLOW_RENDER: 'flow:render',
    }

    public id = nanoid(6)
    protected props: T
    protected refs: Record<string, Block> = {}
    public children: Record<string, Block>
    private eventBus: () => EventBus
    private _element: HTMLElement | null = null
    private _destroyed = false
    // eslint-disable-next-line no-unused-vars
    private _lifecycleHandlers: Array<[string, (...args: unknown[]) => void]> = []
    // private _meta: { props: Props }

    constructor(propsWithChildren: T = {} as T) {
        const eventBus = new EventBus()

        const { children } = this._getChildrenAndProps(propsWithChildren)

        // this._meta = {
        //     props,
        // }

        this.children = children
        this.props = this._makePropsProxy(propsWithChildren)

        this.eventBus = () => eventBus

        this._registerEvents(eventBus)

        eventBus.emit(Block.EVENTS.INIT)
    }

    getValue?(): string

    // eslint-disable-next-line no-unused-vars
    setValue?(value: string): void

    private _getChildrenAndProps<U extends Record<string, unknown>>(
        childrenAndProps: U
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): { props: Record<string, unknown>; children: Record<string, Block<any>> } {
        const props: Record<string, unknown> = {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const children: Record<string, Block<any>> = {}

        // Проверка, что childrenAndProps - это объект с строковыми ключами
        if (typeof childrenAndProps === 'object' && childrenAndProps !== null) {
            Object.entries(childrenAndProps).forEach(([key, value]) => {
                if (value instanceof Block) {
                    children[key] = value
                } else {
                    props[key] = value
                }
            })
        } else {
            // Обработка случая, когда childrenAndProps не является объектом
            console.error('Invalid childrenAndProps:', childrenAndProps)
        }

        return { props, children }
    }

    _addEvents() {
        const { events = {} } = this.props as Props

        Object.keys(events).forEach(eventName => {
            this._element?.addEventListener(eventName, events[eventName])
        })
    }

    _removeEvents() {
        const { events = {} } = this.props as Props

        Object.keys(events).forEach(eventName => {
            this._element?.removeEventListener(eventName, events[eventName])
        })
    }

    _registerEvents(eventBus: EventBus) {
        this._lifecycleHandlers = [
            [Block.EVENTS.INIT, this._init.bind(this)],
            [Block.EVENTS.FLOW_CDM, this._componentDidMount.bind(this)],
            [Block.EVENTS.FLOW_CDU, (...args: unknown[]) => {
                const [oldProps, newProps] = args as [Props, Props]

                this._componentDidUpdate(oldProps, newProps)
            }],
            [Block.EVENTS.FLOW_RENDER, this._render.bind(this)],
        ]

        this._lifecycleHandlers.forEach(([event, handler]) => {
            eventBus.on(event, handler)
        })
    }

    private _init() {
        this.init()

        this.eventBus().emit(Block.EVENTS.FLOW_RENDER)
    }

    protected init() {}

    _componentDidMount() {
        this.componentDidMount()
    }

    componentDidMount() {}

    public dispatchComponentDidMount() {
        this.eventBus().emit(Block.EVENTS.FLOW_CDM)

        Object.values(this.children).forEach(child => child.dispatchComponentDidMount())
    }

    private _componentDidUpdate(oldProps: Props, newProps: Props) {
        if (this.componentDidUpdate(oldProps, newProps)) {
            this._removeEvents()
            this.eventBus().emit(Block.EVENTS.FLOW_RENDER)
            this._addEvents()
        }
    }

    protected componentDidUpdate(oldProps: Props, newProps: Props) {
        isEqual(oldProps, newProps)

        return true
    }

    setProps = (nextProps: Props) => {
        if (nextProps === undefined || nextProps === null) {
            return
        }

        // this.props = { ...this.props, ...(nextProps as object) }
        Object.assign(this.props, nextProps)
    }

    destroy() {
        if (this._destroyed) {
            return
        }

        this._destroyed = true

        Object.values(this.children).forEach(child => child.destroy())

        this._removeEvents()

        this._lifecycleHandlers.forEach(([event, handler]) => {
            this.eventBus().off(event, handler)
        })

        this._element?.remove()
        this._element = null
    }

    get element() {
        return this._element
    }

    private _render() {
        const fragment = this.render()

        const newElement = fragment.firstElementChild as HTMLElement

        if (this._element) {
            this._element.replaceWith(newElement)
        }

        this._element = newElement

        this._addEvents()
    }

    protected compile(
        // eslint-disable-next-line no-unused-vars
        template: (context: Record<string, unknown>) => string,
        context: Record<string, unknown>
    ) {
        const contextAndStubs: Record<string, unknown> & WithChildren = {
            ...context,
            __refs: this.refs,
        }

        const html = template(contextAndStubs)

        const temp = document.createElement('template')

        temp.innerHTML = html

        if (contextAndStubs.__children && Array.isArray(contextAndStubs.__children)) {
            contextAndStubs.__children.forEach(({ embed }) => {
                embed(temp.content)
            })
        }

        return temp.content
    }

    protected render(): DocumentFragment {
        return new DocumentFragment()
    }

    getContent() {
        return this.element
    }

    _makePropsProxy(props: T): T {
        return new Proxy(props, {
            get: (target, prop) => {
                const value: unknown = target[prop as keyof T]

                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                return typeof value === 'function' ? value.bind(target) : value
            },
            set: (target, prop, value: T[keyof T]) => {
                const oldTarget = { ...target }

                target[prop as keyof T] = value
                this.eventBus().emit(Block.EVENTS.FLOW_CDU, oldTarget, target)

                return true
            },
            deleteProperty: () => {
                throw new Error('Нет доступа')
            },
        })
    }

    // _createDocumentElement(tagName: string) {
    //     // Можно сделать метод, который через фрагменты в цикле создаёт сразу несколько блоков
    //     return document.createElement(tagName)
    // }

    // show() {
    //     this.getContent()!.style.display = 'block'
    // }

    // hide() {
    //     this.getContent()!.style.display = 'none'
    // }
}

export default Block
