// Модуль фичи profile (stage 4): единица регистрации в приложении.

import type { AppModule } from '../../core/module/types.ts'

export const profileModule: AppModule = {
    name: 'profile',
    deps: ['auth'],
}
