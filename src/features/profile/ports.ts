// Порты фичи profile (stage 4; 2026-11-01-settings — правка профиля на
// контракте собственного бэкенда, смена пароля, выход со всех устройств и
// хранилище Data Usage): контракт за границей фичи.
// Реализация — own-адаптер (./api/own.ts); поиск пользователей бэкенд
// предоставляет доменом /users (фича chats), здесь он явно отвергается.

import type { ChangeUserData, SearchUserData } from '../../utils/types.ts'

export interface ProfileUser {
    id: number
    first_name: string
    second_name: string
    display_name: string
    login: string
    email: string
    phone: string
    avatar: string
    // серверный флаг «отправлять отчёты о прочтении» (тумблер приватности)
    send_read_receipts: boolean
}

// Смена пароля (PUT /auth/password): старый пароль + новый по политике 12..256;
// успех переиздаёт cookie текущей сессии и отзывает остальные
export interface PasswordChangeData {
    old_password: string
    new_password: string
}

// Хранилище вьюера (GET /files/usage): один SUM/COUNT по всем его файлам
export interface FilesUsage {
    total_bytes: number
    file_count: number
}

export interface ProfilePort {
    // eslint-disable-next-line no-unused-vars
    searchUsersByLogin(data: SearchUserData): Promise<ProfileUser[]>
    // частичная правка: адаптер шлёт только определённые поля контракта
    // (display_name/phone/send_read_receipts); ответ — обновлённый пользователь
    // eslint-disable-next-line no-unused-vars
    changeProfile(data: ChangeUserData): Promise<ProfileUser>
    // ответ — только файловый путь загруженного аватара: контроллер
    // патчит state.user.avatar, полный ProfileUser не возвращается
    // eslint-disable-next-line no-unused-vars
    changeAvatar(data: FormData): Promise<{ avatar: string }>
    // eslint-disable-next-line no-unused-vars
    changePassword(data: PasswordChangeData): Promise<void>
    logoutAll(): Promise<void>
    fetchUsage(): Promise<FilesUsage>
}
