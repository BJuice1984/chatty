# NEXT — точка входа для следующей сессии

Обновлено: 2026-11-01 (контакты/адресная книга и маршрут `/contacts`,
ALK-прогон `2026-11-01-contacts`; до этого — pg_trgm-индексы для
/chats/search, миграция 008_pg_trgm_search_indexes, ALK-прогон
`2026-10-27-chats-search-trgm`).

## Состояние

Контакты стали адресной книгой с собственным маршрутом (2026-11-01-contacts,
ветка feature/2026-11-01-contacts): `/contacts` монтирует ContactsPage,
защищённую существующим allowlist-гардом без единой правки гарда. Сайдбар
упрощен: шапка «Контакты» + кнопка «Добавить», список карточек ContactItem
(аватар, display_name, login, hover-крест удаления), BottomBar — без ленты
историй и поиска по чатам; правая панель — заглушка «выберите контакт».
«Добавить» переиспользует модалку дебаунс-поиска мессенджера:
`renderAddUserModalContent` получил опциональный `alreadyBadge` (мессенджер
молчит — дефолт «уже в чате» и его поведение бит-в-бит прежние, пин-тест;
контакты передают «уже в контактах», memberIds = id контактов), дебаунс 300
мс и возврат фокуса принадлежат странице (корневая делегация событий).
Клик по карточке открывает меню: «Создать» — get-or-create диалога
(POST /chats/dm) и переход в мессенджер через сеттер setChatOpener
(композиция features/index.ts), «Найти все чаты» — НЕ СДЕЛАНО: реализация
чат-поиска с другой машины не смержена, пункт кораблится disabled с title
«пока не реализовано»; hover-крест — модалка подтверждения и removeContact.
chatPaneOpen страницы чатов теперь стартует из живого выбора
(`selectedChat != null`): возврат на /messenger с выбранным чатом на
мобильном открывает панель чата, а не список (осознанное изменение,
задокументировано и пинновано). Адаптив зеркалит лестницу chat.scss:
380px сайдбар / 280px на планшете / одна колонка <768 с скрытой заглушкой
(ручной smoke, не mocha — jsdom без layout). Гейты: фронт 422 mocha, бэкенд
218 pytest passed (+4 известных Windows-падения ingestion), guard strict 0.

Истории стали живыми: глобальный канал `/api/v1/ws/stories` (cookie-auth
+ Origin-check, без membership, ping→pong) с user-keyed `StoriesHub`
(мультивкладочность, prune-stale, `exclude_user_id`); `POST /stories`
фан-аутит `story_created` фиксированной формы (`viewed/is_own=False` для
всех не-владельцев по построению, общий `_common_fields` с лентой) всем,
кроме аплоадера; `DELETE /stories/{id}` — `story_deleted {story_id}`
всем. Фронт: ws-модуль `features/chats/stories/ws/` (синглтон поверх
нетронутого `WSTransport`, открывается на CDM страницы чатов рядом с
`fetchStories`, Close обнуляет ссылку) → gateway-листенер →
`StoriesController` (единственный писатель `state.stories`): дедуп по id,
вставка чужой непросмотренной сразу после блока своих, удаление по id —
кольца обновляются без перезагрузки. Гейты: фронт 337 mocha, бэкенд 184
pytest passed (+4 известных Windows-падения ingestion), guard strict 0.

Живой поиск чатов (2026-10-26-chat-search, ветка feature/2026-10-26-chat-search,
PR на `dev`): Wave-3 UI — SearchBar дебаунсит ввод (300 мс) и зовёт
GET /chats/search; список при пустом запросе идёт по активности
(`last_message.time` DESC, недатированные тонут, ничья id DESC), при
активном показывает только совпадения серверного порядка с подсветкой
`<mark>` (utils/highlight.ts, escape-then-wrap) в заголовке и/или
сниппете; текст и фокус поиска переживают перерисовки (модульная память
бара + CDU-восстановление страницы). Серверный поиск остаётся на
lower()+LIKE-скане, но ускорен pg_trgm: миграция
`008_pg_trgm_search_indexes` строит функциональные GIN-индексы ровно над
выражениями запросов (`lower(title)`, `lower(content)` в
repositories/chats.py — переписывание запросов потребует миграции
индексов в ногу); цена — поддержка GIN-индекса триграмм на каждом POST
сообщения (fastupdate амортизирует по умолчанию, тюнинг вне скоупа).
FTS/tsvector и релевантность — заявленный non-goal: морфология и
префиксный матчинг ломают контракт сырой подстроки и подсветку `<mark>`
первого вхождения.

