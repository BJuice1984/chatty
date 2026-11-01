// Страница адресной книги (2026-11-01-contacts): упрощённый сайдбар — шапка
// «Контакты» + «Добавить», список карточек, BottomBar (без ленты историй и
// поиска по чатам) — и правая панель-заглушка. Модальное состояние —
// controller-free UI-пропсы (прецедент Messenger): билдер модалки добавления
// переиспользуется из components/messenger (импорт вниз по слоям легален),
// бейдж уже-контакта — «уже в контактах». События делегированы с корня —
// перерисовки пересоздают DOM модалок, а слушатели живут на странице.

import Block from '../../../../core/Block.ts'
import Handlebars from 'handlebars'
import { AppState, ComponentProps, withStore } from '../../../../utils/Store.ts'
import type { ContactInfo } from '../../../../utils/types.ts'
import { USER_SEARCH_DEBOUNCE_MS, renderAddUserModalContent } from '../../../../components/messenger/messenger.ts'
import ContactsController from '../../controller.ts'
import type { ContactSearchResult } from '../../ports.ts'
import template from './contacts.hbs'

interface ContactsPageProps {
    contacts?: ContactInfo[]
    addOpen?: boolean
    addQuery?: string
    addResults?: ContactSearchResult[]
    addFeedback?: string
    menuTarget?: ContactInfo | null
    menuFeedback?: string
    deleteTarget?: ContactInfo | null
    // eslint-disable-next-line no-unused-vars
    onSelectContact?: (id: number) => void
    // eslint-disable-next-line no-unused-vars
    onDeleteContact?: (id: number) => void
    [key: string]: unknown
}

// Экранирование значений в слот-HTML модалок: объекты не строковируем
// (no-base-to-string), примитивы — через строку, остальное — пусто
const escapeHtml = (value: unknown): string => Handlebars.escapeExpression(
    typeof value === 'string' || typeof value === 'number' ? String(value) : ''
)

// Контент меню контакта: «Создать» (get-or-create DM), «Найти все чаты» —
// видимый, но выключенный стаб (реализация поиска по чатам не смержена,
// план 2026-11-01-contacts), «Отмена». Данные экранируются — modal рендерит
// слот без экранирования
const renderContactMenuContent = (feedback: string): string => {
    const feedbackHtml = feedback !== ''
        ? `<p class="modal__feedback" data-testid="contact-menu-feedback">${escapeHtml(feedback)}</p>`
        : ''

    return `<div class="modal__confirm-flow">${feedbackHtml}`
        + '<div class="modal__actions">'
        + '<button type="button" class="modal__button" data-testid="contact-menu-create">Создать</button>'
        + '<button type="button" class="modal__button" data-testid="contact-menu-search" disabled title="пока не реализовано">Найти все чаты</button>'
        + '<button type="button" class="modal__button" data-testid="contact-menu-cancel">Отмена</button>'
        + '</div>'
        + '</div>'
}

// Контент подтверждения удаления: текст с именем контакта и пара кнопок
// (узор renderDeleteModalContent из messenger, инлайн для контактов)
const renderDeleteContactContent = (target: ContactInfo | null | undefined): string => {
    const name = target?.display_name ?? ''

    return ''
        + '<div class="modal__confirm-flow">'
        + `<p class="modal__text" data-testid="delete-contact-text">Удалить контакт «${escapeHtml(name)}»?</p>`
        + '<div class="modal__actions">'
        + '<button type="button" class="modal__button modal__button_danger" data-testid="delete-contact-confirm">Удалить</button>'
        + '<button type="button" class="modal__button" data-testid="delete-contact-cancel">Отмена</button>'
        + '</div>'
        + '</div>'
}

class ContactsPageBase extends Block {
    // таймер дебаунса поиска: живёт на инстансе — перерисовки его не рвут
    private searchDebounce: ReturnType<typeof setTimeout> | null = null

    // фокус в поле поиска после перерисовки по ответу поиска: DOM заменён,
    // возвращаем пользователя туда, где он печатал (идиома Messenger)
    private refocusSearchInput(): void {
        const input = this.element?.querySelector<HTMLInputElement>('[data-testid="user-search-input"]')

        if (input != null) {
            input.focus()

            const end = input.value.length

            input.setSelectionRange(end, end)
        }
    }

    private contactById(id: number): ContactInfo | null {
        const found = ((this.props as ContactsPageProps).contacts ?? []).find(contact => contact.id === id)

        return found ?? null
    }

