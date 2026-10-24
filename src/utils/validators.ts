export const loginValidator = (value: string) => {
    return /^[\w-]{3,20}$/.test(value)
}

export const nameValidator = (value: string) => {
    // eslint-disable-next-line regexp/no-obscure-range
    return /^[A-ZА-Я][a-zA-ZА-Я-]*$/.test(value)
}

export const passwordValidator = (value: string) => {
    // Минимум 12 — контракт собственного бэкенда (Credentials): короче он
    // всё равно отвергает, валидация не должна обещать иное
    return /^(?=.*[A-Z])(?=.*\d).{12,40}$/.test(value)
}

export const phoneValidator = (value: string) => {
    return /^\+?\d{10,15}$/.test(value)
}

export const mailValidator = (value: string) => {
    // Локальная часть допускает точки/дефисы/плюсы (manual.smoke2@…);
    // пробелы по краям (частый копипаст) не валят поле — триммим при отправке
    return /^[\w.%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.trim())
}

export const emptyValidator = (value: string) => {
    return !/^\s*$/.test(value)
}
