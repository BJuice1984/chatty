import { expect } from 'chai'
import sinon from 'sinon'
import HTTPTransport from '../../utils/HTTPTransport.ts'
import { resetBusyOverlayForTests } from '../../utils/busyOverlay.ts'
import { createAuthTransportPolicy, installAuthTransportPolicy, SERVER_ERROR_RETRY_DELAYS_MS } from './transportPolicy.ts'
import { authSlice } from './store.ts'

interface PolicyHarness {
    postRefresh: sinon.SinonStub
    logout: sinon.SinonStub
    goToSignIn: sinon.SinonStub
    now: sinon.SinonStub
}

function makePolicy(overrides: Partial<PolicyHarness> = {}): { policy: ReturnType<typeof createAuthTransportPolicy>; deps: PolicyHarness } {
    const deps: PolicyHarness = {
        postRefresh: sinon.stub().resolves(),
        logout: sinon.stub().resolves(),
        goToSignIn: sinon.stub(),
        now: sinon.stub().returns(1_000_000),
        ...overrides,
    }

    return { policy: createAuthTransportPolicy(deps), deps }
}

function setCookieRaw(raw: string): void {
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        writable: true,
        value: raw,
    })
}

function withCsrfCookie(value = 'csrf-token'): void {
    setCookieRaw(`chatty_csrf=${value}; other=irrelevant`)
}

function withoutCsrfCookie(): void {
    setCookieRaw('other=irrelevant')
}

