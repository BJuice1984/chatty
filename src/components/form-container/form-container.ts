// Форма добавления пользователя в чат (stage 4): поиск и добавление —
// колбэк из пропсов (фича chats через Messenger), без импорта контроллеров.

import Block from '../../core/Block.ts'
import { emptyValidationMessage } from '../../utils/constants.ts'
import { emptyValidator } from '../../utils/validators.ts'
import type { SearchUserData } from '../../utils/types.ts'
import { FormButton, FormInputs } from '../form/form.ts'
import template from './form-container.hbs'

interface FormContainerProps {
    formContainerExtraClass: string
    selectedChat: number
    isShown: boolean
    inputs: FormInputs[]
    buttons: FormButton[]
    // eslint-disable-next-line no-unused-vars
    onAddUser?: (login: SearchUserData, chatId: number) => Promise<void>
}

export class FormContainer extends Block {
    constructor(props: FormContainerProps) {
        super({
            ...props,
            inputs: [
                {
                    label: 'type user name',
                    name: 'login',
                    validate: emptyValidator,
                    validateMessage: emptyValidationMessage,
                },
            ],
            buttons: [
                {
                    label: 'add user',
                    classType: 'primary',
                    type: 'submit',
                    handleSubmitClick: async (value: SearchUserData) => {
                        await props.onAddUser?.(value, props.selectedChat)
                    },
                },
            ],
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
