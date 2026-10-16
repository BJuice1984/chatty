// Feature-страница входа (stage 3): за границей фичи auth.
// Own-контракт: поле логина — email (адаптер маппит login → email бэкенда),
// dots/дефисы/плюсы в локальной части разрешены (LIVE-2).

import Block from '../../../../core/Block.ts'
import Router from '../../../../utils/Router.ts'
import { SIGNUP, mailValidationMessage, passwordValidationMessage } from '../../../../utils/constants.ts'
import { mailValidator, passwordValidator } from '../../../../utils/validators.ts'
import AuthController from '../../controller.ts'
import type { SignInRequest } from '../../ports.ts'
import template from './login.hbs'

export class LoginPage extends Block {
    constructor() {
        super({
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
