import Block from '../../core/Block.ts'
import { emptyValidationMessage } from '../../utils/constants.ts'
import { emptyValidator } from '../../utils/validators.ts'
import template from './searchBar.hbs'

interface SearchBarProps {
    label: string
    name: string
    // eslint-disable-next-line no-unused-vars
    validate: (value: string) => boolean
    validateMessage: string
    classType: string
    type: string
    handleClick: () => void
    [key: string]: unknown
}

export class SearchBar extends Block<SearchBarProps> {
    constructor() {
        super({
            label: 'Search',
            name: 'chat_search',
            validate: emptyValidator,
            validateMessage: emptyValidationMessage,

            classType: 'hidden',
            type: 'submit',
            handleClick: () => {
                console.log('Отправка данных')
            },

            events: {
                submit: (e: { preventDefault: () => void }) => {
                    e.preventDefault()

                    if (this._validateSearchInput()) {
                        console.log('Форма ДА!')
                        this.props.handleClick()

                        if (this.element instanceof HTMLFormElement) {
                            const formData = this._serializeForm(this.element)

                            console.log(formData)
                        } else {
                            console.error('Неверный тип формы')
                        }
                    } else {
                        console.log('Форма НЕ!')
                    }
                },
            },
        })
    }

    _validateSearchInput(): boolean {
        const inputValue = this.refs.chat_search.getValue?.()

        if (inputValue != null && !this.props.validate(inputValue)) {
            return false
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
