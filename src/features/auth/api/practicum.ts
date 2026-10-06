// Practicum-адаптер порта auth (stage 7): код legacy AuthApi, перенесённый
// на HTTPTransport с env-URL (endpoint'ы сохранены 1:1: /signin, /signup,
// /user, /logout). DTO Практикума несут index-сигнатуры и не объявляют
// display_name — мост через unknown, как в stage 3.

import HTTPTransport from '../../../utils/HTTPTransport.ts'
import type { AuthPort, SignInRequest, SignUpRequest } from '../ports.ts'

const http = new HTTPTransport('/auth')

export const practicumAuthPort: AuthPort = {
    async signin(data: SignInRequest) {
        await http.post('/signin', { data: { ...data } })
    },
    async signup(data: SignUpRequest) {
        await http.post('/signup', { data: { ...data } })
    },
    // runtime-ответ Практикума содержит display_name, хотя DTO его не объявляет
    me: () => http.get('/user'),
    async logout() {
        await http.post('/logout')
    },
}
