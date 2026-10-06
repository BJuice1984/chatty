// Порты фичи profile (stage 4): контракт за границей фичи.
// Реализация по умолчанию — адаптер над legacy UserApi (read-only до stage 7);
// own-адаптер придёт с api-cutover.

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
}

export interface ProfilePort {
    // eslint-disable-next-line no-unused-vars
    searchUsersByLogin(data: SearchUserData): Promise<ProfileUser[]>
    // eslint-disable-next-line no-unused-vars
    changeProfile(data: ChangeUserData): Promise<ProfileUser>
    // eslint-disable-next-line no-unused-vars
    changeAvatar(data: FormData): Promise<ProfileUser>
}

export type LogoutAction = () => Promise<void>
