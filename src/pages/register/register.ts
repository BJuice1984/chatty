import Block from '../../core/Block.ts'
import template from './register.hbs'
import {
    SIGNIN,
    loginValidationMessage,
    mailValidationMessage,
    nameValidationMessage,
    passwordValidationMessage,
    phoneValidationMessage,
} from '../../utils/constants.ts'
import {
    loginValidator,
    mailValidator,
    nameValidator,
    passwordValidator,
    phoneValidator,
} from '../../utils/validators.ts'
import Router from '../../utils/Router.ts'
import { SignupData } from '../../api/AuthApi.ts'
import AuthController from '../../controllers/AuthController.ts'

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
                    label: 'Login',
                    name: 'login',
                    validate: loginValidator,
                    validateMessage: loginValidationMessage,
                },
                {
                    label: 'First Name',
                    name: 'first_name',
                    validate: nameValidator,
                    validateMessage: nameValidationMessage,
                },
                {
                    label: 'Last Name',
                    name: 'second_name',
                    validate: nameValidator,
                    validateMessage: nameValidationMessage,
                },
                {
                    label: 'Phone Number',
                    name: 'phone',
                    validate: phoneValidator,
                    validateMessage: phoneValidationMessage,
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
                    handleSubmitClick: (value: SignupData) => {
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
