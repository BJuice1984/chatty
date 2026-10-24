// Модуль фичи auth (stage 3): единица регистрации в приложении.

import type { AppModule } from '../../core/module/types.ts'
import { installAuthGuard } from './guard.ts'

export const authModule: AppModule = {
    name: 'auth',
    setup: () => {
        installAuthGuard()
    },
}
