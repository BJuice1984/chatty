// Карточка контакта адресной книги (2026-11-01-contacts): аватар, имя,
// логин и hover-крест удаления. Компонент презентационный — поведение
// приходит колбэками из пропсов (страница фичи contacts), контроллеров
// компонент не импортирует. Пользовательские данные рендерятся шаблоном
// в двойных скобках — экранирование гарантирует Handlebars.

import Block from '../../core/Block.ts'
import template from './contactItem.hbs'

export interface ContactItemProps {
    // id пользователя-контакта (не строки контактов — контракт ContactInfo)
    id: number
    // display_name: заголовок карточки
    title: string
    // login (полный email): подзаголовок карточки
    subtitle: string
    // аватар уже разрешён адаптером фичи (файл или pool-фолбэк);
    // файловый путь проводит через fileUrl компонент ChatAvatar
    avatar: string
    // клик по карточке (без креста) — меню контакта
    // eslint-disable-next-line no-unused-vars
    onClick?: (id: number) => void
    // клик по hover-кресту — подтверждение удаления
    // eslint-disable-next-line no-unused-vars
    onDelete?: (id: number) => void
    [key: string]: unknown
}

export class ContactItem extends Block<ContactItemProps> {
    constructor(props: ContactItemProps) {
        super({
            ...props,
            events: {
                click: (event: Event) => {
                    const target = event.target as HTMLElement | null
                    const { id, onClick, onDelete } = this.props

                    // крест удаления не открывает меню: сначала свой сценарий
                    if (target?.closest('[data-testid="contact-item-delete"]') != null) {
                        onDelete?.(id)

                        return
                    }

                    onClick?.(id)
                },
            },
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
