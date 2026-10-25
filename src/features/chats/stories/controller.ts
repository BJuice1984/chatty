// Контроллер stories: единственный писатель среза state.stories. fetch —
// лента с бэкенда; markViewed сначала синхронно патчит срез (кольцо гаснет
// через withStore-ререндер — страница сама stories-пропсы не пишет, иначе
// оптимистичный патч гонялся бы с мэппингом стора), и только потом стреляет
// POST (провал логируется, следующий fetch примирит состояние); uploadStory
// ждёт загрузку и рефетчит ленту — сервер уже ставит свои истории первыми.
// stories-ws-push: сокет-события приходят через gateway-листенер и патчат
// срез точечно — вставка чужой непросмотренной после блока своих (новая
// всегда свежейшая — порядок ленты воспроизводится без рефетча) и удаление
// по id; дедуп страхует гонку с ин-флайт рефетчем.

import { type OwnStoryResponse, toStoryDto } from './api/own.ts'
import { storiesPort } from './api/index.ts'
import { chatStoriesSlice } from './store.ts'
import { type StoriesSocketEvent, setStoriesSocketListener } from './ws/gateway.ts'
import { connectStoriesSocket } from './ws/own.ts'

export class StoriesController {
    constructor() {
        // конструкторская регистрация (паттерн ChatsController → шлюз):
        // событие из сокета превращается в патч среза в единственном писателе
        setStoriesSocketListener(event => this.handleSocketEvent(event))
    }

    // страница чатов открывает глобальный сокет на CDM; идемпотентно —
    // повторные заходы переиспользуют соединение
    connectStoriesSocket(): void {
        connectStoriesSocket()
    }

    private handleSocketEvent(event: StoriesSocketEvent): void {
        if (event.kind === 'story_created') {
            this.applyStoryCreated(event.content)

            return
        }

        this.applyStoryDeleted(event.content.story_id)
    }

    // дедуп по id: дубль события или история из ин-флайт рефетча — no-op
    private applyStoryCreated(raw: OwnStoryResponse): void {
        const current = chatStoriesSlice.getStories()

        if (current.some(story => story.id === raw.id)) {
            return
        }

        const story = toStoryDto(raw)
        // свой блок — префикс среза: вставка перед первым не-своим (нет
        // своих — индекс 0; все свои — в конец)
        const insertAt = current.findIndex(item => !item.isOwn)

        chatStoriesSlice.setStories(
            insertAt === -1
                ? [...current, story]
                : [...current.slice(0, insertAt), story, ...current.slice(insertAt)]
        )
    }

    private applyStoryDeleted(storyId: number): void {
        const current = chatStoriesSlice.getStories()

        if (!current.some(story => story.id === storyId)) {
            return
        }

        chatStoriesSlice.setStories(current.filter(story => story.id !== storyId))
    }

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

    // удаление своей истории: после DELETE лента рефетчится (свои
    // истории остаются первыми)
    async deleteStory(id: number): Promise<void> {
        try {
            await storiesPort.deleteStory(id)
            await this.fetchStories()
        } catch (e: unknown) {
            console.error('Ошибка при удалении истории:', e)
        }
    }
}

export default new StoriesController()
