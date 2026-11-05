# Plan: messenger UX pack — ordering, header avatar, inline rename, «Найти все чаты» + '@'-поиск, stack redeploy, «Пометить всё прочитанными»

Package: `2026-11-05-messenger-ux-pack` · Tier: S2 · Base: `dev` @ `cadf2b019c5312fbc8142f75197ab6ac8caec81e`
Branch: `feature/2026-11-05-messenger-ux-pack` · PR → `dev`

## Intent

Шесть операторских пунктов одним контуром:

1. **Новый чат — верх списка.** `ChatInfo.created_at` пробрасывается own-адаптером; пустой
   запрос сортируется по `last_message.time ?? created_at` (id DESC при ничьей) — свежесозданный
   чат без сообщений больше не тонет.
2. **Аватар чата — в хедер.** Из карточки списка (`chat-list-user__img`) убираются кликабельность,
   скрытый file-инпут и карандаш-подложка; смена аватара переезжает в шапку чата слева от
   заголовка (слот сегодняшнего `padding-left: 77px`), аффорданс — только владельцу чата
   (бэкенд `/files/avatars` kind=chat уже owner-only). Попутно фикс переполнения длинного
   заголовка (`min-width: 0` + flex-раскладка).
3. **Inline-переименование.** Двойной клик по `messenger__header-title` превращает заголовок в
   инпут; сохранение без подтверждения по Enter, Escape ИЛИ клику вне (решение оператора: Esc
   сохраняет). Пустое значение — тихий откат. Любой АКТИВНЫЙ участник может переименовать
   (гвард `require_active_member`); в ленту пишется персистентное системное сообщение «кто и
   когда» (новая колонка `messages.kind`, миграция 012); другим участникам летит WS
   `chat_renamed` для обновления заголовков списков.
4. **«Найти все чаты» + '@'-поиск.** GET /chats/search при `q` с префиксом `@` ищет чаты по
   СОУЧАСТНИКАМ (case-insensitive префикс по login-email ИЛИ display_name, кроме самого
   запрашивающего; `matched_in: 'member'`, сниппет — имя совпавшего). Кнопка в меню контакта
   включается: клик сеет в бар поиска `@<полный email>` (уникален → ровно чаты этого
   пользователя), запускает поиск и ведёт на /messenger. Ручной ввод `@…` в
   `chat__search-bar-form` работает тем же путём. Логика создания чатов не меняется:
   несколько чатов с одним пользователем уже разрешены (POST /chats каждый раз создаёт новый).
5. **Починка удаления из чата и архивации.** Код фронтенда и бэкенда в репо согласован; живой
   контейнер `chatty-api` собран 2026-11-01 12:13 ДО влития chat-leave — роутов
   `DELETE /chats/{id}/members/{uid}`, `/leave`, `/rejoin` на живом API нет (подтверждено
   пробами: 404 «Not Found» вместо 401/403). Лечение — пересборка compose-стека по runbook
   `docs/deployment/own-backend.md` после принятия бэкенд-волны (одна пересборка подхватывает и
   недостающие, и новые роуты), с smoke-пробами в evidence.
6. **«Пометить всё прочитанными».** POST /chats/read-all (bulk-upsert маркеров `chat_last_reads`
   до последнего сообщения каждого чата запрашивающего, включая архивные — семантика
   `unread_counts`). Иконка настроек в шапке списка (`chat__header-icon`,
   settings-icon.svg → mark-all-read-icon.svg, новый SVG) становится этой кнопкой: активна
   только при наличии непрочитанных, клик гасит все пилюли.

## Architecture boundaries

- Слои только вниз: `pages → components → controllers → api → utils → core`; guard
  `--all --strict` зелёный; фичи друг друга не импортируют — единственные cross-feature швы в
  `src/features/index.ts` (новый `setChatSearchOpener` для contacts → chats, прецедент
  `setChatOpener`).
- Бэкенд: миграция 012 аддитивна (`messages.kind`), сегментные тесты 009/010/011 обязаны
  остаться зелёными (их явные downgrade-таргеты не затрагиваются; изоляция сегментов
  сохраняется явными таргетами — репин только если прогон покажет иначе).
- WS-протокол: два новых события сервера — `message` с `kind`-сообщением (существующая форма
  MessageResponse + аддитивное поле) и `chat_renamed` `{chat_id, title}` (fan-out активным
  участникам, прецедент `chat_deleted`).
- Store: `AppState` не трогаем — новые поля едут существующими срезами/каст-идиомами.

## Workstreams и DAG

```
WS-BE-API ──┬──> WS-OPS-STACK (пересборка + smoke)
            └──> WS-FE-CHAT ──> WS-FE-SEARCH (shared-файлы: chat.ts, types.ts, controller.ts)
```

- **WS-BE-API**: PUT /chats/{id} + системные сообщения + `chat_renamed`; POST
  /chats/read-all; '@'-ветка GET /chats/search; миграция 012; pytest.
- **WS-OPS-STACK**: preflight → `up -d --build` → health/ready → пробы 401-vs-404 новых и
  недостающих роутов → аутентифицированный smoke. Единственная правка репо —
  `scripts/probe-own-backend-routes.ps1`, прочее evidence-only.
- **WS-FE-CHAT**: created_at-сортировка; перенос аватара в шапку + overflow-фикс; inline-rename
  UI; рендер системных сообщений; WS-обработка chat_renamed; иконка mark-all-read; контроллер
  + порт + адаптер (`renameChat`, `readAll`); mocha.
- **WS-FE-SEARCH**: `matched_in: 'member'` в UI-типах; включение кнопки «Найти все чаты» +
  шов `setChatSearchOpener`; `setChatSearchBarValue` в searchBar; features/index.ts; docs
  (NEXT.md, progress_log.md).

## Non-goals

- Локальные (per-user) названия чатов — title остаётся общим, переименование видно всем.
- История переименований (лента хранит только последнее событие как сообщение).
- Удаление/редактирование системных сообщений; серверного подавления реакций/реплаев на них
  нет — служебная строка просто не показывает аффордансов в UI.
- Миграция индексов под '@'-поиск (lower(email)/lower(display_name) users) — масштаб учебный,
  префикс-скан по users достаточен.
- Автовыбор/авооткрытие свежесозданного чата (порядок в списке — только сортировка).
- WS-push счетчика прочитанного другим участникам (read-state приватна по построению).
- Полная замена настроек: иконка настроек в шапке списка меняет назначение (настройки живут
  на /settings через BottomBar), нового экрана настроек не появляется.

## Evidence

- EV-BE-1: `PYTHON_BIN=~/.venvs/chatty-backend/Scripts/python.exe bash backend/verify.sh`
  (pytest + alembic heads == 012) — WS-BE-API.
- EV-OPS-1: журнал пересборки + health/ready + пробы роутов + smoke — WS-OPS-STACK.
- EV-FE-1: `npm run verify` + guard `--all --strict` — WS-FE-CHAT.
- EV-FE-2: `npm run verify` + guard `--all --strict` + docs-дифф — WS-FE-SEARCH.

Базовые счётчики фиксируются прогонами на базе (мocha ≥ 655 / pytest ≥ 277 ожидаемо;
точные числа — в launch-gate записях); известные 4 Windows-падения ingestion —
environment-специфика, оформляются честными deviations с полным логом.
