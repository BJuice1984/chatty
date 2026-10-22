// Контроллер stories: единственный писатель среза state.stories —
// fetch пишет ленту, markViewed синхронно патчит viewed ДО своего POST
// (кольцо гасит через withStore без гонки со страницей), uploadStory
// ждёт загрузку и рефетчит ленту. Стабим методы порта-объекта: контроллер
// зовёт их у того же ownStoriesPort.

import { expect } from 'chai'
import sinon from 'sinon'
import store from '../../../utils/Store.ts'
import type { StoryDto } from './ports.ts'
import { chatStoriesSlice } from './store.ts'
import { ownStoriesPort } from './api/own.ts'
import StoriesController from './controller.ts'

const feed: StoryDto[] = [
    { id: 1, owner: 'ada', ownerAvatarUrl: '', src: 'http://x/1', alt: 'История ada', viewed: false },
    { id: 2, owner: 'bob', ownerAvatarUrl: '', src: 'http://x/2', alt: 'История bob', viewed: false },
]

describe('stories controller', () => {
    let fetchStories: sinon.SinonStub
    let uploadStory: sinon.SinonStub
    let markViewed: sinon.SinonStub

    beforeEach(() => {
        store.set('stories', undefined)
        fetchStories = sinon.stub(ownStoriesPort, 'fetchStories').resolves(feed)
        uploadStory = sinon.stub(ownStoriesPort, 'uploadStory').resolves()
        markViewed = sinon.stub(ownStoriesPort, 'markViewed').resolves()
    })

    afterEach(() => {
        markViewed.restore()
        uploadStory.restore()
        fetchStories.restore()
        store.set('stories', undefined)
    })

    it('fetchStories writes the mapped slice into the store', async () => {
        await StoriesController.fetchStories()

        expect(chatStoriesSlice.getStories()).to.deep.eq(feed)
        expect(fetchStories.calledOnce).to.be.true
    })

    it('markViewed patches the slice synchronously first, then fires the POST', () => {
        return StoriesController.fetchStories().then(() => {
            const sliceAfterFetch = chatStoriesSlice.getStories()

            StoriesController.markViewed(1)

            // синхронный эффект: viewed погашен сразу, до резолва POST
            const after = chatStoriesSlice.getStories()

            expect(after[0]?.viewed).to.be.true
            expect(after[0]?.src).to.eq(sliceAfterFetch[0]?.src)
            expect(after[1]?.viewed).to.be.false
            expect(markViewed.calledOnceWith(1)).to.be.true
        })
    })

    it('markViewed failure keeps the optimistic patch (next fetch reconciles)', () => {
        markViewed.rejects(new Error('offline'))

        return StoriesController.fetchStories()
            .then(() => StoriesController.markViewed(2))
            .then(() => new Promise(resolve => setTimeout(resolve, 0)))
            .then(() => {
                // POST провалился (console.error), срез остался оптимистичным
                expect(chatStoriesSlice.getStories()[1]?.viewed).to.be.true
            })
    })

    it('uploadStory awaits the upload and refetches the feed', () => {
        const refetched: StoryDto[] = [
            { id: 3, owner: 'ada', ownerAvatarUrl: '', src: 'http://x/3', alt: 'История ada', viewed: false },
        ]

        fetchStories.resolves(refetched)

        const file = new File(['photo'], 'story.png', { type: 'image/png' })

        return StoriesController.uploadStory(file).then(() => {
            expect(uploadStory.calledOnceWith(file)).to.be.true
            expect(fetchStories.calledOnce).to.be.true
            expect(chatStoriesSlice.getStories()).to.deep.eq(refetched)
        })
    })
})
