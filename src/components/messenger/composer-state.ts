// Память композера между пересозданиями Messenger-инстанса (NEXT п.3,
// 2026-11-09): mapStateToProps страницы чатов строит новый список чатов
// на каждый стор-эмит, страница перерисовывается и chat.hbs пересоздаёт
// Messenger (registerComponent без cacheKey) — инстансные поля черновика
// и фокуса умирали вместе со старым инстансом: входящее сообщение и
// bot_delta-дельта стирали набираемый текст и роняли фокус. Узор
// feed-scroll: один слот с chatId-меткой, переживающий каскад. Слот
// применяется только при совпадении чата (черновик не переезжает в
// другой контекст); смена чата затирает его первым же componentDidUpdate
// нового инстанса. Каскадный пин — chat.test.ts, юнит-пин Messenger —
// messenger.test.ts (живой инстанс там подписан на стор напрямую).

export interface ComposerState {
    draft: string
    selection: [number, number] | null
}

const EMPTY_STATE: ComposerState = { draft: '', selection: null }

let slot: { chatId: number, state: ComposerState } | null = null

export function saveComposerState(chatId: number, state: ComposerState): void {
    slot = { chatId, state }
}

export function clearComposerState(): void {
    slot = null
}

export function loadComposerState(chatId: number): ComposerState {
    if (slot == null || slot.chatId !== chatId) {
        return EMPTY_STATE
    }

    return slot.state
}
