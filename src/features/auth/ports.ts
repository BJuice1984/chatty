// Порты фичи auth (stage 3): контракт, за которым скрыто поведение.
// Порты самодостаточны — не импортируют ничего (и тем более не вверх по слоям).
// Реализация по умолчанию (Practicum) живёт в controller.ts; own-адаптер — stage 7 (api-cutover).

export interface AuthUser {
    id: number
    login: string
    email: string
    first_name: string
    second_name: string
    display_name: string
    phone: string
    avatar: string
}

export interface SignInRequest {
    login: string
    password: string
}

export interface SignUpRequest {
    login: string
    password: string
    email: string
    first_name: string
    second_name: string
    phone: string
}

export interface AuthPort {
    // eslint-disable-next-line no-unused-vars
    signin(data: SignInRequest): Promise<void>
    // eslint-disable-next-line no-unused-vars
    signup(data: SignUpRequest): Promise<void>
    me(): Promise<AuthUser>
    logout(): Promise<void>
}
