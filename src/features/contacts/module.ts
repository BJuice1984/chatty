// Модуль фичи contacts (2026-11-01-contacts): единица регистрации в
// приложении.

import type { AppModule } from '../../core/module/types.ts'

export const contactsModule: AppModule = {
    name: 'contacts',
    deps: ['auth'],
}
