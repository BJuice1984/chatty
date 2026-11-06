// Feature-страница регистрации (stage 3): за границей фичи auth.
// Own-контракт бэкенда — Credentials {email, password}: форма несёт только
// email, пароль и подтверждение (cutover 2026-10-16; login/имя/телефон
// курсного контракта убраны вместе с ним).
// authError из стора — ошибка последнего запроса (сервер недоступен, отказ
// бэкенда): показываем под формой, иначе сбой выглядит как «кнопка молчит».
// 2026-11-07-auth-session-ux: (1) на время полёта signup submit-кнопка
// disabled с лейблом «Signing up…», Enter-сабмит гвардится пропсом;
// (2) введённые значения переживают перерисовку ошибкой/лоадером —
// страница снимает живые value со старого DOM в componentDidUpdate
// и возвращает их в render (инпуты пересоздаются с нуля).

import Block from '../../../../core/Block.ts'
import Router from '../../../../utils/Router.ts'
import { AppState, withStore } from '../../../../utils/Store.ts'
import { SIGNIN, mailValidationMessage, passwordValidationMessage } from '../../../../utils/constants.ts'
import { mailValidator, passwordValidator } from '../../../../utils/validators.ts'
import AuthController from '../../controller.ts'
import type { FormButton, FormInputs } from '../../../../components/form/form.ts'
import type { SignUpRequest } from '../../ports.ts'
import template from './register.hbs'

interface RegisterPageProps {
    authError?: string | null
    authLoading?: boolean
}

class RegisterPageBase extends Block {
    // Черновик инпутов: живые значения, снятые со старого DOM перед
    // перерисовкой; переживают store-обновления, сбрасываются только
    // ремонтом страницы (навигация). Ленивая инициализация: первый render
    // зовётся из super() ДО инициализаторов полей класса
    private draft: Record<string, string> | undefined

    private draftMap(): Record<string, string> {
        this.draft ??= {}

        return this.draft
    }

    // Пропсы from store прокидываем в super: withStore кладёт initialState
    // в аргумент конструктора, и конструктор без параметров затирал бы
    // authError, записанный в стор ДО монтирования страницы (bootstrap
    // /auth/me при лежащем сервере) — ошибка показывалась бы только после
    // первого сабмита, когда работает уже подписка storeHandler
    constructor(props: RegisterPageProps = {}) {
        super({
            authError: props.authError ?? null,
            authLoading: props.authLoading === true,
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
                        // гвард полёта: submit-событие доезжает до Form
                        // независимо от disabled-атрибута кнопки (Enter)
                        if (this.props.authLoading === true) {
                            return
                        }

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

    protected componentDidUpdate(): boolean {
        // старый DOM ещё жив: снимаем введённое до замены узлов
        const draft = this.draftMap()

        this.element?.querySelectorAll<HTMLInputElement>('input[name]').forEach(input => {
            draft[input.name] = input.value
        })

        return true
    }

    private inputsWithDraft(): FormInputs[] {
        const inputs = this.props.inputs as FormInputs[]
        const draft = this.draftMap()

        return inputs.map(input => ({ ...input, value: draft[input.name] ?? '' }))
    }

    private buttonsWithFlightState(): FormButton[] {
        const buttons = this.props.buttons as FormButton[]
        const loading = this.props.authLoading === true

        return buttons.map(button =>
            button.type === 'submit'
                ? { ...button, label: loading ? 'Signing up…' : button.label, disabled: loading }
                : button
        )
    }

    render() {
        return this.compile(template, {
            ...this.props,
            inputs: this.inputsWithDraft(),
            buttons: this.buttonsWithFlightState(),
        })
    }
}

const withAuthState = withStore((state: AppState) => ({
    authError: state.authError ?? null,
    authLoading: state.authLoading === true,
}))

export const RegisterPage = withAuthState(RegisterPageBase as typeof Block)
