import isEqual from '../helpers/isEqual.ts'
import EventBus from './EventBus.ts'
import { nanoid } from 'nanoid'

export interface Props {
    events?: Record<string, () => void>
    [key: string]: unknown
}

// Retained-метка (2026-11-04-bot-wait-offline, механика keyed-кэша
// registerComponent): помеченный инстанс НЕ уничтожается ни сметой
// compile() (замена _hbsChildren), ни destroy() родителя — его временем
// жизни владеет фичевый кэш через prune. Ядро не знает о фичах: метка —
// WeakSet в core, ставит registerComponent при кэш-регистрации.
const retainedBlocks = new WeakSet<object>()

// Помечает инстанс как cache-retained (владелец метки управляет жизнью)
export function markBlockRetained(block: Block): void {
    retainedBlocks.add(block)
}

// retained-проверка для compile-сметы и destroy() родителя
export function isBlockRetained(block: Block): boolean {
    return retainedBlocks.has(block)
}

interface WithChildren {
    __children?: {
        component?: Block
        // eslint-disable-next-line no-unused-vars
        embed: (content: DocumentFragment) => void
    }[]
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
    // Исходный объект пропсов под прокси: setProps пишет сюда МИМО
    // сет-ловушки и эмитит ОДИН FLOW_CDU на вызов (батчинг,
    // 2026-11-04-bot-wait-offline); пер-ключевой эмит остаётся только у
    // прямых записей this.props.x = ... через прокси
    private _rawProps: T
    protected refs: Record<string, Block> = {}
    public children: Record<string, Block>
    private eventBus: () => EventBus
    private _element: HTMLElement | null = null
    private _destroyed = false
    // CDM-флаг на инстанс (stage block-cdm): повторный dispatch полностью
    // замолкает — CDM срабатывает ровно один раз за жизнь инстанса.
    // В destroy() НЕ сбрасывается: уничтожённый инстанс и так молчит —
    // destroy() снимает lifecycle-обработчики с EventBus.
    private _cdmDispatched = false
    // Компоненты, встроенные в шаблон хелперами registerComponent (stage 11):
    // захват при compile() — destroy() обязан уничтожать и их, иначе
    // withStore-обёртки течут подписками на Store при уходе с маршрута.
    private _hbsChildren: Block[] = []
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
        this._rawProps = propsWithChildren
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
        // Полный short-circuit: при повторном заходе не спускаемся к детям —
        // каждый узел дерева защищён собственным флагом.
        if (this._cdmDispatched) {
            return
        }

        this._cdmDispatched = true

        this.eventBus().emit(Block.EVENTS.FLOW_CDM)

        // Инвариант симметрии dispatch ↔ destroy: обходим ТО ЖЕ множество
        // детей, что и destroy() — this.children плюс компоненты, встроенные
        // в .hbs-шаблон хелперами registerComponent (захват при compile()).
        Object.values(this.children).forEach(child => child.dispatchComponentDidMount())
        this._hbsChildren.forEach(child => child.dispatchComponentDidMount())
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

        // Батчинг (2026-11-04-bot-wait-offline): запись идёт в RAW-объект
        // МИМО прокси-сеттера, затем ОДИН FLOW_CDU на вызов со снапшотами
        // до/после. Прямые записи this.props.x = ... сохраняют пер-ключевой
        // эмит (сет-ловушка ниже не тронута); порядок жизненного цикла и
        // контракт componentDidUpdate(old, new) не меняются — падает только
        // число эмитов с N-ключей до одного на вызов.
        const oldProps = { ...this._rawProps }

        Object.assign(this._rawProps, nextProps)
        this.eventBus().emit(Block.EVENTS.FLOW_CDU, oldProps, this._rawProps)
    }

    destroy() {
        if (this._destroyed) {
            return
        }

        this._destroyed = true

        Object.values(this.children).forEach(child => child.destroy())

        // hbs-встроенные дети (customData.root.__children у registerComponent)
        // дискретны от this.children — уничтожаем отдельно. Двойное уничтожение
        // исключено: _destroyed-флаг у каждого ребёнка свой. Исключение —
        // cache-retained инстансы (review F-2): их не трогаем НИКОГДА, жизнью
        // владеет фичевый кэш через prune — иначе destroy родителя ронял бы
        // Message-инстансы, которые новый рендер только что переиспользовал.
        this._hbsChildren.forEach(child => {
            if (!isBlockRetained(child)) {
                child.destroy()
            }
        })
        this._hbsChildren = []

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

        // Дети нового рендера: пустой список, если хелперы не звались вовсе
        // (условные ветки шаблона) — смета ниже обязана увидеть и этот случай
        const nextChildren = contextAndStubs.__children && Array.isArray(contextAndStubs.__children)
            ? contextAndStubs.__children
                .map(({ component }) => component)
                .filter((child): child is Block => child != null)
            : []

        // Смета заменённых детей (2026-11-04-bot-wait-offline): записи
        // СТАРОГО списка, отсутствующие в НОВОМ по ссылке на инстанс,
        // уничтожаются — брошенные withStore-обёртки больше не текут
        // подписками на каждый перерендер родителя. Исключение —
        // cache-retained инстансы: их владеет фичевый кэш (prune).
        this._hbsChildren.forEach(child => {
            if (!nextChildren.includes(child) && !isBlockRetained(child)) {
                child.destroy()
            }
        })

        // Захват встроенных детей текущего рендера: их embed-функции
        // кладут DOM, а component нужен destroy() (см. destroy()).
        this._hbsChildren = nextChildren

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
