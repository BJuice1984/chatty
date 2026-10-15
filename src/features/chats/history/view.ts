// Статус-строка истории (stage 11): саморегистрирующийся компонент-хелпер
// ChatHistory для messenger.hbs — кнопка «загрузить ещё»/loading/error/empty
// и событие load-more (клик уходит в контроллер истории). Компоненты не
// импортируют фичи (guard-блокер), поэтому модуль сам встраивается в бандл:
// его грузят ws-адаптеры own/practicum за merge/курсором.

import Block from '../../../core/Block.ts'
import Handlebars from 'handlebars'
import { registerComponent } from '../../../core/registerComponent.ts'
import { AppState, ComponentProps, withStore } from '../../../utils/Store.ts'
import { chatHistoryController } from './controller.ts'
import { chatHistorySlice } from './store.ts'

// Inline-шаблон, а не view.hbs: модуль транзитивно грузится из ws-адаптеров
// (gateway → own/practicum → этот файл), которые входят в граф mocha-тестов
// без .hbs-погрузчика. Handlebars.compile — тот же инстанс Handlebars, что у
// registerComponent, так что хелпер-композиция идентична прод-сборке.
const template = Handlebars.compile(`<li class="chat-history" data-testid="chat-history">
  {{#if isLoading}}<p class="chat-history__status" data-testid="chat-history-loading">Загружаем сообщения…</p>
  {{else if isError}}<p class="chat-history__error" role="alert" data-testid="chat-history-error">{{error}}</p><button type="button" class="chat-history__more" data-testid="chat-history-retry">Попробовать снова</button>
  {{else if hasMore}}<button type="button" class="chat-history__more" data-testid="chat-history-more">Загрузить ещё</button>
  {{/if}}
</li>`)

interface ChatHistoryViewProps {
    chatId: number | null
    isLoading: boolean
    hasMore: boolean
    error: string
    isError: boolean
    [key: string]: unknown
}

// Слайс истории текущего выбранного чата (selectedChat из общего состояния).
function mapHistoryState(state: AppState) {
    const chatId = state.selectedChat ?? null
    const history = chatId !== null ? chatHistorySlice.getHistory(chatId) : undefined
    const error = history?.error ?? ''

    return {
        chatId,
        isLoading: history?.isLoading ?? false,
        hasMore: history?.hasMore ?? false,
        error,
        isError: error !== '',
    }
}

class ChatHistoryBase extends Block {
    constructor(props: ChatHistoryViewProps) {
        super({
            ...props,
            // Клик по любой кнопке строки (ещё/повтор) — это load-more.
            events: {
                click: (event: Event) => {
                    const target = event.target as HTMLElement | null

                    if (target?.closest('button') == null) {
                        return
                    }

                    const chatId = this.props.chatId

                    if (typeof chatId === 'number' && Number.isInteger(chatId)) {
                        chatHistoryController.loadOlder(chatId)
                    }
                },
            } as unknown as Record<string, () => void>,
        })
    }

    render() {
        return this.compile(template, this.props)
    }
}

export const ChatHistory = withStore(
    // eslint-disable-next-line no-unused-vars
    mapHistoryState as unknown as (state: AppState) => ComponentProps
)(ChatHistoryBase as typeof Block)

// Саморегистрация: messenger.hbs встраивает хелпер тройными скобками по
// идиоме {{{ Messenger ... }}} — до выбора чата/без истории строка пустая.
registerComponent('ChatHistory', ChatHistory as typeof Block)
