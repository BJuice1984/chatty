// Живой поиск по чатам (2026-10-26-chat-search): дебаунс-ввод вместо
// декоративного submit. Любой стор-эмит перерисовывает страницу и
// пересоздаёт hbs-детей — видимый текст и фокус живут в модульной
// памяти бара (узор usersScroll/scrollMemory), дебаунс гейтит ТОЛЬКО
// вызов контроллера, но не то, что видит пользователь (review F-2/F-3).

import Block from '../../core/Block.ts'
import template from './searchBar.hbs'

// Дебаунс живого поиска: запрос уходит, когда пользователь перестал
// печатать (прецедент USER_SEARCH_DEBOUNCE_MS в messenger.ts)
export const CHAT_SEARCH_DEBOUNCE_MS = 300

// Модульная память бара: последний ввод и фокус/каретка. Обновляется на
// каждом событии, каждый новый инстанс сеет value из неё — так текст
// переживает пересоздание бара посреди набора
let lastTypedValue = ''
let lastFocus = { wasFocused: false, caret: 0 }
// Висящий таймер дебаунса: перерисовка страницы сиротит старый инстанс
// (hbs-дети пересоздаются без destroy()), поэтому указатель держим в
// модуле — новый ввод перепланирует его, destroy живого бара гасит
let pendingSearchTimer: ReturnType<typeof setTimeout> | null = null

export interface ChatSearchBarMemory {
    value: string
    wasFocused: boolean
    caret: number
}

// Читалка памяти: страница восстанавливает фокус/каретку в CDU по ней
export function getChatSearchBarMemory(): ChatSearchBarMemory {
    return { value: lastTypedValue, ...lastFocus }
}

interface SearchBarProps {
    label: string
    name: string
    value: string
    // eslint-disable-next-line no-unused-vars
    onSearch?: (query: string) => void
    [key: string]: unknown
}

export class SearchBar extends Block<SearchBarProps> {
    constructor(props: Partial<SearchBarProps> = {}) {
        super({
            label: 'Search',
            name: 'chat_search',
            value: lastTypedValue,
            ...props,
            events: {
                // Форма без submit-контролов всё равно сабмитится по Enter
                // (implicit submission) — гасим дефолт, иначе GET-навигация
                // на ?chat_search=... перезагрузит SPA и вытерет состояние
                submit: (event: Event) => {
                    event.preventDefault()
                },
                input: (event: Event) => {
                    this.handleInput(event)
                },
                focusout: (event: Event) => {
                    this.handleFocusOut(event)
                },
            } as unknown as Record<string, () => void>,
        })
    }

    // Ввод: память обновляется мгновенно (каждое событие), контроллер —
    // только по таймеру; пустой ввод тоже стреляет, контроллер сбрасывает
    // поиск без запроса
    private handleInput(event: Event): void {
        const target = event.target as HTMLInputElement | null

        if (target == null || target.name !== this.props.name) {
            return
        }

        const value = target.value

        lastTypedValue = value
        lastFocus = { wasFocused: true, caret: target.selectionStart ?? value.length }

        if (pendingSearchTimer != null) {
            clearTimeout(pendingSearchTimer)
        }

        pendingSearchTimer = setTimeout(() => {
            pendingSearchTimer = null
            this.props.onSearch?.(value)
        }, CHAT_SEARCH_DEBOUNCE_MS)
    }

    // Фокус ушёл по желанию пользователя: следующие перерисовки его не
    // возвращают (focusout — пузырьковый аналог blur для слушателя формы)
    private handleFocusOut(event: Event): void {
        const target = event.target as HTMLInputElement | null

        if (target == null || target.name !== this.props.name) {
            return
        }

        lastFocus = { wasFocused: false, caret: target.selectionStart ?? lastFocus.caret }
    }

    // Пересоздание/уход со страницы: висящий таймер не должен стрелять
    // по мёртвому инстансу
    destroy(): void {
        if (pendingSearchTimer != null) {
            clearTimeout(pendingSearchTimer)
            pendingSearchTimer = null
        }

        super.destroy()
    }

    render() {
        return this.compile(template, this.props)
    }
}
