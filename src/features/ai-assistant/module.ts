// Модуль фичи AI-ассистента (stage 10): единица регистрации в приложении.
// Компоненты регистрируются импортом страницы (маршрут подключается в
// main.ts), дополнительной инициализации модулю не требуется.

import type { AppModule } from '../../core/module/types.ts'

export const aiAssistantModule: AppModule = {
    name: 'ai-assistant',
    setup: () => {
        // Регистрация компонентов происходит на импорте страницы — см.
        // pages/assistant.ts (registerComponent для TypingIndicator и
        // DocumentCard), поэтому setup пуст по контрактам композиции.
    },
}
