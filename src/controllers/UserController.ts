import { User } from '../api/AuthApi.ts'
import API, { ChangeUserData, SearchUserData, UsersAPI } from '../api/UserApi.ts'
import store from '../utils/Store.ts'

class UserController {
    private readonly api: UsersAPI = API
    private user: User | object = {}

    private handleError(method: string, error: unknown) {
        console.error(`Ошибка при выполнении ${method}:`, error)
    }

    async searchUserByLogin(login: SearchUserData): Promise<number[] | undefined> {
        try {
            const foundUsers = await this.api.searchUsers(login)

            return foundUsers.map(user => user.id)
        } catch (e: unknown) {
            this.handleError('поиска пользователя', e)

            return undefined
        }
    }

    async changeUserInfo(userData: ChangeUserData) {
        try {
            this.user = await this.api.changeUser(userData)
        } catch (e: unknown) {
            this.handleError('изменения информации о пользователе', e)
        }

        store.set('user', this.user)
    }

    async changeUserAvatar(userData: FormData) {
        try {
            this.user = await this.api.changeAvatar(userData)
        } catch (e: unknown) {
            this.handleError('изменения аватара пользователя', e)
        }

        store.set('user', this.user)
    }
}

export default new UserController()
