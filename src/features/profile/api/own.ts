// Own-адаптер порта profile (stage 7): собственный бэкенд не предоставляет
// пользовательских профилей (домены — auth/chats/files/WS), поэтому все
// операции порта явно отвергаются. Профиль-UI в own-режиме показывает ошибки
// консоли — это зафиксированное ограничение cutover, а не скрытый отказ.
// Методы синхронно бросают: await на вызове превращает throw в rejected promise.

import type { ProfilePort } from '../ports.ts'

function unsupported(method: string): never {
    throw new Error(`Операция ${method} недоступна в own-режиме: контракт бэкенда её не предоставляет`)
}

export const ownProfilePort: ProfilePort = {
    searchUsersByLogin() {
        unsupported('searchUsersByLogin')
    },
    changeProfile() {
        unsupported('changeProfile')
    },
    changeAvatar() {
        unsupported('changeAvatar')
    },
}
