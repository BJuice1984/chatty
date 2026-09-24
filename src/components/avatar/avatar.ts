import Block from '../../core/Block.ts'
import template from './avatar.hbs'

interface AvatarProps {
    avatar: string
    [key: string]: unknown
}

export class Avatar extends Block<AvatarProps> {
    constructor(props: AvatarProps) {
        super({
            ...props,
            onClick: () => {
                this.refs.fileInput.element?.click()
            },
            extraClass: 'chat__container-profile-img_type_change-profile',
            input: {
                name: 'avatar',
                id: 'user',
                type: 'file',
                extraClass: 'input__element_type_hide',
            },
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
