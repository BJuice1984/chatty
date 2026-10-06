// Фича-контроллер auth (stage 3; stage 7 — порт по умолчанию из режимных адаптеров):
// бизнес-логика за портом. Реализация порта по умолчанию — адаптер, выбранный
// по env.mode в ./api/index.ts (practicum / own).

import Router from '../../utils/Router.ts'
import { MESSENGER, PROFILE, SIGNIN } from '../../utils/constants.ts'
import { authPort } from './api/index.ts'
import type { AuthPort, SignInRequest, SignUpRequest } from './ports.ts'
import { authSlice } from './store.ts'

export class AuthFeatureController {
    private readonly port: AuthPort

    constructor(port: AuthPort = authPort) {
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
