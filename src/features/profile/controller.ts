// Фича-контроллер profile (stage 4; stage 7 — режимные адаптеры в ./api):
// бизнес-логика за портом. Logout — чужая фича (auth): связь проводится
// в композиции (src/features/index.ts), фича получает её инъекцией; прямой
// cross-feature импорт запрещён guard v2. Порт выбирается композицией
// из ./api/index.ts (practicum / own по env.mode).

import type { ChangeUserData, SearchUserData } from '../../utils/types.ts'
import type { LogoutAction, ProfilePort } from './ports.ts'
import { profileSlice } from './store.ts'

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
