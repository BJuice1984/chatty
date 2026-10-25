// Own-адаптер порта stories: GET /stories (лента), POST /stories (multipart),
// POST /stories/{id}/view — все с cookie-аутентификацией, записи с CSRF.
// image_url/owner_avatar_url приходят файловыми путями ("{file_id}/download")
// и резолвятся в абсолютные через fileUrl: плитка Story и вьюер берут src
// как есть. alt в контракте бэкенда нет — синтезируется из имени владельца.

import HTTPTransport from '../../../../utils/HTTPTransport.ts'
import { readCsrfToken } from '../../../../utils/csrf.ts'
import { fileUrl } from '../../../../utils/env.ts'
import { avatarPoolUrl } from '../../../../utils/avatarPool.ts'
import type { StoriesPort, StoryDto } from '../ports.ts'

export interface OwnStoryResponse {
    id: number
    owner_id: number
    owner_display_name: string
    owner_avatar_url: string | null
    image_url: string
    created_at: string
    viewed: boolean
    is_own: boolean
}

const http = new HTTPTransport('/stories')

// WS-фан-аут story_created приходит той же формой, что и REST-лента
// (единый серверный сериализатор), — переиспользуем без второго маппера
export function toStoryDto(response: OwnStoryResponse): StoryDto {
    const owner = response.owner_display_name

    return {
        id: response.id,
        owner,
        ownerAvatarUrl:
            response.owner_avatar_url != null && response.owner_avatar_url !== ''
                ? fileUrl(response.owner_avatar_url)
                : avatarPoolUrl(response.owner_id),
        src: fileUrl(response.image_url),
        alt: `История ${owner}`,
        viewed: response.viewed,
        isOwn: response.is_own,
    }
}

export const ownStoriesPort: StoriesPort = {
    async fetchStories() {
        const stories = await (http.get('') as unknown as Promise<OwnStoryResponse[]>)

        return stories.map(toStoryDto)
    },

    async uploadStory(file: File) {
        const data = new FormData()

        data.append('uploaded', file)

        await http.post('', { data, csrfToken: readCsrfToken() })
    },

    async markViewed(id: number) {
        await http.post(`/${id}/view`, { csrfToken: readCsrfToken() })
    },

    async deleteStory(id: number) {
        await http.delete(`/${id}`, { csrfToken: readCsrfToken() })
    },
}
