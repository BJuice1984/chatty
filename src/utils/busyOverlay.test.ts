import { expect } from 'chai'
import sinon from 'sinon'
import { hideBusyOverlay, resetBusyOverlayForTests, showBusyOverlay } from './busyOverlay.ts'

const OVERLAY_ID = 'busy-overlay'

function overlay(): HTMLElement | null {
    return document.getElementById(OVERLAY_ID)
}

function flushTeardown(clock: sinon.SinonFakeTimers): void {
    clock.tick(1)
}

describe('busyOverlay', () => {
    let clock: sinon.SinonFakeTimers

    beforeEach(() => {
        clock = sinon.useFakeTimers()
        resetBusyOverlayForTests()
    })

    afterEach(() => {
        clock.restore()
        resetBusyOverlayForTests()
    })

    it('creates the full-screen node on first show with the verbatim wait caption and three dot spans', () => {
        showBusyOverlay('wait')

        const node = overlay()

        expect(node).to.be.not.null
        expect(node?.getAttribute('role')).to.equal('status')
        expect(node?.getAttribute('aria-live')).to.equal('polite')
        expect(node?.className).to.contain('busy-overlay_kind_wait')
        expect(node?.querySelector('.busy-overlay__spinner')).to.be.not.null
        expect(node?.querySelector('.busy-overlay__caption')?.textContent).to.equal('Пожалуйста, ожидайте')

        const dots = node?.querySelectorAll('.busy-overlay__dot')

        expect(dots?.length).to.equal(3)
    })

    it('renders the verbatim reconnect caption without dots', () => {
        showBusyOverlay('reconnect')

        const node = overlay()

        expect(node?.className).to.contain('busy-overlay_kind_reconnect')
        expect(node?.querySelector('.busy-overlay__caption')?.textContent).to.equal('Возможно, проблемы на сервере.. Мы пробуем переподключиться')
        expect(node?.querySelectorAll('.busy-overlay__dot').length).to.equal(0)
    })

    it('keeps the node while parallel shows are outstanding and removes it after the last hide (grace-deferred)', () => {
        showBusyOverlay('wait')
        showBusyOverlay('wait')

        hideBusyOverlay()

        expect(overlay()).to.be.not.null

        hideBusyOverlay()
        flushTeardown(clock)

        expect(overlay()).to.be.null
    })

    it('cancels the deferred teardown when a new show arrives before the macrotask fires', () => {
        showBusyOverlay('wait')
        hideBusyOverlay()

        showBusyOverlay('wait')

        expect(overlay()).to.be.not.null

        hideBusyOverlay()
        flushTeardown(clock)

        expect(overlay()).to.be.null
    })

    it('switches the caption kind on a follow-up show without duplicating nodes', () => {
        showBusyOverlay('wait')
        showBusyOverlay('reconnect')

        const nodes = document.querySelectorAll(`#${OVERLAY_ID}`)

        expect(nodes.length).to.equal(1)
        expect(nodes[0].className).to.contain('busy-overlay_kind_reconnect')
        expect(nodes[0].querySelector('.busy-overlay__caption')?.textContent).to.contain('сервере..')

        hideBusyOverlay()
        hideBusyOverlay()
        flushTeardown(clock)
    })
})
