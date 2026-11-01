// Порты фичи auth (stage 3): контракт, за которым скрыто поведение.
// Порты самодостаточны — не импортируют ничего (и тем более не вверх по слоям).
// Реализация — own-адаптер (./api/own.ts); AuthUser сохраняет полную форму
// исторического контракта — own-адаптер заполняет недостающие поля пустышками
// (2026-11-01-settings: display_name/phone/send_read_receipts теперь РЕАЛЬНЫЕ
// поля бэкенда с фолбэками на уровне адаптера).

export interface AuthUser {
    id: number
    login: string
    email: string
    first_name: string
    second_name: string
    display_name: string
    phone: string
    avatar: string
    // серверный флаг «отправлять отчёты о прочтении» (тумблер приватности):
    // own-адаптер дефолтит true, когда ответ поля не несёт
    send_read_receipts: boolean
}

export interface SignInRequest {
    login: string
    password: string
}

// Контракт регистрации = Credentials бэкенда (email + password ≥ 12);
// confirm_password — поле формы, в запрос не входит (own-адаптер отбрасывает).
export interface SignUpRequest {
    email: string
    password: string
    confirm_password: string
}

export interface AuthPort {
    // eslint-disable-next-line no-unused-vars
    signin(data: SignInRequest): Promise<void>
    // eslint-disable-next-line no-unused-vars
    signup(data: SignUpRequest): Promise<void>
    me(): Promise<AuthUser>
    logout(): Promise<void>
}
