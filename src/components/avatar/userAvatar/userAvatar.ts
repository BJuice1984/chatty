import Block from '../../../core/Block.ts'
import { fileUrl } from '../../../utils/env.ts'
import template from './userAvatar.hbs'

export interface UserAvatarProps {
    onClick?: () => void
    avatar?: string
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
        const avatar = this.props.avatar

        return this.compile(template, {
            ...this.props,
            // пути, начинающиеся с '/', — статические ассеты приложения
            // (пул аватаров из public/images), их не прогоняем через filesUrl
            // бэкенда — то же правило, что у ChatAvatar
            avatar:
                avatar !== undefined && avatar !== '' && !avatar.startsWith('/')
                    ? fileUrl(avatar)
                    : avatar,
        })
    }
}
