// Плитка истории (мок-стадия stories): рамка unread/viewed, клик по
// контейнеру стреляет onClick с id; клики мимо контейнера игнорируются.

import { expect } from 'chai'
import sinon from 'sinon'
import { JSDOM } from 'jsdom'
import '../../features/ai-assistant/hbs-test-loader.ts'
import { Story } from './story.ts'

const dom = new JSDOM()
global.document = dom.window.document

function clickOn(element: Element): void {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('story tile', () => {
    it('renders the highlighted ring by default (unread)', () => {
        const story = new Story({ id: 's1', owner: 'Midala', src: '/a.jpg', alt: 'Аватар' })

        const container = story.element?.querySelector('.chat-story__container')

        expect(container?.classList.contains('chat-story__container_viewed')).to.be.false

        story.destroy()
    })

    it('renders the viewed modifier when isUnread is false', () => {
        const story = new Story({ id: 's1', owner: 'Midala', src: '/a.jpg', alt: 'Аватар', isUnread: false })

        const container = story.element?.querySelector('.chat-story__container')

        expect(container?.classList.contains('chat-story__container_viewed')).to.be.true

        story.destroy()
    })

    it('keeps the add-story modifier without the viewed class for the add tile', () => {
        const story = new Story({
            id: 'add-story',
            owner: 'You story',
            extraClass: 'chat-story__container_type_add-story',
            src: '/add.svg',
            alt: 'Создать историю',
        })

        const container = story.element?.querySelector('.chat-story__container')

        expect(container?.classList.contains('chat-story__container_type_add-story')).to.be.true
        expect(container?.classList.contains('chat-story__container_viewed')).to.be.false

        story.destroy()
    })

    it('calls onClick with the story id on a container click', () => {
        const onClick = sinon.spy()
        const story = new Story({ id: 's2', owner: 'Athalia', src: '/b.jpg', alt: 'Аватар', onClick })

        clickOn(story.element!.querySelector('.chat-story__container')!)

        expect(onClick.calledOnceWith('s2')).to.be.true

        story.destroy()
    })

    it('ignores clicks outside the container (e.g. the title)', () => {
        const onClick = sinon.spy()
        const story = new Story({ id: 's2', owner: 'Athalia', src: '/b.jpg', alt: 'Аватар', onClick })

        clickOn(story.element!.querySelector('.chat-story__title')!)

        expect(onClick.called).to.be.false

        story.destroy()
    })

    it('renders the own-story green ring modifier only for isOwn', () => {
        const own = new Story({ owner: 'me', src: 'x.png', alt: 'a', isOwn: true })
        const foreign = new Story({ owner: 'ada', src: 'x.png', alt: 'a', isOwn: false })

        expect(own.element?.querySelector('.chat-story__container_own')).to.not.be.null
        expect(foreign.element?.querySelector('.chat-story__container_own')).to.be.null
    })
})
