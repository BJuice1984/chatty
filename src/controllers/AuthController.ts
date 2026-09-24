import API, { AuthAPI, SigninData, SignupData } from '../api/AuthApi.ts'
import store from '../utils/Store.ts'
import Router from '../utils/Router.ts'
import { MESSENGER, PROFILE, SIGNIN } from '../utils/constants.ts'
import ChatsController from './ChatsController.ts'

class AuthController {
    private readonly api: AuthAPI = API

    async signin(data: SigninData) {
        try {
            await this.api.signin(data)
            await this.fetchUser()
            await ChatsController.fetchChats()

            Router.go(MESSENGER)
        } catch (e: unknown) {
            console.error('Ошибка при входе в систему:', e)
        }
    }

    async signup(data: SignupData) {
        try {
            await this.api.signup(data)

            await this.fetchUser()

            Router.go(PROFILE)
        } catch (e: unknown) {
            console.error('Ошибка при регистрации:', e)
        }
    }

    async fetchUser() {
        let user = {}

        try {
            user = await this.api.read()
            Router.go(MESSENGER)
        } catch (e: unknown) {
            console.error('Ошибка при получении информации о пользователе:', e)
        }

        store.set('user', user)
    }

    async logout() {
        try {
            await this.api.logout()

            Router.go(SIGNIN)
        } catch (e: unknown) {
            console.error('Ошибка при выходе из системы:', e)
        }
    }
}

export default new AuthController()
