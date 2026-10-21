// Feature-страница регистрации (stage 3): за границей фичи auth.
// Own-контракт бэкенда — Credentials {email, password}: форма несёт только
// email, пароль и подтверждение (cutover 2026-10-16; login/имя/телефон
// курсного контракта убраны вместе с ним).
// authError из стора — ошибка последнего запроса (сервер недоступен, отказ
// бэкенда): показываем под формой, иначе сбой выглядит как «кнопка молчит».

import Block from '../../../../core/Block.ts'
import Router from '../../../../utils/Router.ts'
import { AppState, withStore } from '../../../../utils/Store.ts'
import { SIGNIN, mailValidationMessage, passwordValidationMessage } from '../../../../utils/constants.ts'
import { mailValidator, passwordValidator } from '../../../../utils/validators.ts'
import AuthController from '../../controller.ts'
import type { SignUpRequest } from '../../ports.ts'
import template from './register.hbs'

interface RegisterPageProps {
    authError?: string | null
}

class RegisterPageBase extends Block {
    // Пропсы from store прокидываем в super: withStore кладёт initialState
    // в аргумент конструктора, и конструктор без параметров затирал бы
    // authError, записанный в стор ДО монтирования страницы (bootstrap
    // /auth/me при лежащем сервере) — ошибка показывалась бы только после
    // первого сабмита, когда работает уже подписка storeHandler
    constructor(props: RegisterPageProps = {}) {
        super({
            authError: props.authError ?? null,
            inputs: [
                {
                    label: 'EMAIL',
                    name: 'email',
                    validate: mailValidator,
                    validateMessage: mailValidationMessage,
                },
                {
                    label: 'Password',
                    name: 'password',
                    validate: passwordValidator,
                    validateMessage: passwordValidationMessage,
                },
                {
                    label: 'Confirm Password',
                    name: 'confirm_password',
                    validate: passwordValidator,
                    validateMessage: passwordValidationMessage,
                },
            ],
            buttons: [
                {
                    label: 'Sign up',
                    classType: 'disabled',
                    type: 'submit',
                    handleSubmitClick: (value: SignUpRequest) => {
                        void AuthController.signup(value)
                    },
                },
                {
                    label: 'Sign in',
                    classType: 'secondary',
                    type: 'button',
                    onClick: () => {
                        Router.go(SIGNIN)
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

export const RegisterPage = withAuthError(RegisterPageBase as typeof Block)
