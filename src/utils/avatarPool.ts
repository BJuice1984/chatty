// Пул статических аватаров (own-режим, chats-social): собственный бэкенд не
// хранит аватары пользователей, UI назначает их детерминированно по id —
// один и тот же пользователь всегда получает одну и ту же аватарку в списке
// участников, шапке messenger и профиле.

export const AVATAR_POOL_SIZE = 8

export function avatarPoolUrl(userId: number): string {
    return `/images/avatars/${(userId % AVATAR_POOL_SIZE) + 1}.svg`
}
