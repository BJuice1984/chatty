import Block from '../../core/Block.ts'
import template from './profile-settings.hbs'

interface ProfileSettingsItemProps {
    label: string
    name: string
    data: string
}

export class ProfileSettingsItem extends Block {
    constructor(props: ProfileSettingsItemProps) {
        super({
            ...props,
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
