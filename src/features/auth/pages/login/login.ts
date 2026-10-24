// Feature-страница входа (stage 3): за границей фичи auth.
// Own-контракт: поле логина — email (адаптер маппит login → email бэкенда),
// dots/дефисы/плюсы в локальной части разрешены (LIVE-2).
// authError из стора — ошибка последнего запроса (сервер недоступен, отказ
// бэкенда): показываем под формой, иначе сбой выглядит как «кнопка молчит».

import Block from '../../../../core/Block.ts'
import Router from '../../../../utils/Router.ts'
import { AppState, withStore } from '../../../../utils/Store.ts'
import { SIGNUP, mailValidationMessage, passwordValidationMessage } from '../../../../utils/constants.ts'
import { mailValidator, passwordValidator } from '../../../../utils/validators.ts'
import AuthController from '../../controller.ts'
import type { SignInRequest } from '../../ports.ts'
import template from './login.hbs'

interface LoginPageProps {
    authError?: string | null
}

class LoginPageBase extends Block {
    // Пропсы from store прокидываем в super: withStore кладёт initialState
    // в аргумент конструктора, и конструктор без параметров затирал бы
    // authError, записанный в стор ДО монтирования страницы (bootstrap
    // /auth/me при лежащем сервере) — ошибка показывалась бы только после
    // первого сабмита, когда работает уже подписка storeHandler
    constructor(props: LoginPageProps = {}) {
        super({
            authError: props.authError ?? null,
            inputs: [
                {
                    label: 'Email (Required)',
                    name: 'login',
                    validate: mailValidator,
                    validateMessage: mailValidationMessage,
                },
                {
                    label: 'Password (Required)',
                    name: 'password',
                    validate: passwordValidator,
                    validateMessage: passwordValidationMessage,
                },
            ],
            buttons: [
                {
                    label: 'Sign in',
                    classType: 'primary',
                    type: 'submit',
                    handleSubmitClick: (value: SignInRequest) => {
                        void AuthController.signin(value)
                    },
                },
                {
                    label: 'Sign up',
                    classType: 'secondary',
                    type: 'button',
                    onClick: () => {
                        Router.go(SIGNUP)
                    },
                },
            ],
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}

const withAuthError = withStore((state: AppState) => ({
    authError: state.authError ?? null,
}))

export const LoginPage = withAuthError(LoginPageBase as typeof Block)