    constructor(propsFromStore: ContactsPageProps) {
        super({
            ...propsFromStore,
            contacts: propsFromStore.contacts ?? [],
            // controller-free UI-состояние модалок
            addOpen: false,
            addQuery: '',
            addResults: [],
            addFeedback: '',
            menuTarget: null,
            menuFeedback: '',
            deleteTarget: null,
            // клик по карточке (без креста) — меню контакта
            onSelectContact: (id: number) => {
                this.setProps({ menuTarget: this.contactById(id), menuFeedback: '' })
            },
            // клик по hover-кресту — подтверждение удаления
            onDeleteContact: (id: number) => {
                this.setProps({ deleteTarget: this.contactById(id) })
            },
            onCloseAdd: () => {
                this.setProps({ addOpen: false, addResults: [], addFeedback: '' })
            },
            onCloseMenu: () => {
                this.setProps({ menuTarget: null, menuFeedback: '' })
            },
            onCloseDelete: () => {
                this.setProps({ deleteTarget: null })
            },
            // делегирование с корня страницы (узор Messenger): кнопка
            // «Добавить» — сырой <button> в шаблоне, пропсы до него не
            // дотягиваются; модалки рендерятся внутри дерева страницы
            events: {
                click: (event: Event) => {
                    const target = event.target as HTMLElement | null

                    if (target?.closest('[data-testid="contacts-add"]') != null) {
                        this.setProps({ addOpen: true, addResults: [], addFeedback: '' })

                        return
                    }

                    // найденный пользователь: добавляем контакт, фидбек после
                    // ответа; уже-контакты приходят кнопками с disabled
                    const resultButton = target?.closest('[data-testid="user-search-result"]') as HTMLButtonElement | null

                    if (resultButton != null && !resultButton.disabled) {
                        const userId = Number(resultButton.dataset.userId)

                        if (Number.isInteger(userId)) {
                            this.setProps({ addFeedback: 'Добавляем…' })
                            void Promise.resolve(ContactsController.addContact(userId))
                                .then(() => {
                                    this.setProps({ addFeedback: 'Добавлен' })
                                })
                                .catch(() => {
                                    this.setProps({ addFeedback: 'Не удалось добавить контакт' })
                                })
                        }

                        return
                    }

                    if (target?.closest('[data-testid="contact-menu-create"]') != null) {
                        const menuTarget = (this.props as ContactsPageProps).menuTarget

                        if (menuTarget != null) {
                            // успех закрывает меню (переход в мессенджер делает
                            // опенер композиции); отказ — меню остаётся с фидбеком
                            void Promise.resolve(ContactsController.openDm(menuTarget.id))
                                .then(() => {
                                    this.setProps({ menuTarget: null, menuFeedback: '' })
                                })
                                .catch(() => {
                                    this.setProps({ menuFeedback: 'Не удалось создать чат' })
                                })
                        }

                        return
                    }

                    if (target?.closest('[data-testid="contact-menu-cancel"]') != null) {
                        this.setProps({ menuTarget: null, menuFeedback: '' })

                        return
                    }

                    if (target?.closest('[data-testid="delete-contact-confirm"]') != null) {
                        const deleteTarget = (this.props as ContactsPageProps).deleteTarget

                        this.setProps({ deleteTarget: null })

                        if (deleteTarget != null) {
                            void ContactsController.removeContact(deleteTarget.id)
                        }

                        return
                    }

                    if (target?.closest('[data-testid="delete-contact-cancel"]') != null) {
                        this.setProps({ deleteTarget: null })
                    }
                },
                // дебаунс-поиск начала email (узор Messenger): «@» не входит
                // в логин и вырезается из значения; пустой ввод гасит список
                input: (event: Event) => {
                    const target = event.target as HTMLElement | null

                    if (target?.closest('[data-testid="user-search-input"]') == null) {
                        return
                    }

                    const input = target as HTMLInputElement
                    let raw = input.value

                    if (raw.includes('@')) {
                        raw = raw.split('@').join('')
                        input.value = raw
                    }

                    const query = raw

                    if (this.searchDebounce != null) {
                        clearTimeout(this.searchDebounce)
                    }

                    if (query.trim() === '') {
                        this.setProps({ addQuery: '', addResults: [], addFeedback: '' })

                        return
                    }

                    this.searchDebounce = setTimeout(() => {
                        void ContactsController.searchUsers(query.trim())
                            .then(results => {
                                this.setProps({ addQuery: query, addResults: results ?? [] })
                                this.refocusSearchInput()
                            })
                            .catch(() => {
                                this.setProps({ addFeedback: 'Поиск не удался — попробуйте ещё раз' })
                            })
                    }, USER_SEARCH_DEBOUNCE_MS)
                },
            } as unknown as Record<string, () => void>,
        })
    }

    componentDidMount() {
        // список контактов нужен при каждом заходе (идиома LIVE-3 страницы
        // чатов): Router монтирует свежий инстанс на каждый вход в маршрут
        void ContactsController.fetchContacts()
    }

    destroy(): void {
        if (this.searchDebounce != null) {
            clearTimeout(this.searchDebounce)
        }

        super.destroy()
    }

    render() {
        const props = this.props as ContactsPageProps
        const contacts = props.contacts ?? []
        const menuTarget = props.menuTarget ?? null

        return this.compile(template, {
            ...props,
            contacts,
            menuTitle: menuTarget?.display_name ?? '',
            menuOpen: menuTarget != null,
            deleteOpen: (props.deleteTarget ?? null) != null,
            addContent: renderAddUserModalContent({
                addUserQuery: props.addQuery ?? '',
                addUserResults: props.addResults ?? [],
                addUserFeedback: props.addFeedback ?? '',
                memberIds: contacts.map(contact => contact.id),
                alreadyBadge: 'уже в контактах',
            }),
            menuContent: renderContactMenuContent(props.menuFeedback ?? ''),
            deleteContent: renderDeleteContactContent(props.deleteTarget ?? null),
        })
    }
}

// слайс contacts AppState не объявляет — каст-идиом chatSearch/chatHistory:
// чтение приведением внутри фичи, utils/Store.ts не трогаем; пересечение с
// ComponentProps нужно потому, что ключ contacts в интерфейсе не объявлен
const withContacts = withStore((state: AppState): ComponentProps & { contacts: ContactInfo[] } => ({
    contacts: (state as AppState & { contacts?: ContactInfo[] }).contacts ?? [],
}))

export const ContactsPage = withContacts(ContactsPageBase as typeof Block)
