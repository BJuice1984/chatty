import { SearchUserData } from '../../api/UserApi.ts'
import ChatsController from '../../controllers/ChatsController.ts'
import UserController from '../../controllers/UserController.ts'
import Block from '../../core/Block.ts'
import { emptyValidationMessage } from '../../utils/constants.ts'
import { emptyValidator } from '../../utils/validators.ts'
import { FormButton, FormInputs } from '../form/form.ts'
import template from './form-container.hbs'

interface FormContainerProps {
    formContainerExtraClass: string
    selectedChat: number
    isShown: boolean
    inputs: FormInputs[]
    buttons: FormButton[]
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
                        const users = await UserController.searchUserByLogin(value)

                        if (users) {
                            await ChatsController.addUsersToChat(users, props.selectedChat)
                            void ChatsController.getChatUsers(props.selectedChat)
                        }
                    },
                },
            ],
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
