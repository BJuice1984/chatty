// Композиция фич (stage 4; stage 7 — режимные порты): связывание межфичевых
// зависимостей. Этот файл — не часть конкретной фичи, поэтому cross-feature-связи
// здесь легальны (guard проверяет features/<name> → features/<other>).
// Порты выбираются по env.mode в features/<name>/api/index.ts.

import authController from './auth/controller.ts'
import { authModule } from './auth/module.ts'
import { chatsModule } from './chats/module.ts'
import { ProfileFeatureController, setProfileController } from './profile/controller.ts'
import { profilePort } from './profile/api/index.ts'
import { profileModule } from './profile/module.ts'
import type { AppModule } from '../core/module/types.ts'

// logout принадлежит auth-фиче — профиль получает его инъекцией через порт.
setProfileController(new ProfileFeatureController(
    profilePort,
    () => authController.logout()
))

export const featureModules: AppModule[] = [authModule, chatsModule, profileModule]
