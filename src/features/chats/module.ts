// Модуль фичи chats (stage 4): единица регистрации в приложении.

import type { AppModule } from '../../core/module/types.ts'

export const chatsModule: AppModule = {
    name: 'chats',
    deps: ['auth'],
}
