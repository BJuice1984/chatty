// Фича-контроллер auth (stage 3): бизнес-логика за портом.
// Реализация порта по умолчанию — адаптер над legacy AuthApi (api-слой ниже features — импорт вниз легален).
// Legacy AuthController не трогаем: снос — stage 4.

import API, { SigninData, SignupData } from '../../api/AuthApi.ts'
import Router from '../../utils/Router.ts'
import { MESSENGER, PROFILE, SIGNIN } from '../../utils/constants.ts'
import type { AuthPort, AuthUser, SignInRequest, SignUpRequest } from './ports.ts'
import { authSlice } from './store.ts'

const practicumAuthPort: AuthPort = {
    // legacy DTO несут index-сигнатуры; порт задаёт точный контракт — мост через каст
    signin: (data) => API.signin(data as SigninData),
    signup: (data) => API.signup(data as SignupData),
    // runtime-ответ Практикума содержит display_name, хотя legacy User его не объявляет
    me: () => API.read() as unknown as Promise<AuthUser>,
    logout: () => API.logout(),
}

export class AuthFeatureController {
    private readonly port: AuthPort

    constructor(port: AuthPort = practicumAuthPort) {
        this.port = port
    }

    async signin(data: SignInRequest): Promise<void> {
        try {
            await this.port.signin(data)
            await this.fetchUser()
            Router.go(MESSENGER)
        } catch (e: unknown) {
            console.error('Ошибка при входе в систему:', e)
        }
    }

    async signup(data: SignUpRequest): Promise<void> {
        try {
            await this.port.signup(data)
            await this.fetchUser()
            Router.go(PROFILE)
        } catch (e: unknown) {
            console.error('Ошибка при регистрации:', e)
        }
    }

    async fetchUser(): Promise<void> {
        try {
            const user = await this.port.me()

            authSlice.setUser(user)
        } catch (e: unknown) {
            console.error('Ошибка при получении информации о пользователе:', e)
            authSlice.setUser(null)
        }
    }

    async logout(): Promise<void> {
        try {
            await this.port.logout()
            authSlice.setUser(null)
            Router.go(SIGNIN)
        } catch (e: unknown) {
            console.error('Ошибка при выходе из системы:', e)
        }
    }
}

export default new AuthFeatureController()
