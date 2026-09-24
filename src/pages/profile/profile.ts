import Block from '../../core/Block.ts'
import template from './profile.hbs'
import {
    emptyValidationMessage,
    loginValidationMessage,
    mailValidationMessage,
    nameValidationMessage,
    phoneValidationMessage,
} from '../../utils/constants.ts'
import {
    emptyValidator,
    loginValidator,
    mailValidator,
    nameValidator,
    phoneValidator,
} from '../../utils/validators.ts'
import AuthController from '../../controllers/AuthController.ts'
import { withStore } from '../../utils/Store.ts'
import UserController from '../../controllers/UserController.ts'
import { ChangeUserData } from '../../api/UserApi.ts'

export interface Input {
    label: string
    name: string
    validateMessage: string
    // eslint-disable-next-line no-unused-vars
    validate: (value: string) => boolean
}

export interface Button {
    label: string
    classType: string
    type: string
    onClick?: () => void
    // eslint-disable-next-line no-unused-vars
    handleSubmitClick?: (alue: ChangeUserData) => void
}

interface ProfilePageUser {
    first_name: string
    second_name: string
    login: string
    phone: string
    email: string
    display_name: string
    avatar: string
}

interface ProfilePageProps {
    inputs: Input[]
    buttons: Button[]
    user: ProfilePageUser
    [key: string]: unknown
}

class ProfilePageBase extends Block<ProfilePageProps> {
    constructor(propsFromStore: { user: ProfilePageUser }) {
        super({
            user: {
                first_name: propsFromStore.user.first_name,
                second_name: propsFromStore.user.second_name,
                login: propsFromStore.user.login,
                phone: propsFromStore.user.phone,
                email: propsFromStore.user.email,
                display_name: propsFromStore.user.display_name,
                avatar: propsFromStore.user.avatar,
            },
            inputs: [
                {
                    label: 'First Name',
                    name: 'first_name',
                    validate: nameValidator,
                    validateMessage: nameValidationMessage,
                },
                {
                    label: 'Display Name',
                    name: 'display_name',
                    validate: emptyValidator,
                    validateMessage: emptyValidationMessage,
                },
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
            ],
            buttons: [
                {
                    label: 'Submit changes',
                    classType: 'disabled',
                    type: 'submit',
                    handleSubmitClick: (value: ChangeUserData) => {
                        void UserController.changeUserInfo(value)
                    },
                },
                {
                    label: 'Sign out',
                    classType: 'secondary',
                    type: 'button',
                    onClick: () => {
                        void AuthController.logout()
                    },
                },
            ],
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}

const withUser = withStore(state => ({
    user: {
        first_name: state.user?.first_name,
        second_name: state.user?.second_name,
        email: state.user?.email,
        login: state.user?.login,
        phone: state.user?.phone,
        display_name: state.user?.display_name,
        avatar: state.user?.avatar,
    },
}))

export const ProfilePage = withUser(ProfilePageBase as typeof Block)
