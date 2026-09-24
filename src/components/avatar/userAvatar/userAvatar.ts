import Block from '../../../core/Block.ts'
import template from './userAvatar.hbs'

interface UserAvatarProps {
    onClick?: () => void
    avatar: string
    [key: string]: unknown
}

export class UserAvatar extends Block<UserAvatarProps> {
    constructor(props: UserAvatarProps) {
        super({
            ...props,
            events: {
                click: props.onClick,
            },
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
