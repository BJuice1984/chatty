import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import Block, { Props } from '../core/Block.ts'
import store, { Store, StoreEvents, withStore } from './Store.ts'

const dom = new JSDOM()
global.document = dom.window.document

describe('Store', () => {
    it('should emit update when a slice changes', () => {
        const testStore = new Store()
        const handler = sinon.stub()

        testStore.on(StoreEvents.Updated, handler)
        testStore.set('selectedChat', 42)

        expect(handler.calledOnce).to.be.true
        expect(testStore.getState().selectedChat).to.eq(42)
    })

    it('should not emit update when a slice value is shallow-equal', () => {
        const testStore = new Store()
        const handler = sinon.stub()

        const user = { login: 'admin', email: 'a@b.c' }

        testStore.set('user', user)
        testStore.on(StoreEvents.Updated, handler)
        testStore.set('user', { ...user })

        expect(handler.called).to.be.false
    })

    it('should emit update when nested slice values differ', () => {
        const testStore = new Store()
        const handler = sinon.stub()

        testStore.set('user', { login: 'admin', email: 'a@b.c' })
        testStore.on(StoreEvents.Updated, handler)
        testStore.set('user', { login: 'admin', email: 'other@b.c' })

        expect(handler.calledOnce).to.be.true
    })

    it('should update typed slices with the same semantics as set', () => {
        const testStore = new Store()
        const handler = sinon.stub()

        testStore.set('selectedChat', 1)
        testStore.on(StoreEvents.Updated, handler)
        testStore.update('selectedChat', 2)

        expect(handler.calledOnce).to.be.true
        expect(testStore.getState().selectedChat).to.eq(2)
    })

    it('should not emit for a repeated typed slice value', () => {
        const testStore = new Store()
        const handler = sinon.stub()

        testStore.update('selectedChat', 7)
        testStore.on(StoreEvents.Updated, handler)
        testStore.update('selectedChat', 7)

        expect(handler.called).to.be.false
    })
})

describe('withStore', () => {
    interface CounterProps extends Props {
        selectedChat?: number
    }

    let ConnectedBlock: new (props?: Props) => Block<Props>
    let renderCounts: number[]

    before(() => {
        renderCounts = []

        class Connected extends Block<CounterProps> {
            constructor(props?: CounterProps) {
                super(props)
            }

            render() {
                renderCounts.push(1)

                const fragment = document.createDocumentFragment()
                const div = document.createElement('div')
                div.className = 'connected'
                fragment.appendChild(div)

                return fragment
            }
        }

        ConnectedBlock = withStore(state => ({ selectedChat: state.selectedChat }))(Connected as typeof Block) as new (props?: Props) => Block<Props>
    })

    it('should pass the mapped slice into props', () => {
        store.set('selectedChat', 11)

        const block = new ConnectedBlock()

        expect((block as unknown as { props: CounterProps }).props.selectedChat).to.eq(11)
        block.destroy()
    })

    it('should skip setProps for a shallow-equal state', () => {
        store.set('selectedChat', 21)

        const block = new ConnectedBlock()
        const updateSpy = sinon.spy(block as unknown as { componentDidUpdate: () => boolean }, 'componentDidUpdate')

        store.set('selectedChat', 21)

        expect(updateSpy.called).to.be.false
        block.destroy()
    })

    it('should setProps when the mapped slice changes', () => {
        store.set('selectedChat', 31)

        const block = new ConnectedBlock()

        store.set('selectedChat', 32)

        expect((block as unknown as { props: CounterProps }).props.selectedChat).to.eq(32)
        block.destroy()
    })

    it('should not update a destroyed block', () => {
        store.set('selectedChat', 41)

        const block = new ConnectedBlock()
        const updateSpy = sinon.spy(block as unknown as { componentDidUpdate: () => boolean }, 'componentDidUpdate')

        block.destroy()
        store.set('selectedChat', 42)

        expect(updateSpy.called).to.be.false
    })
})
