// Общие типы-описания UI (что страницы/компоненты передают в рендереры форм).
// Живут в utils, чтобы и pages, и components могли импортировать их вниз по слоям.

export interface Input {
    label: string
    name: string
    validateMessage: string
    // eslint-disable-next-line no-unused-vars
    validate: (value: string) => boolean
}

export interface Button<T = unknown> {
    label: string
    classType: string
    type: string
    onClick?: () => void
    // eslint-disable-next-line no-unused-vars
    handleSubmitClick?: (value: T) => void
}
