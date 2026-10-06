// Practicum-адаптер порта profile (stage 7): код legacy UserApi, перенесённый
// на HTTPTransport с env-URL (endpoint'ы 1:1: /search, /profile, /profile/avatar).
// HTTPMethod транспорта типизирован Promise<never> — присваивается в контракт
// порта без кастов.

import HTTPTransport from '../../../utils/HTTPTransport.ts'
import type { ChangeUserData, SearchUserData } from '../../../utils/types.ts'
import type { ProfilePort } from '../ports.ts'

const http = new HTTPTransport('/user')

export const practicumProfilePort: ProfilePort = {
    searchUsersByLogin: (data: SearchUserData) => http.post('/search', { data: { ...data } }),
    changeProfile: (data: ChangeUserData) => http.put('/profile', { data: { ...data } }),
    changeAvatar: (data: FormData) => http.put('/profile/avatar', { data }),
}
