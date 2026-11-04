// Наблюдатель браузерного offline/online (2026-11-04-bot-wait-offline):
// до этого никто не слушал window offline/online и navigator.onLine —
// WSTransport исчерпал bounded-реконнект за долгий офлайн и оставался мёртв
// до F5. Offline показывает reconnect-оверлей; online гасит его,
// принудительно роняет застрявшие в backoff сокеты (чаты + stories — гард
// повторного connect иначе молчит в mid-backoff окне, review F-7) и
// рефетчит список: fetchChats переоткроет все чаты, Connected-ресync
// адаптера догонит хвосты истории (дедуп по id уже есть). Auth-«прогрев»
// НЕ делается (review F-4): протухший access лечится глобальной политикой
// 401→refresh, features/auth не трогаем.
//
// Связывание — в композиционном корне (features/index.ts); установка
// идемпотентна (повторный вызов не добавляет второй набор слушателей).

import { hideBusyOverlay, showBusyOverlay } from '../../../utils/busyOverlay.ts'
import ChatsController from '../controller.ts'
import { reconnectAllChatSockets } from './gateway.ts'
import { reconnectStoriesSocket } from '../stories/ws/own.ts'

let offlineHandler: (() => void) | null = null
let onlineHandler: (() => void) | null = null

// navigator.onLine === false на бинде не запускает online-путь: слушатели
// только вешаются — действия начинаются с событий (первый offline покажет
// оверлей, первый online — восстановит)
export function installConnectivityWatchers(): void {
    if (offlineHandler !== null) {
        return
    }

    offlineHandler = () => {
        showBusyOverlay('reconnect')
    }

    onlineHandler = () => {
        hideBusyOverlay()
        reconnectAllChatSockets()
        reconnectStoriesSocket()
        void ChatsController.fetchChats()
    }

    window.addEventListener('offline', offlineHandler)
    window.addEventListener('online', onlineHandler)
}

// Тестовый хук (прецедент resetBusyOverlayForTests): снимает слушатели и
// разрешает чистую переустановку между сценариями
export function resetConnectivityWatchersForTests(): void {
    if (offlineHandler !== null) {
        window.removeEventListener('offline', offlineHandler)
    }

    if (onlineHandler !== null) {
        window.removeEventListener('online', onlineHandler)
    }

    offlineHandler = null
    onlineHandler = null
}
