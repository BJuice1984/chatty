// Универсальный модальный слой (stage chats-social): заголовок, контент-слот
// (HTML-строка через тройные скобки), закрытие по крестику, клику по
// бэкдропу и Escape. Содержимое и поведение контента — за владельцем
// (messenger строит сценарии «добавить пользователя» и «удалить чат»),
// модалка отвечает только за оболочку и закрытие.

import Block from '../../core/Block.ts'
import template from './modal.hbs'

interface ModalProps {
    title: string
    // HTML содержимого — рендерится без экранирования (владелец отвечает за
    // экранирование данных, см. renderAddUserModalContent)
    content?: string
    isOpen?: boolean
    onClose?: () => void
    [key: string]: unknown
}

export class Modal extends Block {
    constructor(props: ModalProps) {
        super({
            ...props,
            events: {
                // делегирование с корня: закрывают только крестик и бэкдроп,
                // клик внутри диалога (включая кнопки контента) не закрывает
                click: (event: Event) => {
                    const target = event.target as HTMLElement | null

                    if (target?.closest('[data-testid="modal-close"], [data-testid="modal-backdrop"]') != null) {
                        (this.props as ModalProps).onClose?.()
                    }
                },
                // Escape: слушатель на корне — срабатывает при фокусе внутри
                // модалки (инпут поиска/кнопки доступны с клавиатуры)
                keydown: (event: Event) => {
                    if ((event as KeyboardEvent).key === 'Escape') {
                        (this.props as ModalProps).onClose?.()
                    }
                },
            } as unknown as Record<string, () => void>,
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}
