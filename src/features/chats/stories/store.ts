// Слайс состояния stories: тип живёт в модуле, ядро Store остаётся
// shape-agnostic (state.stories объявлен слабо типизированным, как chats).
// type-импорт из features в utils запрещён guard-ом (layer-direction не
// различает type-only) — каст остаётся здесь.

import store from '../../../utils/Store.ts'
import type { StoryDto } from './ports.ts'

export interface ChatStoriesSlice {
    getStories(): StoryDto[]
    // eslint-disable-next-line no-unused-vars
    setStories(stories: StoryDto[]): void
    // точечный патч viewed (markViewed): синхронно, до POST — гашение кольца
    // приходит в страницу через withStore-мэппинг, страница не пишет stories
    // eslint-disable-next-line no-unused-vars
    markViewed(id: number): void
}

export const chatStoriesSlice: ChatStoriesSlice = {
    getStories() {
        return (store.getState().stories as StoryDto[] | undefined) ?? []
    },

    setStories(stories) {
        store.set('stories', stories)
    },

    markViewed(id) {
        const current = (store.getState().stories as StoryDto[] | undefined) ?? []

        store.set(
            'stories',
            current.map(story => (story.id === id && !story.viewed ? { ...story, viewed: true } : story))
        )
    },
}
