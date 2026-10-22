// Контроллер stories: единственный писатель среза state.stories. fetch —
// лента с бэкенда; markViewed сначала синхронно патчит срез (кольцо гаснет
// через withStore-ререндер — страница сама stories-пропсы не пишет, иначе
// оптимистичный патч гонялся бы с мэппингом стора), и только потом стреляет
// POST (провал логируется, следующий fetch примирит состояние); uploadStory
// ждёт загрузку и рефетчит ленту — сервер уже ставит свои истории первыми.

import { storiesPort } from './api/index.ts'
import { chatStoriesSlice } from './store.ts'

class StoriesController {
    async fetchStories(): Promise<void> {
        try {
            chatStoriesSlice.setStories(await storiesPort.fetchStories())
        } catch (e: unknown) {
            console.error('Ошибка при загрузке историй:', e)
        }
    }

    markViewed(id: number): void {
        chatStoriesSlice.markViewed(id)

        storiesPort.markViewed(id).catch((e: unknown) => {
            console.error('Ошибка при отметке просмотра истории:', e)
        })
    }

    async uploadStory(file: File): Promise<void> {
        try {
            await storiesPort.uploadStory(file)
            await this.fetchStories()
        } catch (e: unknown) {
            console.error('Ошибка при загрузке истории:', e)
        }
    }
}

export default new StoriesController()
