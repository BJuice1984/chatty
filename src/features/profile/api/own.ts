// Own-адаптер порта profile: пользовательские профили бэкенд не отдаёт
// (домены — auth/chats/files/WS), поэтому поиск и правка профиля явно
// отвергаются; changeAvatar реализован на файловом контракте — POST
// /files/avatars (kind=user) c multipart uploaded. Ответ — файловый путь
// аватара, полный ProfileUser портом не возвращается.

import HTTPTransport from '../../../utils/HTTPTransport.ts'
import { readCsrfToken } from '../../../utils/csrf.ts'
import type { ProfilePort } from '../ports.ts'

function unsupported(method: string): never {
    throw new Error(`Операция ${method} недоступна в own-режиме: контракт бэкенда её не предоставляет`)
}

export const ownProfilePort: ProfilePort = {
    searchUsersByLogin() {
        unsupported('searchUsersByLogin')
    },
    changeProfile() {
        unsupported('changeProfile')
    },
    async changeAvatar(data: FormData) {
        const file = data.get('avatar')

        if (!(file instanceof File)) {
            throw new Error('Операция changeAvatar недоступна в own-режиме: форма не содержит файла avatar')
        }

        const payload = new FormData()

        payload.append('uploaded', file)
        payload.append('kind', 'user')

        const response = await (new HTTPTransport('/files/avatars').post('', {
            data: payload,
            csrfToken: readCsrfToken(),
        }) as unknown as Promise<{ avatar_url: string | null }>)

        return { avatar: response.avatar_url ?? '' }
    },
}
