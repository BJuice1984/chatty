import Block from '../../core/Block.ts'
import template from './500.hbs'

export class ServerErrorPage extends Block {
    constructor() {
        super()
    }

    render() {
        return this.compile(template, this.props)
    }
}
