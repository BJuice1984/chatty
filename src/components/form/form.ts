import Block from '../../core/Block.ts'
import template from './form.hbs'

export interface FormInputs {
    label: string
    name: string
    validateMessage: string
    // eslint-disable-next-line no-unused-vars
    validate: (value: string) => boolean
}

export interface FormButton {
    label: string
    classType: string
    onClick?: () => void
    // eslint-disable-next-line no-unused-vars
    handleSubmitClick?: (value: { [key: string]: unknown }) => void
}

interface FormRefs {
    [name: string]: {
        getValue: () => string
        // eslint-disable-next-line no-unused-vars
        setValue: (value: string) => void
    }
}

interface FormProps {
    inputs: FormInputs[]
    buttons: FormButton[]
    user: {
        [key: string]: string
    }
    [key: string]: unknown
}

export class Form extends Block<FormProps> {
    constructor(props: FormProps) {
        super({
            ...props,
            events: {
                submit: (e: { preventDefault: () => void }) => {
                    e.preventDefault()

                    if (this._validateInputs()) {
                        console.log('Форма ДА!')

                        const buttonWithHandleClick: Partial<FormButton> | undefined =
                            this.props.buttons.find(
                                (button: FormButton) => button.handleSubmitClick
                            )

                        if (buttonWithHandleClick && this.element instanceof HTMLFormElement) {
                            if (buttonWithHandleClick.handleSubmitClick) {
                                const formData = this._serializeForm(this.element)

                                buttonWithHandleClick.handleSubmitClick(formData)
                            }
                        }
                    } else {
                        console.log('Форма НЕ!')
                    }
                },
            },
        })

        if (props.user != null) {
            this._setProfile()
        }
    }

    _setProfile() {
        Object.fromEntries(
            this.props.inputs.map(({ name }) => [
                name,
                this.refs[name as keyof FormRefs].setValue?.(this.props.user[name] ?? ''),
            ])
        )
    }

    _validateInputs(): boolean {
        const formValues: Record<string, string> = Object.fromEntries(
            this.props.inputs.map(({ name }) => [
                name,
                this.refs[name as keyof FormRefs]?.getValue?.() ?? '',
            ])
        )

        for (const input of this.props.inputs) {
            const inputValue = formValues[input.name]

            if (!input.validate(inputValue)) {
                console.log(`Ошибка валидации на ${input.name}`)

                return false
            }
        }

        return true
    }

    _serializeForm(formNode: HTMLFormElement): Record<string, string> {
        const { elements } = formNode

        const data = Array.from(elements)
            .filter(item => Boolean((item as HTMLInputElement).name))
            .reduce<Record<string, string>>((acc, element) => {
                const { name, value } = element as HTMLInputElement

                acc[name] = value

                return acc
            }, {})

        return data
    }

    render() {
        return this.compile(template, this.props)
    }
}
