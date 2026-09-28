# Слой данных: контроллеры, API, транспорт

## Контроллеры — `src/controllers/`

Бизнес-логика приложения. Паттерн единообразный: класс с приватным полем `api`, методы оборачивают вызовы API в `try/catch` (ошибки — в `console.error` через `handleError`) и результат кладут в Store. Экспортируются **готовыми синглтонами**:

```ts
export default new AuthController()
```

| Контроллер | Ответственность | Пишет в Store |
|---|---|---|
| `AuthController` | `signin`, `signup`, `fetchUser`, `logout` | `user` |
| `UserController` | поиск пользователя, смена данных, смена аватара (`FormData`) | `user` |
| `ChatsController` | список/создание/удаление чатов, аватар чата, пользователи чата, токен WS | `chats`, `chatUsers`, `selectedChat` |
| `MessagesController` | WebSocket-соединения чатов, отправка/история сообщений | `messages.<chatId>` |

`MessagesController` — единственный, кто работает не через HTTP API: он хранит `Map<chatId, WSTransport>` активных сокетов, при `connect` получает токен чата (через `ChatsController`) и открывает `wss://ya-praktikum.tech/ws/chats/<userId>/<chatId>/<token>`. Входящие сообщения аккумулируются в `messages.<chatId>` (новые старые запрашиваются командой `get old`).

## API-классы — `src/api/`

REST-клиенты бэкенда курса. `BaseApi` (`src/api/BaseApi.ts`) — абстрактный базовый класс с контрактом CRUD (`create`/`read`/`update`/`delete`) и защищённым `http: HTTPTransport`, инициализированным префиксом эндпоинта:

```ts
class AuthAPI extends BaseAPI {
    constructor() {
        super('/auth')
    }
    // this.http.get('/user') → GET https://ya-praktikum.tech/api/v2/auth/user
}
```

Конкретные клиенты: `AuthApi.ts`, `UserApi.ts`, `ChatsApi.ts`. Типы DTO (`SigninData`, `ChatInfo`, `ChatUser`, …) экспортируются из тех же модулей и переиспользуются контроллерами и страницами.

## HTTPTransport — `src/utils/HTTPTransport.ts`

Обёртка над **XMLHttpRequest** (не fetch). Характеристики:

- базовый URL — `HTTPTransport.API_URL = 'https://ya-praktikum.tech/api/v2'`;
- методы `get/put/post/delete`; GET-параметры сериализуются через `queryStringify` в query string;
- `withCredentials = true` (куки сессии курса), `responseType = 'json'`;
- тело: `FormData` уходит как multipart, объект — как JSON (`Content-Type: application/json`);
- успех — 2xx, иначе `reject(new Error('Запрос не выполнен. Статус: N'))`; сетевые ошибки/таймаут/abort — отдельные reject'ы.

## WSTransport — `src/utils/WSTransport.ts`

Обёртка над `WebSocket`, расширяющая `EventBus`. События — enum `WSTransportEvents`: `Connected`, `Message`, `Error`, `Close`.

- `connect()` — открывает сокет, подписывается на его события и резолвит промис по `Connected`;
- держит соединение пингом `{type: 'ping'}` каждые 5 секунд, `pong` от сервера игнорируется;
- `send(data)` — JSON-сериализация; `close()` — закрытие (пинг-интервал очищается по событию `Close`).

## Сопутствующие хелперы — `src/helpers/`

- `helpers.ts` — `set(obj, path, value)` для записи в Store по keypath и `merge` (глубокое слияние с fallback в присваивание);
- `isEqual.ts` — строгое `===` (не глубокое сравнение);
- `fetchWithRetry.ts` — retry-обёртка над fetch; **в проекте не используется** (мёртвый код, оставлен как заготовка).
