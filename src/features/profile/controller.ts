// Фича-контроллер profile (stage 4; 2026-11-01-settings — смена пароля, выход
// со всех устройств, хранилище, возврат в чат): бизнес-логика за портом.
// Межфичевые связи (свежесть пользователя и выход — auth, возврат в
// архивированный чат — chats) приходят через consumer-side шов: сеттер с
// noop-дефолтами, связываемый композицией (src/features/index.ts, прецедент
// setContactsIntegration); прямой cross-feature импорт запрещён guard v2.

import type { ChangeUserData, SearchUserData } from '../../utils/types.ts'
import type { FilesUsage, PasswordChangeData, ProfilePort } from './ports.ts'
import { profileSlice } from './store.ts'

// Швы композиции: до связывания — noop, контроллерские обёртки не падают
export interface ProfileSeams {
    refreshUser(): void | Promise<void>
    logout(): void | Promise<void>
    // eslint-disable-next-line no-unused-vars
    rejoinChat(chatId: number): void | Promise<void>
}

const noopSeams: ProfileSeams = {
    refreshUser: () => {},
    logout: () => {},
    rejoinChat: () => {},
}

let seams: ProfileSeams = noopSeams

// Композиция (features/index.ts) вызывает это до первого рендера.
export function setProfileSeams(wired: ProfileSeams): void {
    seams = wired
}

export class ProfileFeatureController {
    private readonly port: ProfilePort

    constructor(port: ProfilePort) {
        this.port = port
    }

    async searchUserByLogin(login: SearchUserData): Promise<number[] | undefined> {
        try {
            const foundUsers = await this.port.searchUsersByLogin(login)

            return foundUsers.map(user => user.id)
        } catch (e: unknown) {
            console.error('Ошибка при поиске пользователя:', e)

            return undefined
        }
    }

    // Правка профиля (2026-11-01-settings): успешный PUT /auth/profile не
    // пишется в стор напрямую — снимок пользователя приходит через шов
    // refreshUser (auth-фича), стор получает единую форму AuthUser с
    // send_read_receipts
    async changeUserInfo(userData: ChangeUserData): Promise<void> {
        try {
            await this.port.changeProfile(userData)
            await seams.refreshUser()
        } catch (e: unknown) {
            console.error('Ошибка при изменении информации о пользователе:', e)
        }
    }

    // Смена пароля: успех переиздаёт cookie текущей сессии — снимок
    // пользователя обновляется тем же шовом
    async changePassword(data: PasswordChangeData): Promise<void> {
        try {
            await this.port.changePassword(data)
            await seams.refreshUser()
        } catch (e: unknown) {
            console.error('Ошибка при смене пароля:', e)
        }
    }

    // «Выйти со всех устройств»: бэкенд отзывает все сессии и сбрасывает
    // cookie; локальный выход (сброс стора + редирект) делает шов logout
    async logoutAll(): Promise<void> {
        try {
            await this.port.logoutAll()
            await seams.logout()
        } catch (e: unknown) {
            console.error('Ошибка при выходе со всех устройств:', e)
        }
    }

    // Хранилище Data Usage: {total_bytes, file_count} по файлам вьюера;
    // ошибка порта молчит — секция показывает пустое состояние
    async fetchUsage(): Promise<FilesUsage | undefined> {
        try {
            return await this.port.fetchUsage()
        } catch (e: unknown) {
            console.error('Ошибка при получении занятого хранилища:', e)

            return undefined
        }
    }

    // Возврат в архивированный чат — логика chats-фичи, сюда приходит шовом
    // (страница настроек достигает её через профиль, без cross-feature импорта)
    rejoinChat(chatId: number): void {
        void seams.rejoinChat(chatId)
    }

    async changeUserAvatar(userData: FormData): Promise<void> {
        try {
            const { avatar } = await this.port.changeAvatar(userData)
            const user = profileSlice.getUser()

            // точечный патч аватара: остальные поля профиля не менялись
            if (user != null && avatar !== '') {
                profileSlice.setUser({ ...user, avatar })
            }
        } catch (e: unknown) {
            console.error('Ошибка при изменении аватара пользователя:', e)
        }
    }

    async logout(): Promise<void> {
        await seams.logout()
    }
}

let profileController: ProfileFeatureController | null = null

// Композиция (features/index.ts) вызывает это до первого рендера.
export function setProfileController(controller: ProfileFeatureController): void {
    profileController = controller
}

export function getProfileController(): ProfileFeatureController {
    if (profileController === null) {
        throw new Error('ProfileFeatureController не связан: композиция (src/features/index.ts) должна вызвать setProfileController до рендера')
    }

    return profileController
}
