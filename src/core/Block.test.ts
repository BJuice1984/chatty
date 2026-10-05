import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import Block, { Props } from './Block'

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

    it('should remove element from DOM and detach events on destroy', () => {
        const handlerStub = sinon.stub()
        const pageComponent = new PageClass({
            events: {
                click: handlerStub,
            },
        })
        const container = document.createElement('div')
        container.appendChild(pageComponent.element!)

        expect(container.contains(pageComponent.element!)).to.be.true

        pageComponent.destroy()

        expect(container.childElementCount).to.eq(0)
        expect(pageComponent.element).to.be.null

        const detachedEvent = new MouseEvent('click')
        handlerStub.resetHistory()
        document.dispatchEvent(detachedEvent)
        expect(handlerStub.called).to.be.false
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
})
