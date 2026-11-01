// Own-адаптер порта profile (2026-11-01-settings): правка профиля —
// PUT /auth/profile (частичное тело: только определённые поля, отсутствующее
// поле колонку на сервере не затирает), смена пароля — PUT /auth/password,
// выход со всех устройств — POST /auth/logout-all (все с CSRF double-submit),
// хранилище — GET /files/usage на собственном транспорте файлового домена.
// Поиск пользователей доменом профиля бэкенд не предоставляет (живой поиск —
// GET /users в фиче chats) — операция явно отвергается. changeAvatar реализован
// на файловом контракте — POST /files/avatars (kind=user) c multipart uploaded;
// ответ — файловый путь аватара, полный ProfileUser портом не возвращается.

import HTTPTransport from '../../../utils/HTTPTransport.ts'
import { readCsrfToken } from '../../../utils/csrf.ts'
import { avatarPoolUrl } from '../../../utils/avatarPool.ts'
import type { ChangeUserData } from '../../../utils/types.ts'
import type { PasswordChangeData, ProfilePort, ProfileUser } from '../ports.ts'

function unsupported(method: string): never {
    throw new Error(`Операция ${method} недоступна в own-режиме: контракт бэкенда её не предоставляет`)
}

// UserResponse /auth/* (волна настроек расширила его профильными полями).
// Зеркало живёт здесь: OwnUserResponse фичи auth импортировать нельзя
// (cross-feature), фичи друг от друга не зависят.
interface OwnProfileResponse {
    id: number
    email: string
    role: string
    is_active: boolean
    created_at: string
    avatar_url?: string | null
    display_name?: string | null
    phone?: string | null
    send_read_receipts?: boolean
}

const http = new HTTPTransport('/auth')
// хранилище живёт на файловом домене, а не в /auth
const filesHttp = new HTTPTransport('/files')

// Локальная часть email — фолбэк выводимого имени (зеркалит серверные
// name-builders и own-адаптер фичи auth)
function emailLocalPart(email: string): string {
    const localPart = email.split('@')[0]

    return localPart === '' ? email : localPart
}

function toProfileUser(response: OwnProfileResponse): ProfileUser {
    return {
        id: response.id,
        login: response.email,
        email: response.email,
        first_name: '',
        second_name: '',
        display_name: response.display_name ?? emailLocalPart(response.email),
        phone: response.phone ?? '',
        send_read_receipts: response.send_read_receipts ?? true,
        avatar: response.avatar_url ?? avatarPoolUrl(response.id),
    }
}

// Тело PUT /auth/profile: только ОПРЕДЕЛЁННЫЕ поля контракта (PATCH-семантика
// PUT); legacy-поля форм (first_name/second_name/login/email) не поддержаны
// бэкендом и в запрос не попадают
export function toProfileBody(data: ChangeUserData): Record<string, unknown> {
    const body: Record<string, unknown> = {}

    if (data.display_name !== undefined) {
        body.display_name = data.display_name
    }

    if (data.phone !== undefined) {
        body.phone = data.phone
    }

    if (data.send_read_receipts !== undefined) {
        body.send_read_receipts = data.send_read_receipts
    }

    return body
}

export const ownProfilePort: ProfilePort = {
    searchUsersByLogin() {
        unsupported('searchUsersByLogin')
    },
    async changeProfile(data) {
        const response = await (http.put('/profile', {
            data: toProfileBody(data),
            csrfToken: readCsrfToken(),
        }) as unknown as Promise<OwnProfileResponse>)

        return toProfileUser(response)
    },
    async changePassword(data: PasswordChangeData) {
        // успех переиздаёт cookie текущей сессии; телом ответа будет
        // UserResponse, но пользовательский снимок контроллер берёт через
        // шов refreshUser (единая форма AuthUser)
        await http.put('/password', {
            data: { old_password: data.old_password, new_password: data.new_password },
            csrfToken: readCsrfToken(),
        })
    },
    async logoutAll() {
        await http.post('/logout-all', { csrfToken: readCsrfToken() })
    },
    async fetchUsage() {
        // транспорт типизирован Promise<never> — ответ уже FilesUsage
        return await filesHttp.get('/usage')
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
