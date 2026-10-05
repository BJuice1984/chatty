import { expect } from 'chai'
import sinon from 'sinon'
import Router from './Router'
import Block, { Props } from '../core/Block'

function markerBlock(marker: string) {
    return class MarkerComponent extends Block {
        // eslint-disable-next-line no-unused-vars
        constructor(props?: Props) {
            super(props)
        }

        render() {
            const fragment = document.createDocumentFragment()
            const div = document.createElement('div')
            const p = document.createElement('p')
            p.id = marker
            p.textContent = String(this.props?.routeParams ? JSON.stringify(this.props.routeParams) : marker)
            div.appendChild(p)
            fragment.appendChild(div)
            return fragment
        }
    }
}

describe('Router test', () => {
    let TestBlock: new (props?: Props) => Block<Props>
    let appElement: HTMLElement

    before(() => {
        appElement = document.createElement('div')
        appElement.id = 'app'
        document.body.appendChild(appElement)

        class TestComponent extends Block {
            constructor(props?: Props) {
                super(props)
            }

            render() {
                const fragment = document.createDocumentFragment()
                const div = document.createElement('div')
                const p = document.createElement('p')
                p.id = 'test-text'
                p.innerHTML = String(this.props?.text)
                div.appendChild(p)
                fragment.appendChild(div)
                return fragment
            }
        }
        TestBlock = TestComponent
    })

    afterEach(() => {
        window.history.pushState(null, '', '/')
        appElement.innerHTML = ''
    })

    after(() => {
        appElement.remove()
    })

    it('should navigate between routes', () => {
        Router.use('/test', TestBlock as typeof Block)
        Router.go('/test')
        expect(window.history.length).to.eq(2)
        expect(window.location.pathname).to.eq('/test')
    })

    it('should go back', () => {
        Router.use('/test', TestBlock as typeof Block)
        Router.go('/')
        Router.go('/test')
        Router.back()
        expect(window.location.pathname).to.eq('/test')
    })

    it('should go forward', () => {
        Router.use('/test', TestBlock as typeof Block)
        Router.go('/')
        Router.go('/test')
        Router.back()
        Router.forward()
        expect(window.location.pathname).to.eq('/test')
        expect(window.history.length).to.eq(8)
    })
})

describe('Router kernel features', () => {
    const flush = () => new Promise(resolve => setTimeout(resolve, 0))
    let kernelApp: HTMLElement

    before(() => {
        kernelApp = document.createElement('div')
        kernelApp.id = 'app'
        document.body.appendChild(kernelApp)
    })

    after(() => {
        kernelApp.remove()
    })

    afterEach(() => {
        window.history.pushState(null, '', '/')
        kernelApp.innerHTML = ''
    })

    it('should match a parameterized route and expose params', () => {
        Router.use('/chat/:id', markerBlock('marker-param') as typeof Block)

        Router.go('/chat/42')

        expect(document.querySelector('#marker-param')).to.not.be.null
        expect(Router.getParams()).to.deep.eq({ id: '42' })
    })

    it('should render the 404 route for an unknown path', () => {
        Router.use('/404', markerBlock('marker-404') as typeof Block)
        Router.go('/definitely-missing')

        expect(document.querySelector('#marker-404')).to.not.be.null
    })

    it('should load a lazy route once the loader resolves', async () => {
        Router.use('/lazy-ok', () => Promise.resolve(markerBlock('marker-lazy') as typeof Block))

        Router.go('/lazy-ok')
        await flush()

        expect(document.querySelector('#marker-lazy')).to.not.be.null
    })

    it('should render the error fallback when a lazy loader rejects', async () => {
        Router.error(markerBlock('marker-error') as typeof Block)
        Router.use('/lazy-bad', () => Promise.reject(new Error('load failed')))

        Router.go('/lazy-bad')
        await flush()

        expect(document.querySelector('#marker-error')).to.not.be.null
    })

    it('should block navigation when a guard returns false', () => {
        const stop = Router.beforeEach(() => false)

        Router.use('/guarded', markerBlock('marker-guarded') as typeof Block)
        Router.go('/guarded')

        expect(document.querySelector('#marker-guarded')).to.be.null

        stop()
    })

    it('should redirect when a guard returns a path', () => {
        Router.use('/guard-target', markerBlock('marker-guard-target') as typeof Block)
        Router.use('/guard-locked', markerBlock('marker-guard-locked') as typeof Block)
        const unlock = Router.beforeEach(to => (to === '/guard-locked' ? '/guard-target' : true))

        Router.go('/guard-locked')

        expect(document.querySelector('#marker-guard-locked')).to.be.null
        expect(document.querySelector('#marker-guard-target')).to.not.be.null

        unlock()
    })

    it('should destroy the previous route block on navigation', () => {
        const FirstBlock = markerBlock('marker-leave-first')
        const destroySpy = sinon.spy(FirstBlock.prototype, 'destroy')

        Router.use('/leave-first', FirstBlock as typeof Block)
        Router.use('/leave-second', markerBlock('marker-leave-second') as typeof Block)

        Router.go('/leave-first')
        Router.go('/leave-second')

        expect(document.querySelector('#marker-leave-second')).to.not.be.null
        expect(destroySpy.calledOnce).to.be.true

        destroySpy.restore()
    })

    it('should update route params when the same route is revisited with a new value', () => {
        Router.use('/profile/:id', markerBlock('marker-profile') as typeof Block)

        Router.go('/profile/1')
        expect(document.querySelector('#marker-profile')?.textContent).to.eq('{"id":"1"}')

        Router.go('/profile/2')
        expect(document.querySelector('#marker-profile')?.textContent).to.eq('{"id":"2"}')
        expect(Router.getParams()).to.deep.eq({ id: '2' })
    })

    it('should not mount a pending lazy route after navigating away', async () => {
        let release: () => void = () => undefined
        const gate = new Promise<void>(resolve => {
            release = resolve
        })

        Router.use('/lazy-slow', async () => {
            await gate

            return markerBlock('marker-lazy-slow') as typeof Block
        })
        Router.use('/lazy-safe', markerBlock('marker-lazy-safe') as typeof Block)

        Router.go('/lazy-slow')
        Router.go('/lazy-safe')
        release()
        await flush()

        expect(document.querySelector('#marker-lazy-safe')).to.not.be.null
        expect(document.querySelector('#marker-lazy-slow')).to.be.null
    })

    it('should stop mutual guard redirects instead of recursing', () => {
        Router.use('/cycle-a', markerBlock('marker-cycle-a') as typeof Block)
        Router.use('/cycle-b', markerBlock('marker-cycle-b') as typeof Block)
        const stopCycle = Router.beforeEach(to => (to === '/cycle-a' ? '/cycle-b' : to === '/cycle-b' ? '/cycle-a' : true))

        expect(() => Router.go('/cycle-a')).to.not.throw()

        stopCycle()
    })

    it('should retry a lazy route after a failed load', async () => {
        let calls = 0

        Router.use('/lazy-retry', async () => {
            calls += 1

            if (calls === 1) {
                throw new Error('first load fails')
            }

            return markerBlock('marker-lazy-retry') as typeof Block
        })
        Router.error(markerBlock('marker-error-retry') as typeof Block)

        Router.go('/lazy-retry')
        await flush()
        expect(document.querySelector('#marker-error-retry')).to.not.be.null

        Router.go('/lazy-retry')
        await flush()
        expect(document.querySelector('#marker-lazy-retry')).to.not.be.null
    })
})