## Приоритеты следующей сессии (согласовано 2026-10-23, пп.1–2 закрыты 2026-10-25)

1. **RAG-эмбеддинги — ЗАКРЫТО 2026-10-27** на инференс-хосте (LAN Mac mini):
   llama-server `:8082` (Qwen3.5-9B) перезапущен с `--embeddings --pooling mean`
   (dim 4096), модель зафиксирована в операторском env до первого ingestion; живая
   приёмка по `docs/plans/2026-10-25-rag-embeddings.md` пройдена (ingest → поиск
   0.822 → бот `succeeded` с ответом по документу; изоляция 403; идемпотентный
   реингест). По пути закрыт баг двух подряд system-сообщений (`prompts.py`,
   jinja-шаблон Qwen3.5 в llama.cpp отвечал 500). Остаточный шаг (опционально):
   переход на отдельную embedding-модель (bge-m3 на `:8083`, pooling cls) —
   качественнее и разгрузит чат-инстанс; смена векторного пространства = реингест
   всех документов. Расклад инференс-хоста (порты/модели) — в
   `docs/deployment/own-backend.md`, runbook приёмки —
   `docs/plans/2026-10-25-rag-embeddings.md`.

Хвосты закрыты 2026-10-25 веткой `feature/2026-10-25-next-tails`:
`mark_viewed` — `INSERT ... ON CONFLICT DO NOTHING` по композитному PK;
`unread_counts` — один SELECT (memberships + LEFT JOIN маркера + COUNT
FILTER) вместо 3 запросов + COUNT на чат; дубль `GET /chats` — bootstrap
`fetchChats` удалён из `src/main.ts` (CDM страницы чатов, LIVE-3, —
единственный писатель на заходе). Пределы stories-push закрыты 2026-10-26 веткой
`feature/2026-10-26-stories-push-limits`: фан-аут `story_created` уходит и
владельцу (is_own/viewed правится на клиенте по owner_id — своя история
вставляется в голову ленты), истёкшие по TTL кольца гасятся на рендере
(`stories/ttl.ts`, 24ч-зеркало серверной ручки, невалидная дата кольцо не
прячет). Третий предел — события вне страницы чата — оставлен осознанно:
сокет живёт со страницей, каждый маунт рефетчит ленту, глобальный сокет
держал бы постоянное соединение ради ленты, которую никто не смотрит.

## Окружение (воспроизводимо на новой машине)

```bash
# бэкенд-окружение (системный python3 может быть без pytest)
python3 -m venv ~/.venvs/chatty-backend
~/.venvs/chatty-backend/bin/pip install -e 'backend[test]'
PYTHON_BIN=~/.venvs/chatty-backend/bin/python npm run verify:backend

# compose-стек (операторский env-файл НЕ в git: POSTGRES_PASSWORD,
# OBJECT_STORAGE_*, CHATTY_SEED_DEMO_STORIES; см. docs/deployment/own-backend.md)
docker compose --env-file <operator-env> up -d --build api

# единый гейт фронта и архитектуры
npm run verify && node .claude/hooks/scripts/guard-architecture.mjs --all --strict
```

Windows-заметка: `npm run verify:backend` не резолвит `.sh` через cmd —
запускайте скрипт напрямую: `PYTHON_BIN=~/.venvs/chatty-backend/Scripts/python.exe
bash backend/verify.sh`; 4 теста `tests/unit/ingestion/test_converter.py`
на Windows-хостах падают (subprocess с shell-скриптом, WinError 193) —
environment-специфика, на Unix-машинах зелёные.

Для нетривиальной фичи — полный ALK-цикл (см. `tasks/README.md` и текущий
пример пакета `tasks/2026-10-21-avatars-stories/`); история работы —
`docs/progress/progress_log.md` (новое сверху).
