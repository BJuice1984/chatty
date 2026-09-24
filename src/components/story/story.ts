import Block from '../../core/Block.ts'
import template from './story.hbs'

interface StoryProps {
    owner: string
    extraClass?: string
    src: string
    alt: string
}

export class Story extends Block {
    constructor(props: StoryProps) {
        super({
            ...props,
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
