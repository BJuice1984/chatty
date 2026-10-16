// Feature-страница регистрации (stage 3): за границей фичи auth.
// Own-контракт бэкенда — Credentials {email, password}: форма несёт только
// email, пароль и подтверждение (cutover 2026-10-16; login/имя/телефон
// курсного контракта убраны вместе с ним).

import Block from '../../../../core/Block.ts'
import Router from '../../../../utils/Router.ts'
import { SIGNIN, mailValidationMessage, passwordValidationMessage } from '../../../../utils/constants.ts'
import { mailValidator, passwordValidator } from '../../../../utils/validators.ts'
import AuthController from '../../controller.ts'
import type { SignUpRequest } from '../../ports.ts'
import template from './register.hbs'

export class RegisterPage extends Block {
    constructor() {
        super({
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
