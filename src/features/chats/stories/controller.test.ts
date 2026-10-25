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
import { StoriesController as StoriesControllerClass } from './controller.ts'
import { notifyStoriesSocketEvent } from './ws/gateway.ts'
import { closeStoriesSocket } from './ws/own.ts'

const feed: StoryDto[] = [
    { id: 1, owner: 'ada', ownerAvatarUrl: '', src: 'http://x/1', alt: 'История ada', viewed: false, isOwn: false },
    { id: 2, owner: 'bob', ownerAvatarUrl: '', src: 'http://x/2', alt: 'История bob', viewed: false, isOwn: false },
]

// WS-форма ответа (server StoryResponse): фиксированные viewed/is_own=false
const pushedStory = {
    id: 50,
    owner_id: 42,
    owner_display_name: 'cyrano',
    owner_avatar_url: null,
    image_url: '50/download',
    created_at: '2026-10-25T12:00:00Z',
    viewed: false,
    is_own: false,
}

describe('stories controller', () => {
    let fetchStories: sinon.SinonStub
    let uploadStory: sinon.SinonStub
    let markViewed: sinon.SinonStub

    beforeEach(() => {
        store.set('stories', undefined)
        // ws-адаптерные тесты оставляют свой слушатель в gateway — каждый
        // прогон ре-регистрирует контроллер: события снова патчат срез
        new StoriesControllerClass()
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

    it('deleteStory awaits the delete and refetches the feed', () => {
        const deleted = sinon.stub(ownStoriesPort, 'deleteStory').resolves()

        return StoriesController.deleteStory(2).then(() => {
            expect(deleted.calledOnceWith(2)).to.be.true
            expect(fetchStories.calledOnce).to.be.true
        }).finally(() => {
            // иначе утечка стаба перехватывает deleteStory у соседних
            // тест-файлов, идущих после этого (api.test.ts)
            deleted.restore()
        })
    })

    it('uploadStory awaits the upload and refetches the feed', () => {
        const refetched: StoryDto[] = [
            { id: 3, owner: 'ada', ownerAvatarUrl: '', src: 'http://x/3', alt: 'История ada', viewed: false, isOwn: false },
        ]

        fetchStories.resolves(refetched)

        const file = new File(['photo'], 'story.png', { type: 'image/png' })

        return StoriesController.uploadStory(file).then(() => {
            expect(uploadStory.calledOnceWith(file)).to.be.true
            expect(fetchStories.calledOnce).to.be.true
            expect(chatStoriesSlice.getStories()).to.deep.eq(refetched)
        })
    })

    describe('ws push events', () => {
        const ownFeed: StoryDto[] = [
            { id: 10, owner: 'me', ownerAvatarUrl: '', src: 'http://x/10', alt: 'История me', viewed: false, isOwn: true },
            { id: 11, owner: 'me', ownerAvatarUrl: '', src: 'http://x/11', alt: 'История me', viewed: false, isOwn: true },
            { id: 12, owner: 'ada', ownerAvatarUrl: '', src: 'http://x/12', alt: 'История ada', viewed: false, isOwn: false },
            { id: 13, owner: 'bob', ownerAvatarUrl: '', src: 'http://x/13', alt: 'История bob', viewed: true, isOwn: false },
        ]

        it('constructor wires socket events into slice patches', () => {
            const controller = new StoriesControllerClass()

            chatStoriesSlice.setStories(ownFeed)
            notifyStoriesSocketEvent({ kind: 'story_created', content: pushedStory })

            expect(controller).to.be.instanceOf(StoriesControllerClass)
            expect(chatStoriesSlice.getStories().map(story => story.id)).to.deep.eq([10, 11, 50, 12, 13])
        })

        it('story_created inserts the foreign story right after the own block', () => {
            chatStoriesSlice.setStories(ownFeed)

            notifyStoriesSocketEvent({ kind: 'story_created', content: pushedStory })

            const stories = chatStoriesSlice.getStories()
            const ids = stories.map(story => story.id)

            // голова группы чужих непросмотренных: сразу после блока своих
            expect(ids).to.deep.eq([10, 11, 50, 12, 13])
            expect(stories[2]?.viewed).to.be.false
            expect(stories[2]?.isOwn).to.be.false
        })

        it('story_created inserts at index 0 when the slice has no own stories', () => {
            chatStoriesSlice.setStories(ownFeed.slice(2))

            notifyStoriesSocketEvent({ kind: 'story_created', content: pushedStory })

            expect(chatStoriesSlice.getStories().map(story => story.id)).to.deep.eq([50, 12, 13])
        })

        it('story_created dedupes by id (refetch race, replayed frame)', () => {
            chatStoriesSlice.setStories(ownFeed)

            notifyStoriesSocketEvent({ kind: 'story_created', content: pushedStory })
            notifyStoriesSocketEvent({ kind: 'story_created', content: pushedStory })

            expect(chatStoriesSlice.getStories().map(story => story.id)).to.deep.eq([10, 11, 50, 12, 13])
        })

        it('story_created works on an empty slice', () => {
            notifyStoriesSocketEvent({ kind: 'story_created', content: pushedStory })

            expect(chatStoriesSlice.getStories().map(story => story.id)).to.deep.eq([50])
        })

        it('story_created appends after the own block when everything is own', () => {
            chatStoriesSlice.setStories(ownFeed.slice(0, 2))

            notifyStoriesSocketEvent({ kind: 'story_created', content: pushedStory })

            expect(chatStoriesSlice.getStories().map(story => story.id)).to.deep.eq([10, 11, 50])
        })

        it('story_deleted removes the id and is a no-op for absent ids', () => {
            chatStoriesSlice.setStories(ownFeed)

            notifyStoriesSocketEvent({ kind: 'story_deleted', content: { story_id: 12 } })
            expect(chatStoriesSlice.getStories().map(story => story.id)).to.deep.eq([10, 11, 13])

            notifyStoriesSocketEvent({ kind: 'story_deleted', content: { story_id: 999 } })
            expect(chatStoriesSlice.getStories().map(story => story.id)).to.deep.eq([10, 11, 13])
        })

        it('connectStoriesSocket delegates to the ws module (opens /ws/stories)', () => {
            const sockets: { url: string }[] = []

            class FakeWebSocket {
                static readonly CONNECTING = 0
                static readonly OPEN = 1
                static readonly CLOSING = 2
                static readonly CLOSED = 3

                readyState = FakeWebSocket.CONNECTING

                constructor(url: string) {
                    sockets.push({ url })
                }

                addEventListener() {}
                removeEventListener() {}
                send() {}
                close() {}
            }

            const original = globalThis.WebSocket

            globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
            try {
                StoriesController.connectStoriesSocket()

                expect(sockets).to.have.lengthOf(1)
                expect(sockets[0]?.url).to.eq('ws://localhost:8000/api/v1/ws/stories')
            } finally {
                closeStoriesSocket()
                globalThis.WebSocket = original
            }
        })
    })
})