describe('auth transport policy', () => {
    let clock: sinon.SinonFakeTimers

    beforeEach(() => {
        clock = sinon.useFakeTimers()
        resetBusyOverlayForTests()
        withCsrfCookie()
    })

    afterEach(() => {
        HTTPTransport.setTransportPolicy(null)
        resetBusyOverlayForTests()
        withoutCsrfCookie()
        clock.restore()
    })

    describe('onUnauthorized', () => {
        it('refreshes once for two concurrent 401s (single-flight over one-shot rotation)', async () => {
            let release: () => void = () => {}
            const gate = new Promise<void>(resolve => {
                release = resolve
            })
            const postRefresh = sinon.stub().returns(gate)
            const { policy } = makePolicy({ postRefresh })

            const first = policy.onUnauthorized?.('/api/v1/chats')
            const second = policy.onUnauthorized?.('/api/v1/messages')

            expect(postRefresh.calledOnce).to.be.true

            release()

            expect(await first).to.equal(true)
            expect(await second).to.equal(true)
        })

        it('resolves true without any network after a refresh succeeded within the 2000ms window', async () => {
            const { policy, deps } = makePolicy()
            const first = await policy.onUnauthorized?.('/api/v1/chats')

            expect(first).to.equal(true)
            expect(deps.postRefresh.calledOnce).to.be.true

            deps.now.returns(1_001_500)

            const second = await policy.onUnauthorized?.('/api/v1/messages')

            expect(second).to.equal(true)
            expect(deps.postRefresh.calledOnce).to.be.true
        })

        it('refreshes again once the window has passed', async () => {
            const { policy, deps } = makePolicy()

            await policy.onUnauthorized?.('/api/v1/chats')
            deps.now.returns(1_003_000)
            await policy.onUnauthorized?.('/api/v1/messages')

            expect(deps.postRefresh.calledTwice).to.be.true
        })

        it('kicks the user out to sign-in when the refresh fails', async () => {
            const { policy, deps } = makePolicy()
            deps.postRefresh.rejects(new Error('refresh_token_rotated'))

            const result = await policy.onUnauthorized?.('/api/v1/chats')

            expect(result).to.equal(false)
            expect(authSlice.getUser()).to.be.null
            expect(deps.logout.calledOnce).to.be.true
            expect(deps.goToSignIn.calledOnce).to.be.true
        })

        it('still kicks out when the best-effort logout itself fails', async () => {
            const { policy, deps } = makePolicy()
            deps.postRefresh.rejects(new Error('dead'))
            deps.logout.rejects(new Error('cookies already gone'))

            const result = await policy.onUnauthorized?.('/api/v1/chats')

            expect(result).to.equal(false)
            expect(deps.goToSignIn.calledOnce).to.be.true
        })

        it('fails fast without any network when the csrf cookie is absent', async () => {
            withoutCsrfCookie()
            const { policy, deps } = makePolicy()

            const result = await policy.onUnauthorized?.('/api/v1/chats')

            expect(result).to.equal(false)
            expect(deps.postRefresh.called).to.be.false
            expect(deps.goToSignIn.called).to.be.false
        })
    })

    describe('onServerErrorDelay', () => {
        it('answers the 2/6/12 second ladder and null afterwards', () => {
            const { policy } = makePolicy()

            expect(policy.onServerErrorDelay?.('/api/v1/chats', 0)).to.equal(2000)
            expect(policy.onServerErrorDelay?.('/api/v1/chats', 1)).to.equal(6000)
            expect(policy.onServerErrorDelay?.('/api/v1/chats', 2)).to.equal(12000)
            expect(policy.onServerErrorDelay?.('/api/v1/chats', 3)).to.equal(null)
            expect(SERVER_ERROR_RETRY_DELAYS_MS).to.eql([2000, 6000, 12000])
        })
    })

    describe('onRetryOverlay', () => {
        it('shows the wait overlay for an unauthorized begin and hides on the paired end', () => {
            const { policy } = makePolicy()

            policy.onRetryOverlay?.('begin', 'unauthorized')
            clock.tick(0)

            const node = document.getElementById('busy-overlay')

            expect(node?.className).to.contain('busy-overlay_kind_wait')

            policy.onRetryOverlay?.('end', 'unauthorized')
            clock.tick(0)

            expect(document.getElementById('busy-overlay')).to.be.null
        })

        it('shows the reconnect caption for a server-error begin', () => {
            const { policy } = makePolicy()

            policy.onRetryOverlay?.('begin', 'server-error')
            clock.tick(0)

            const node = document.getElementById('busy-overlay')

            expect(node?.className).to.contain('busy-overlay_kind_reconnect')

            policy.onRetryOverlay?.('end', 'server-error')
            clock.tick(0)
        })

        it('never flashes the overlay when the pair closes before the deferred show fires', () => {
            const { policy } = makePolicy()

            policy.onRetryOverlay?.('begin', 'unauthorized')
            policy.onRetryOverlay?.('end', 'unauthorized')
            clock.tick(0)

            expect(document.getElementById('busy-overlay')).to.be.null
        })

        it('keeps the overlay across a 401→5xx phase transition of one request', () => {
            const { policy } = makePolicy()

            policy.onRetryOverlay?.('begin', 'unauthorized')
            clock.tick(0)
            policy.onRetryOverlay?.('end', 'unauthorized')
            policy.onRetryOverlay?.('begin', 'server-error')
            policy.onRetryOverlay?.('end', 'server-error')
            clock.tick(0)

            expect(document.getElementById('busy-overlay')).to.be.null
        })
    })

    describe('beforeUnauthorizedRetry', () => {
        it('re-reads the csrf cookie onto the outgoing options', () => {
            const { policy } = makePolicy()
            const options = { csrfToken: 'stale' }

            withCsrfCookie('fresh-token')
            policy.beforeUnauthorizedRetry?.(options)

            expect(options.csrfToken).to.equal('fresh-token')
        })
    })

    describe('installAuthTransportPolicy', () => {
        it('binds the policy into HTTPTransport', () => {
            const setTransportPolicy = sinon.stub(HTTPTransport, 'setTransportPolicy')

            try {
                installAuthTransportPolicy()

                expect(setTransportPolicy.calledOnce).to.be.true
                const installed = setTransportPolicy.firstCall.args[0]

                expect(installed).to.be.not.null
                expect(installed).to.have.property('onUnauthorized')
                expect(installed).to.have.property('onServerErrorDelay')
                expect(installed).to.have.property('onRetryOverlay')
                expect(installed).to.have.property('beforeUnauthorizedRetry')
            } finally {
                setTransportPolicy.restore()
                HTTPTransport.setTransportPolicy(null)
            }
        })
    })
})
