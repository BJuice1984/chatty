// Композиция фич (stage 4): связывание межфичевых зависимостей.
// Этот файл — не часть конкретной фичи, поэтому cross-feature-связи здесь
// легальны (guard проверяет features/<name> → features/<other>).

import authController from './auth/controller.ts'
import { authModule } from './auth/module.ts'
import { chatsModule } from './chats/module.ts'
import { ProfileFeatureController, practicumProfilePort, setProfileController } from './profile/controller.ts'
import { profileModule } from './profile/module.ts'
import type { AppModule } from '../core/module/types.ts'

// logout принадлежит auth-фиче — профиль получает его инъекцией через порт.
setProfileController(new ProfileFeatureController(
    practicumProfilePort,
    () => authController.logout()
))

export const featureModules: AppModule[] = [authModule, chatsModule, profileModule]
