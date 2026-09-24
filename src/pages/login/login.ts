import { SigninData } from '../../api/AuthApi.ts'
import AuthController from '../../controllers/AuthController.ts'
import Block from '../../core/Block.ts'
import Router from '../../utils/Router.ts'
import { SIGNUP, loginValidationMessage, passwordValidationMessage } from '../../utils/constants.ts'
import { loginValidator, passwordValidator } from '../../utils/validators.ts'
import template from './login.hbs'

export class LoginPage extends Block {
    constructor() {
        super({
            inputs: [
                {
                    label: 'Login (Required)',
                    name: 'login',
                    validate: loginValidator,
                    validateMessage: loginValidationMessage,
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
                    handleSubmitClick: (value: SigninData) => {
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
