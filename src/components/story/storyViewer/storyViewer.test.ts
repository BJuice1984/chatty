// Полноэкранный вьюер истории: презентационная оболочка — открытое/закрытое
// состояние, закрытие по бэкдропу/крестику и Escape при фокусе на корне
// (tabindex="-1"; фокус ставит страница). Таймера внутри нет — авто-
// закрытие тестируется у владельца (chat.test.ts).

import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import '../../../features/ai-assistant/hbs-test-loader.ts'
import { StoryViewer } from './storyViewer.ts'

const dom = new JSDOM()
global.document = dom.window.document

const STORY = { owner: 'Midala', src: '/ava-1.jpg', alt: 'Аватар пользователя' }

function clickOn(element: Element): void {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function keyOn(element: Element, key: string): void {
    element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }))
}

describe('story viewer', () => {
    it('renders the open overlay with the story photo and aria state', () => {
        const viewer = new StoryViewer({ story: STORY })

        expect(viewer.element?.classList.contains('chat-story-viewer_open')).to.be.true
        expect(viewer.element?.getAttribute('aria-hidden')).to.eq('false')
        expect(viewer.element?.getAttribute('tabindex')).to.eq('-1')
        expect(viewer.element?.querySelector('.chat-story-viewer__img')?.getAttribute('src')).to.eq('/ava-1.jpg')
        expect(viewer.element?.querySelector('.chat-story-viewer__owner')?.textContent?.trim()).to.eq('Midala')

        viewer.destroy()
    })

    it('renders the closed shell when no story is set', () => {
        const viewer = new StoryViewer({ story: null })

        expect(viewer.element?.classList.contains('chat-story-viewer_closed')).to.be.true
        expect(viewer.element?.getAttribute('aria-hidden')).to.eq('true')
        expect(viewer.element?.querySelector('.chat-story-viewer__img')).to.eq(null)

        viewer.destroy()
    })

    it('closes by the backdrop click', () => {
        const onClose = sinon.spy()
        const viewer = new StoryViewer({ story: STORY, onClose })

        clickOn(viewer.element!.querySelector('[data-testid="story-viewer-backdrop"]')!)

        expect(onClose.calledOnce).to.be.true

        viewer.destroy()
    })

    it('closes by the close button click', () => {
        const onClose = sinon.spy()
        const viewer = new StoryViewer({ story: STORY, onClose })

        clickOn(viewer.element!.querySelector('[data-testid="story-viewer-close"]')!)

        expect(onClose.calledOnce).to.be.true

        viewer.destroy()
    })

    it('stays open on a click on the photo itself', () => {
        const onClose = sinon.spy()
        const viewer = new StoryViewer({ story: STORY, onClose })

        clickOn(viewer.element!.querySelector('.chat-story-viewer__img')!)

        expect(onClose.called).to.be.false

        viewer.destroy()
    })

    it('holds no timers: construction and render never schedule setTimeout', () => {
        // авто-закрытие живёт на странице-владельце таймера — вьюер
        // презентационный и сам ничего не шедулит
        const setTimeoutStub = sinon.stub(global, 'setTimeout')

        try {
            const viewer = new StoryViewer({ story: STORY })

            expect(viewer.element?.classList.contains('chat-story-viewer_open')).to.be.true
            expect(setTimeoutStub.notCalled).to.be.true

            viewer.destroy()
        } finally {
            setTimeoutStub.restore()
        }
    })

    it('closes on Escape when the focused overlay receives the keydown', () => {
        const onClose = sinon.spy()
        const viewer = new StoryViewer({ story: STORY, onClose })

        // фокус (как его ставит страница) делает корневой keydown живым
        viewer.element!.focus()

        keyOn(viewer.element!, 'ArrowRight')
        expect(onClose.called).to.be.false

        keyOn(viewer.element!, 'Escape')
        expect(onClose.calledOnce).to.be.true

        viewer.destroy()
    })
})
