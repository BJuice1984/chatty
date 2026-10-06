// Feature-страница профиля (stage 4): замена src/pages/profile.

import Block from '../../../../core/Block.ts'
import template from './profile.hbs'
import {
    emptyValidationMessage,
    loginValidationMessage,
    mailValidationMessage,
    nameValidationMessage,
    phoneValidationMessage,
} from '../../../../utils/constants.ts'
import {
    emptyValidator,
    loginValidator,
    mailValidator,
    nameValidator,
    phoneValidator,
} from '../../../../utils/validators.ts'
import { withStore } from '../../../../utils/Store.ts'
import { Button, ChangeUserData, Input } from '../../../../utils/types.ts'
import { getProfileController } from '../../controller.ts'

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
    buttons: Button<ChangeUserData>[]
    user: ProfilePageUser
    [key: string]: unknown
}

class ProfilePageBase extends Block<ProfilePageProps> {
    constructor(propsFromStore: { user: ProfilePageUser }) {
        super({
            onUserAvatar: (data: FormData) => {
                void getProfileController().changeUserAvatar(data)
            },
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
                        void getProfileController().changeUserInfo(value)
                    },
                },
                {
                    label: 'Sign out',
                    classType: 'secondary',
                    type: 'button',
                    onClick: () => {
                        void getProfileController().logout()
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
