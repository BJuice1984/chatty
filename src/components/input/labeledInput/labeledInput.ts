import Block from '../../../core/Block.ts'
import template from './labeledInput.hbs'

interface LabeledInputProps {
    label: string
    name: string
    // eslint-disable-next-line no-unused-vars
    validate: (value: string) => boolean
    [key: string]: unknown
}

export class LabeledInput extends Block<LabeledInputProps> {
    constructor(props: LabeledInputProps) {
        super({
            ...props,
            onBlur: (e: { target: { value: string } }) =>
                this.refs.error.setProps({ isShown: !props.validate(e.target.value) }),
        })
    }

    getValue() {
        if (typeof this.refs.input.getValue === 'function') {
            return this.refs.input.getValue()
        }

        return ''
    }

    setValue(value: string) {
        if (typeof this.refs.input.setValue === 'function') {
            this.refs.input.setValue(value)
        }
    }

    render() {
        return this.compile(template, this.props)
    }
}
