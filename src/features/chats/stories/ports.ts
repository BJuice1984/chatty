// Порты stories-модуля фичи chats: контракт за границей модуля. Модуль живёт
// внутри фичи (прецедент chats/history) — отдельная фича потребовала бы
// cross-feature импорта из страницы чата, который блокирует guard v2.
// Порты самодостаточны: кроме типов ничего не импортируют.

export interface StoryDto {
    id: number
    owner: string
    ownerAvatarUrl: string
    // абсолютный URL фото (адаптер резолвит image_url через fileUrl —
    // плитка Story и вьюер принимают src как есть)
    src: string
    alt: string
    viewed: boolean
    // своя история: зелёное кольцо и возможность удаления
    isOwn: boolean
}

export interface StoriesPort {
    // лента активных историй: свои первыми, потом чужие (новые раньше)
    fetchStories(): Promise<StoryDto[]>
    // загрузка фото истории (multipart uploaded) + csrf
    // eslint-disable-next-line no-unused-vars
    uploadStory(file: File): Promise<void>
    // идемпотентная отметка просмотра (fire-and-forget со стороны контроллера)
    // eslint-disable-next-line no-unused-vars
    markViewed(id: number): Promise<void>
    // удаление собственной истории (owner-only на бэкенде)
    // eslint-disable-next-line no-unused-vars
    deleteStory(id: number): Promise<void>
}
