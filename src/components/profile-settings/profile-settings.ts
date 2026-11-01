// Пункт сайдбара настроек (2026-11-01-settings): стал кликабельным — onClick
// ведёт страницу настроек в свою секцию, активный пункт подсвечен
// модификатором _active. Колбэк читается из this.props на момент клика
// (LIVE-7): страница перерисовывается, замыкание конструктора устарело бы.

import Block from '../../core/Block.ts'
import template from './profile-settings.hbs'

interface ProfileSettingsItemProps {
    // человекочитаемое имя пункта (хэш-ключи шаблона: setting-name и т.д.)
    'setting-name'?: string
    'setting-img-src'?: string
    'setting-alt'?: string
    onClick?: () => void
    isActive?: boolean
    [key: string]: unknown
}

export class ProfileSettingsItem extends Block<ProfileSettingsItemProps> {
    constructor(props: ProfileSettingsItemProps) {
        super({
            ...props,
            events: {
                click: () => {
                    this.props.onClick?.()
                },
            } as unknown as Record<string, () => void>,
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
