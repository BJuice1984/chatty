import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import Handlebars from 'handlebars'
import Block, { Props } from './Block'
import EventBus from './EventBus.ts'
import { pruneComponentCache, registerComponent } from './registerComponent.ts'
import store, { AppState, ComponentProps, withStore } from '../utils/Store.ts'

const dom = new JSDOM()
global.document = dom.window.document

interface PageProps {
    text: string
    [key: string]: unknown
}

describe('Block', () => {
    let PageClass: new (props?: Props | PageProps) => Block<Props>

    before(() => {
        class Page extends Block {
            constructor(props?: Props | PageProps) {
                super(props)
            }

            render() {
                const fragment = document.createDocumentFragment()
                const div = document.createElement('div')
                const p = document.createElement('p')
                p.id = 'test-text'
                p.innerHTML = String((this.props as unknown as PageProps)?.text)
                div.appendChild(p)
                fragment.appendChild(div)
                return fragment
            }
        }

        PageClass = Page
    })

    it('should create component with props', () => {
        const text = 'Test'
        const pageComponent = new PageClass({ text })
        const spanText = pageComponent.element?.querySelector('#test-text')?.innerHTML
        expect(spanText).to.be.eq(text)
    })

    it('should be reactive', () => {
        const text = 'new value'
        const pageComponent = new PageClass({ text: 'Hello' })
        pageComponent.setProps({ text })
        const spanText = pageComponent.element?.querySelector('#test-text')?.innerHTML
        expect(spanText).to.be.eq(text)
    })

    // Батчинг setProps (2026-11-04-bot-wait-offline): мультиключевой вызов
    // эмитит РОВНО ОДИН FLOW_CDU и делает ОДИН рендер; снапшоты до/после
    // по-прежнему доезжают до componentDidUpdate
    it('batches a multi-key setProps into exactly one FLOW_CDU and one render', () => {
        const pageComponent = new PageClass({ text: 'a', marker: 1 })
        const bus = (pageComponent as unknown as { eventBus: () => EventBus }).eventBus()
        const snapshots: { oldProps?: Record<string, unknown>, newProps?: Record<string, unknown> }[] = []
        let renders = 0

        bus.on(Block.EVENTS.FLOW_CDU, (...args: unknown[]) => {
            snapshots.push({
                oldProps: args[0] as Record<string, unknown>,
                newProps: args[1] as Record<string, unknown>,
            })
        })
        bus.on(Block.EVENTS.FLOW_RENDER, () => {
            renders += 1
        })

        pageComponent.setProps({ text: 'b', marker: 2, extra: 'c' })

        expect(snapshots).to.have.length(1)
        expect(renders).to.eq(1)
        expect(snapshots[0]?.oldProps).to.include({ text: 'a', marker: 1 })
        expect(snapshots[0]?.newProps).to.include({ text: 'b', marker: 2, extra: 'c' })

        pageComponent.destroy()
    })

    // Прямые записи через прокси сохраняют пер-ключевой эмит: батчит только
    // setProps, сет-ловушка не тронута
    it('keeps the per-key FLOW_CDU emit for direct writes through the props proxy', () => {
        const pageComponent = new PageClass({ text: 'a', marker: 1 })
        const bus = (pageComponent as unknown as { eventBus: () => EventBus }).eventBus()
        let emits = 0

        bus.on(Block.EVENTS.FLOW_CDU, () => {
            emits += 1
        })

        const props = (pageComponent as unknown as { props: Record<string, unknown> }).props

        props.text = 'b'
        props.marker = 2

        expect(emits).to.eq(2)

        pageComponent.destroy()
    })

    it('should set events', () => {
        const handlerStub = sinon.stub()
        const pageComponent = new PageClass({
            events: {
                click: handlerStub,
            },
        })
        const event = new MouseEvent('click')
        pageComponent.element?.dispatchEvent(event)
        expect(handlerStub.calledOnce).to.be.true
    })

    it('should call componentDidMount method', () => {
        const pageComponent = new PageClass()
        const componentDidMountMock = sinon.stub(pageComponent, 'componentDidMount')
        pageComponent.dispatchComponentDidMount()
        expect(componentDidMountMock.calledOnce).to.be.true
    })

    it('should stay silent on repeated dispatch for the same instance', () => {
        const pageComponent = new PageClass()
        const componentDidMountMock = sinon.stub(pageComponent, 'componentDidMount')

        pageComponent.dispatchComponentDidMount()
        pageComponent.dispatchComponentDidMount()

        expect(componentDidMountMock.calledOnce).to.be.true
    })

    it('should dispatch componentDidMount into both children and hbs-embedded children (dispatch ↔ destroy symmetry)', () => {
        // Инвариант симметрии: dispatch обязан обойти ТО ЖЕ множество детей,
        // что и destroy() — this.children + _hbsChildren (захват compile()).
        const instances: Block[] = []

        class EmbeddedBase extends Block {
            // eslint-disable-next-line no-unused-vars
            constructor(props?: Props) {
                super(props)

                instances.push(this)
            }

            render() {
                const fragment = document.createDocumentFragment()
                const div = document.createElement('div')
                div.className = 'embedded-cdm-child'
                fragment.appendChild(div)
                return fragment
            }
        }

        registerComponent('TestHbsCdmChild', EmbeddedBase as typeof Block)

        class ParentPage extends Block {
            render() {
                return this.compile(Handlebars.compile('<section>{{{ TestHbsCdmChild }}}</section>'), {})
            }
        }

        const regularChild = new PageClass({ text: 'child' })
        const parent = new ParentPage({ child: regularChild })

        const embeddedChild = instances[instances.length - 1]

        const regularChildCdm = sinon.stub(regularChild, 'componentDidMount')
        const embeddedChildCdm = sinon.stub(embeddedChild, 'componentDidMount')

        parent.dispatchComponentDidMount()

        expect(regularChildCdm.calledOnce).to.be.true
        expect(embeddedChildCdm.calledOnce).to.be.true

        // Повторный dispatch на дереве молчит целиком: полный short-circuit
        // у родителя, собственные флаги у детей.
        parent.dispatchComponentDidMount()

        expect(regularChildCdm.calledOnce).to.be.true
        expect(embeddedChildCdm.calledOnce).to.be.true

        parent.destroy()
    })

    it('should remove element from DOM and detach events on destroy', () => {
        const handlerStub = sinon.stub()
        const pageComponent = new PageClass({
            events: {
                click: handlerStub,
            },
        })
        const container = document.createElement('div')
        const element = pageComponent.element!

        container.appendChild(element)

        element.dispatchEvent(new MouseEvent('click'))
        expect(handlerStub.calledOnce).to.be.true

        pageComponent.destroy()

        expect(container.childElementCount).to.eq(0)
        expect(pageComponent.element).to.be.null

        element.dispatchEvent(new MouseEvent('click'))
        expect(handlerStub.calledOnce).to.be.true
    })

    it('should unsubscribe lifecycle events on destroy', () => {
        const pageComponent = new PageClass()
        const componentDidMountMock = sinon.stub(pageComponent, 'componentDidMount')

        pageComponent.destroy()
        pageComponent.dispatchComponentDidMount()

        expect(componentDidMountMock.called).to.be.false
    })

    it('should destroy children recursively', () => {
        const child = new PageClass({ text: 'child' })
        const parent = new PageClass({ text: 'parent' })

        parent.children['child'] = child

        const childDestroySpy = sinon.spy(child, 'destroy')

        parent.destroy()

        expect(childDestroySpy.calledOnce).to.be.true
    })

    it('should be idempotent on repeated destroy', () => {
        const pageComponent = new PageClass()
        const removeSpy = sinon.spy(pageComponent.element!, 'remove')

        pageComponent.destroy()
        pageComponent.destroy()

        expect(removeSpy.calledOnce).to.be.true
    })

    it('should destroy handlebars-embedded children and unsubscribe their withStore wrapper', () => {
        // Идиома «should not update a destroyed block» (Store.test.ts):
        // ребёнок, встроенный в .hbs хелпером registerComponent (как
        // Messenger в chat.hbs), раньше не уничтожался — withStore-подписка
        // текла при уходе с маршрута.
        const instances: Block[] = []

        class EmbeddedBase extends Block {
            constructor(props?: Props) {
                super(props)

                instances.push(this)
            }

            render() {
                const fragment = document.createDocumentFragment()
                const div = document.createElement('div')

                div.className = 'embedded-child'
                fragment.appendChild(div)

                return fragment
            }
        }

        const Embedded = withStore(
            // eslint-disable-next-line no-unused-vars
            ((state: AppState) => ({ selectedChat: state.selectedChat })) as unknown as (state: AppState) => ComponentProps
        )(EmbeddedBase as typeof Block)

        registerComponent('TestHbsEmbeddedChild', Embedded as typeof Block)

        class ParentPage extends Block {
            render() {
                return this.compile(Handlebars.compile('<section>{{{ TestHbsEmbeddedChild }}}</section>'), {})
            }
        }

        const parent = new ParentPage()

        expect(instances).to.have.length(1)
        expect(parent.element?.querySelector('.embedded-child')).to.exist

        const child = instances[instances.length - 1]
        const updateSpy = sinon.spy(
            child as unknown as { componentDidUpdate: () => boolean },
            'componentDidUpdate'
        )

        parent.destroy()

        // После destroy родителя ребёнок отписан: обновления Store его больше
        // не перерисовывают, элемент снят.
        store.set('selectedChat', 77)

        expect(updateSpy.called).to.be.false
        expect(child.element).to.be.null
    })

    // Смета заменённых hbs-детей (2026-11-04-bot-wait-offline): перерендер
    // родителя уничтожает ребёнка, выпавший из нового списка (withStore-
    // подписка снята — счётчик слушателей стора вернулся к baseline), ребёнок
    // в новом списке — построен и жив
    it('destroys hbs-children absent from the new render list, unsubscribing their store wrapper', () => {
        const sweptInstances: Block[] = []

        class SweptBase extends Block {
            // eslint-disable-next-line no-unused-vars
            constructor(props?: Props) {
                super(props)

                sweptInstances.push(this)
            }

            render() {
                const fragment = document.createDocumentFragment()
                const div = document.createElement('div')

                div.className = 'swept-child'
                fragment.appendChild(div)

                return fragment
            }
        }

        const Swept = withStore(
            ((state: AppState) => ({ selectedChat: state.selectedChat })) as unknown as (state: AppState) => ComponentProps
        )(SweptBase as typeof Block)

        registerComponent('TestSweptChild', Swept as typeof Block)

        let steadyCount = 0

        class SteadyChild extends Block {
            // eslint-disable-next-line no-unused-vars
            constructor(props?: Props) {
                super(props)

                steadyCount += 1
            }

            render() {
                const fragment = document.createDocumentFragment()
                const div = document.createElement('div')

                div.className = 'steady-child'
                fragment.appendChild(div)

                return fragment
            }
        }

        registerComponent('TestSteadyChild', SteadyChild as typeof Block)

        const tpl = Handlebars.compile(
            '<div>{{#if showChild}}<span>{{{ TestSweptChild }}}</span>{{/if}}<span>{{{ TestSteadyChild }}}</span></div>'
        )

        class SweeperPage extends Block {
            render() {
                return this.compile(tpl, { showChild: (this.props as { showChild?: boolean }).showChild === true })
            }
        }

        const storeListeners = () =>
            (store as unknown as { listeners: Record<string, (() => void)[] | undefined> }).listeners.updated?.length ?? 0
        const baseline = storeListeners()
        const parent = new SweeperPage({ showChild: true })

        expect(sweptInstances).to.have.length(1)
        expect(storeListeners(), 'withStore-подписка ребёнка добавлена').to.eq(baseline + 1)
        expect(steadyCount).to.eq(1)

        parent.setProps({ showChild: false })

        // Ушедший из списка ребёнок уничтожен: подписка снята, элемент снят
        expect(storeListeners(), 'подписка withStore снята сметой compile').to.eq(baseline)
        expect((sweptInstances[0] as unknown as { element: HTMLElement | null }).element).to.be.null

        // Присутствующий в новом списке ребёнок жив: построен заново и стоит в DOM
        expect(steadyCount).to.eq(2)
        expect(parent.element?.querySelector('.steady-child')).to.exist

        parent.destroy()
    })

    // Review F-2: cache-retained инстанс переживает И смету compile, И полный
    // destroy() родителя, а его элемент переезжает в DOM нового родителя;
    // умирает такой инстанс только через prune кэша
    it('keeps a cache-retained child alive through the compile sweep AND a full parent destroy', () => {
        const retainedInstances: Block[] = []

        class RetainedBase extends Block {
            // eslint-disable-next-line no-unused-vars
            constructor(props?: Props) {
                super(props)

                retainedInstances.push(this)
            }

            render() {
                const fragment = document.createDocumentFragment()
                const div = document.createElement('div')

                div.className = 'retained-child'
                fragment.appendChild(div)

                return fragment
            }
        }

        registerComponent('TestRetainedChild', RetainedBase as typeof Block)

        const tpl = Handlebars.compile('{{#if showChild}}<span>{{{ TestRetainedChild cacheKey="f2-key" }}}</span>{{/if}}')

        class RetainerPage extends Block {
            render() {
                return this.compile(tpl, { showChild: (this.props as { showChild?: boolean }).showChild === true })
            }
        }

        const first = new RetainerPage({ showChild: true })

        expect(retainedInstances).to.have.length(1)

        const retained = retainedInstances[retainedInstances.length - 1]

        // Смета compile: ребёнок выпал из нового списка — но retained,
        // уничтожения нет
        first.setProps({ showChild: false })

        expect((retained as unknown as { element: HTMLElement | null }).element).to.not.be.null

        // Полный destroy родителя: retained-ребёнок не тронут — жизнью владеет
        // кэш (prune), а не родитель
        first.destroy()

        expect((retained as unknown as { element: HTMLElement | null }).element).to.not.be.null

        // Новый родитель с тем же ключом переиспользует инстанс (тот же
        // component.id, построения не было) и переносит его элемент в свой DOM
        const second = new RetainerPage({ showChild: true })

        expect(retainedInstances).to.have.length(1)
        expect(second.element?.contains((retained as unknown as { element: HTMLElement }).element)).to.be.true

        second.destroy()

        // Retained-инстанс умирает ТОЛЬКО через prune кэша
        pruneComponentCache(new Set())

        expect((retained as unknown as { element: HTMLElement | null }).element).to.be.null
    })
})
