# Слой данных: фичи, контроллеры, порты и транспорт

## Фичи-модули — `src/features/`

Самодостаточные модули приложения. Каждая фича несёт свои страницы,
компоненты, контроллер и API-слой за **портом** (`ports.ts`): UI знает
только интерфейс порта, единственная реализация — own-адаптер над
HTTPTransport/WS собственного бэкенда (`features/*/api/`).

| Фича | Ответственность | Слайсы Store |
|---|---|---|
| `auth` | signin/signup, fetchUser, logout, auth-гард маршрутов, CSRF-политика | `user`, `authError`, `authLoading` |
| `chats` | список/создание/удаление чатов, участники, переименование, `+AI`, поиск, отправка сообщений, WS-шлюз ленты, история, stories | `chats`, `chatUsers`, `selectedChat`, `messages.<chatId>`, `stories` |
| `profile` | профиль, настройки (тема, приватность, уведомления), архив чатов | `user` |
| `contacts` | адресная книга, добавление, создание диалога | `contacts` (тип живёт во фиче — store-cast-идиома, как у `stories`) |
| `ai-assistant` | страница `/assistant`, RAG-поиск документов, создание AI-чата | — |

Межфичевые зависимости легальны только в композиционном корне
`src/features/index.ts` через consumer-side сеттеры (`setChatOpener`,
`setContactsIntegration`, `setDocumentSearch`, `setProfileSeams`, …) —
фичи друг про друга не знают; границу следит guard-хук.

## Контроллеры

Контроллер фичи (`features/*/controller.ts`, экспорт — синглтон) —
единственное место бизнес-логики фронта: вызывает порт/адаптер, результат
пишет в Store, ошибки переводит в человекочитаемые слайсы. Пример
контракта: `ChatsController.selectChat(id)` открывает WS-сокет чата,
подтягивает состав и историю, пишет `selectedChat` + `messages.<id>`;
`AuthFeatureController.logout()` гасит WS-сокеты через сеансный шов
`registerSessionTeardown` и делает полный `Store.reset()`.

## HTTPTransport — `src/utils/HTTPTransport.ts`

Обёртка над **XMLHttpRequest** (не fetch):

- базовый URL — из env (`VITE_API_URL`, локально `http://localhost:8000/api/v1`);
- `get/put/post/delete`, GET-параметры сериализуются в query string;
- `withCredentials = true` (cookie-сессия own-бэкенда + CSRF-токен в
  заголовке на мутациях), `responseType = 'json'`;
- тело: `FormData` → multipart, объект → JSON; дефолтный timeout 30с,
  per-request override;
- успех — 2xx, иначе reject с кодом статуса; сетевые ошибки/таймаут/abort —
  отдельные reject'ы.

Поверх транспорта — глобальная политика повторов
(`features/auth/transportPolicy.ts`, ставится в композиции):
**401 → single-flight refresh + повтор запроса**, неудачный refresh →
локальный выход; **5xx → лестница повторов**; busy-оверлеем владеет
только политика.

## WS-шлюз чатов — `src/features/chats/ws/`

Замена легаси `MessagesController`: модуль держит `Map<chatId, WSTransport>`
активных сокетов, открывает `ws://<host>/ws/chats/<chatId>` с
cookie-аутентификацией. Входящие события шлюза распределяет gateway:
`message` — аккумулируется в `messages.<chatId>` (дедуп по id),
`history` — prepend-merge с курсором `before_id`, `bot_delta` — наращивание
pending-хвоста, патч-события (`chat_renamed`, `chat_ai_toggled`,
`*_avatar_updated`) — точечные обновления слайсов. Собственные закрытия
сокетов маркируются (намеренность) — индикатор смерти WS показывается
только по немаркированному исчерпанию попыток.

Отдельный сокет `features/chats/stories/ws/` слушает глобальный канал
stories; коннективность (`features/chats/ws/connectivity.ts`): offline →
reconnect-оверлей, online → force-дроп застрявших в backoff сокетов +
рефетч списка с ресинком.

## WSTransport — `src/utils/WSTransport.ts`

Обёртка над `WebSocket`, расширяющая `EventBus`. События `WSTransportEvents`:
`Connected`, `Message`, `Error`, `Close`.

- `connect()` — открывает сокет, резолвится по `Connected`, при исчерпании
  попыток — reject;
- **bounded-реконнект**: растущий backoff с потолком попыток;
- ping `{type: 'ping'}` каждые 5 секунд (сервер отвечает `pong`);
- `close()` — явное закрытие: **не реконнектит**, чистит ping-интервал и
  слушателей; публичный readonly `isOpen`.

## Сопутствующие хелперы — `src/helpers/`

- `helpers.ts` — `set(obj, path, value)` для записи в Store по keypath и
  `merge` (глубокое слияние с fallback в присваивание);
- `isEqual.ts` — строгое `===` (глубокого сравнения нет; селективность
  `withStore` обеспечена `shallowEqual` в Store);
- `fetchWithRetry.ts` — мёртвый код (не импортируется), см.
  [known-issues.md](known-issues.md).
