// Композиция фич (stage 4; stage 7 — режимные порты): связывание межфичевых
// зависимостей. Этот файл — не часть конкретной фичи, поэтому cross-feature-связи
// здесь легальны (guard проверяет features/<name> → features/<other>).
// Порты выбираются по env.mode в features/<name>/api/index.ts.

import authController from './auth/controller.ts'
import { authModule } from './auth/module.ts'
import ChatsController, { setContactsIntegration } from './chats/controller.ts'
import { chatsModule } from './chats/module.ts'
import { ProfileFeatureController, setProfileController } from './profile/controller.ts'
import { profilePort } from './profile/api/index.ts'
import { profileModule } from './profile/module.ts'
import { aiAssistantModule } from './ai-assistant/module.ts'
import { contactsModule } from './contacts/module.ts'
import contactsController, { setChatOpener } from './contacts/controller.ts'
import Router from '../utils/Router.ts'
import { MESSENGER } from '../utils/constants.ts'
import type { AppModule } from '../core/module/types.ts'

// logout принадлежит auth-фиче — профиль получает его инъекцией через порт.
setProfileController(new ProfileFeatureController(
    profilePort,
    () => authController.logout()
))

// Открытие диалога принадлежит chats-фиче — contacts получает его той же
// инъекцией: выбрать чат, подтянуть состав участников, уйти в мессенджер.
setChatOpener((chatId) => {
    ChatsController.selectChat(chatId)
    void ChatsController.getChatUsers(chatId)
    Router.go(MESSENGER)
})

// Контакты принадлежат contacts-фиче — меню участника чата (chats) получает
// их той же инъекцией: добавить контакт и обновить слайс для условного
// пункта «Добавить в контакты» (consumer-side шов в chats/controller).
setContactsIntegration({
    addContact: (userId) => contactsController.addContact(userId),
    refreshContacts: () => contactsController.fetchContacts(),
})

export const featureModules: AppModule[] = [authModule, chatsModule, profileModule, aiAssistantModule, contactsModule]
