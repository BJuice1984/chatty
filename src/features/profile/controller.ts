// Фича-контроллер profile (stage 4): бизнес-логика за портом.
// Дефолтная реализация порта — адаптер над legacy UserApi (read-only до stage 7).
// Logout — чужая фича (auth): связь проводится в композиции (src/features/index.ts),
// фича получает её инъекцией; прямой cross-feature импорт запрещён guard v2.

import API from '../../api/UserApi.ts'
import type { ChangeUserData, SearchUserData } from '../../utils/types.ts'
import type { LogoutAction, ProfilePort, ProfileUser } from './ports.ts'
import { profileSlice } from './store.ts'

// legacy User не объявляет display_name, ChangeUserData требует id/avatar — мост через unknown
export const practicumProfilePort: ProfilePort = {
    searchUsersByLogin: (data) => API.searchUsers(data) as unknown as Promise<ProfileUser[]>,
    changeProfile: (data) => API.changeUser(data as unknown as Parameters<typeof API.changeUser>[0]) as unknown as Promise<ProfileUser>,
    changeAvatar: (data) => API.changeAvatar(data) as unknown as Promise<ProfileUser>,
}

export class ProfileFeatureController {
    private readonly port: ProfilePort
    private readonly logoutAction: LogoutAction

    constructor(port: ProfilePort, logoutAction: LogoutAction) {
        this.port = port
        this.logoutAction = logoutAction
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

    async changeUserInfo(userData: ChangeUserData): Promise<void> {
        try {
            profileSlice.setUser(await this.port.changeProfile(userData))
        } catch (e: unknown) {
            console.error('Ошибка при изменении информации о пользователе:', e)
        }
    }

    async changeUserAvatar(userData: FormData): Promise<void> {
        try {
            profileSlice.setUser(await this.port.changeAvatar(userData))
        } catch (e: unknown) {
            console.error('Ошибка при изменении аватара пользователя:', e)
        }
    }

    logout(): Promise<void> {
        return this.logoutAction()
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
