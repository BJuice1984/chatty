// Типизированные контракты модульного ядра (stage 3).
// Слой core не зависит ни от чего: контракты самодостаточны.

// Заготовка композиционного корня: stage 4+ расширит (роуты, компоненты, слайсы).
export type AppContext = Record<string, unknown>

export interface AppModule {
    // Уникальное имя фичи; повторная регистрация — ошибка.
    readonly name: string
    // Имена модулей, которые должны быть инициализированы раньше.
    readonly deps?: readonly string[]
    // Инициализация фичи; вызывается registry в топологическом порядке.
    // eslint-disable-next-line no-unused-vars
    readonly setup?: (context: AppContext) => void
}
