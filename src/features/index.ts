// Композиция фич (stage 4; stage 7 — режимные порты): связывание межфичевых
// зависимостей. Этот файл — не часть конкретной фичи, поэтому cross-feature-связи
// здесь легальны (guard проверяет features/<name> → features/<other>).
// Порты выбираются по env.mode в features/<name>/api/index.ts.

import authController from './auth/controller.ts'
import { authModule } from './auth/module.ts'
import { installAuthTransportPolicy } from './auth/transportPolicy.ts'
import ChatsController, { setContactsIntegration, setDocumentSearch } from './chats/controller.ts'
import { chatsModule } from './chats/module.ts'
import { installConnectivityWatchers } from './chats/ws/connectivity.ts'
import { ProfileFeatureController, setProfileController, setProfileSeams } from './profile/controller.ts'
import { profilePort } from './profile/api/index.ts'
import { profileModule } from './profile/module.ts'
import { aiAssistantModule } from './ai-assistant/module.ts'
import { searchChatDocumentHits } from './ai-assistant/documents.ts'
import { contactsModule } from './contacts/module.ts'
import contactsController, { setChatOpener, setChatSearchOpener } from './contacts/controller.ts'
import { setChatSearchBarValue } from '../components/searchBar/searchBar.ts'
import Router from '../utils/Router.ts'
import { MESSENGER } from '../utils/constants.ts'
import type { AppModule } from '../core/module/types.ts'

// Глобальная политика повторов транспорта (2026-11-03-auth-refresh-retry):
// 401 → single-flight refresh + повтор, неудачный refresh → локальный выход,
// 5xx → лестница повторов; оверлей владеется только политикой
installAuthTransportPolicy()

// Браузерный offline/online (2026-11-04-bot-wait-offline): offline —
// reconnect-оверлей, online — гашение + force-дроп застрявших backoff'ов
// (чаты + stories) + рефетч списка с Connected-ресинком. Auth-прогрев
// сознательно нет (review F-4): stale access лечит глобальная 401-политика
installConnectivityWatchers()

// Контроллер профиля зависит только от своего порта.
setProfileController(new ProfileFeatureController(profilePort))

// Межфичевые швы профиля (2026-11-01-settings): свежесть пользователя и выход
// принадлежат auth-фиче, возврат в архивированный чат — chats-фиче; профиль
// получает их consumer-side сеттером (до связывания — noop).
setProfileSeams({
    refreshUser: () => authController.fetchUser(),
    logout: () => authController.logout(),
    rejoinChat: chatId => ChatsController.rejoinChat(chatId),
})

// Открытие диалога принадлежит chats-фиче — contacts получает его той же
// инъекцией: выбрать чат, подтянуть состав участников, уйти в мессенджер.
setChatOpener((chatId) => {
    ChatsController.selectChat(chatId)
    void ChatsController.getChatUsers(chatId)
    Router.go(MESSENGER)
})

// «Найти все чаты» (2026-11-05-messenger-ux-pack): '@'-поиск по логину
// контакта — тоже chats-фича, contacts получает её инъекцией. Сид бара
// ставится ДО перехода, чтобы мессенджер встретил пользователя готовым
// запросом (инстанс бара сеет value из модульной памяти); поиск уходит
// сырой строкой '@'+login — сервер сам различает '@'-ветку по префиксу
setChatSearchOpener((login) => {
    setChatSearchBarValue(`@${login}`)
    void ChatsController.searchChats(`@${login}`)
    Router.go(MESSENGER)
})

// Контакты принадлежат contacts-фиче — меню участника чата (chats) получает
// их той же инъекцией: добавить контакт и обновить слайс для условного
// пункта «Добавить в контакты» (consumer-side шов в chats/controller).
setContactsIntegration({
    addContact: (userId) => contactsController.addContact(userId),
    refreshContacts: () => contactsController.fetchContacts(),
})

// RAG-поиск принадлежит ai-assistant — чаты получают им список найденных
// документов с настоящими именами под ответом бота (consumer-side шов)
setDocumentSearch({
    search: (chatId, query, topK) => searchChatDocumentHits(chatId, query, topK),
})

export const featureModules: AppModule[] = [authModule, chatsModule, profileModule, aiAssistantModule, contactsModule]
