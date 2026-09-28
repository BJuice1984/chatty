# Chatty → корпоративный мессенджер с AI-ассистентом (мастер-план)

> Статус: утверждён пользователем 2026-09-28, ожидает запуска. Реализация не начата.
> Это мастер-план трансформации; каждый этап дорожной карты при запуске получает
> собственный план-пакет `tasks/<гггг-мм-дд>-<slug>/` по конвенциям `tasks/README.md`.

## Context

Chatty — учебный мессенджер (TS без фреймворков, Vite + Handlebars + собственный Block),
полностью завязанный на бэкенд курса Практикума (`ya-praktikum.tech`). Цель — корпоративный
мессенджер со встроенным AI-ботом: бот знает документы компании (RAG), по запросу
(«дай заявление на отпуск») находит документ на сервере и предлагает скачать.
Требования: модульный фронт («ядро + подключаемые фичи»), собственный бэкенд и БД.

## Зафиксированные решения пользователя

| Развилка | Решение |
|---|---|
| Фронтенд | Развиваем собственное ядро (Block + Handlebars) → модульная архитектура «ядро + фичи» |
| Бэкенд | Python FastAPI + LangChain, **полная замена** бэкенда Практикума (auth, чаты, сообщения, файлы) |
| LLM | Ollama на Mac mini 24 ГБ: Qwen3-14B (Q4) + embedding bge-m3; провайдер за интерфейсом + `.env` |
| Документы | docx/doc, pdf (текстовый слой, без OCR), xlsx |
| Хостинг | Docker Compose локально (api + postgres + minio); Ollama нативно на macOS (в Docker на Mac нет Metal): `OLLAMA_BASE_URL=http://host.docker.internal:11434` |
| БД | PostgreSQL 16 + pgvector (данные + вектора), MinIO — файловое хранилище |

## Целевая архитектура

```
chatty/
├── src/
│   ├── core/            # Block, EventBus, store (слайсы), module-registry, registerComponent
│   ├── utils/           # Router, HTTPTransport, WSTransport, env, helpers
│   ├── api/             # только общие DTO-типы + ApiError
│   ├── components/      # shared UI-кит (Button, Input, Avatar…)
│   ├── features/        # ФИЧИ: auth, chats, profile, ai-assistant
│   │   └── <name>/{module.ts, pages/, components/, controller.ts, api.ts, store.ts, styles/}
│   ├── scss/            # только токены/миксины/reset/шрифты
│   └── main.ts          # createApp({ modules }) — композиционный корень
├── backend/             # FastAPI + SQLAlchemy 2 + Alembic + LangChain + pytest
├── docker-compose.yml   # api + pgvector/pgvector:pg16 + minio
└── tasks/, docs/        # ALK-харнесс как есть
```

### Фронт: ядро + модули (сохраняя собственный фреймворк)

- **Реестр модулей**: `src/core/module/types.ts` — `AppModule { name, components?, slices?, routes?, bootstrap?, styles? }`;
  `src/core/module/registry.ts` — `registerModules()` (коллизии имён hbs-хелперов/слайсов → понятный
  throw); `src/core/app.ts` — `createApp()`. `main.ts` сокращается до
  `createApp({ modules: <features/index.ts> })`.
- **Ленивые маршруты**: `Route` хранит фабрику `() => Promise<typeof Block>` (dynamic `import()`);
  поддержка `:param`-сегментов; 404-fallback; `beforeEach`-guard (централизованная проверка
  авторизации — убирает ad-hoc switch в `main.ts` и `Router.go()` из контроллеров).
- **Стор слайсами**: `createSlice(name, initialState)`; типы состояния живут в фичах, ядро от них
  не зависит. `withStore` исправить: `shallowEqual` перед `setProps` + отписка через новый
  `Block.destroy()` (вызывается из `Router.leave()`).
- **Env-абстракция** (сегодня отсутствует вообще): `src/utils/env.ts` читает `import.meta.env`
  (`VITE_API_URL`, `VITE_WS_URL`, `VITE_FILES_URL`); `.env.development` (Практикум) /
  `.env.own` (localhost:8000) — переживаем cutover флагом. `HTTPTransport.baseURL` из env;
  хелпер `fileUrl()` вместо захардкоженных URL в `chatAvatar.hbs` / `userAvatar.hbs`.
- **Guard v2**: ранги `helpers/core:0, utils:1, api:2, components:3, features:4`; новое правило
  cross-feature-импорт = blocker; учесть dynamic `import()` в сканере. Миграция — через
  существующий механизм `TRANSITIONAL_DEBT`.
- **AI-ассистент — первый модуль нового образца** `src/features/ai-assistant/`: слайс
  `{ searching, documents[] }`, компоненты (typing-индикатор, карточка документа), рендер
  `Message.file` кликабельной ссылкой скачивания.

### Бэкенд: FastAPI + LangChain

- **Структура**: `app/{core (config/security/deps), db, models, schemas, repositories, services,
  api/v1/endpoints, ws (hub+router), bot (service/tools/prompts/provider), ingestion
  (parser/chunker/indexer/cli), seed.py}` + `alembic/` + `tests/{unit,integration}`.
- **Auth — JWT в httpOnly-куках**: access (15 мин) + refresh (30 дней, ротация); пароли argon2;
  WS-рукопожатие шлёт куки автоматически. CORS: localhost:3000 + Netlify-домен.
- **Схема БД**: `users` (+`role`, `is_bot`), `files` (метаданные MinIO), `chats` (+`is_ai`),
  `chat_members`, `messages (chat_id, user_id, content?, file_id?, created_at; idx chat_id,id desc)`,
  `documents (status: pending/processing/ready/failed)`,
  `doc_chunks (content, embedding vector(1024), HNSW cosine)` — bge-m3 = 1024 dim.
- **WebSocket**: `WS /api/v1/ws/chats/{chat_id}`; конверт совместим с текущим (`{type, content}`),
  добавлены `history (before_id, limit)` и `error`. Хаб `dict[chat_id, set[WebSocket]]`.
- **Файлы**: upload `POST /files` (multipart → MinIO); скачивание — проксированный стриминг
  `GET /files/{id}/download` (StreamingResponse + Content-Disposition; авторизация не
  обходится, в отличие от presigned).
- **Бот**: bot-user (`is_bot=true`); чат `is_ai=true`. Поток: WS-хаб получил сообщение →
  персист → broadcast → `asyncio.create_task(BotService.answer(chat_id))`. `BotService`:
  LangChain-агент, провайдер из `bot/provider.py` по `LLM_PROVIDER` (ChatOllama сейчас),
  tool `search_documents(query) → top-k` (pgvector), ответ сообщением от bot-user с
  `content` + `file_id` найденного документа.
- **Ingestion**: парсеры python-docx/pypdf/openpyxl → чанкер (~800 ток., overlap 100) →
  embeddings через Ollama → pgvector. Входы: `POST /documents` (admin, фоновая задача)
  и CLI `python -m app.ingestion.cli upload <dir>` для сидов.
- **Compose**: `api` (entrypoint: alembic upgrade → seed → uvicorn), `postgres`
  (pgvector:pg16, healthcheck), `minio` (+init-бакет). `.env.example` в репо.

## Дорожная карта (этап = ALK plan-id = ветка feature/<plan-id> от принятого integration baseline = отдельный PR)

| # | plan-id | Состав | DoD |
|---|---|---|---|
| 1 | `env-api-abstraction` | `utils/env.ts`, `.env.*`, ApiError, baseURL HTTPTransport, `fileUrl()` в 2 hbs | verify PASS; фронт работает на Практикуме |
| 2 | `kernel-router-store` | Router (фабрики/lazy/params/404/beforeEach), слайсы стора, withStore compare+off, `Block.destroy` | verify + юнит-тесты Router/Store |
| 3 | `module-kernel-guard-v2` | `core/module/*`, `core/app.ts`, guard v2, миграция **auth** в features | verify; `guard --all --strict` = 0; smoke логина |
| 4 | `migrate-chats-profile` | переезд chats, profile; снос `src/pages`, `src/controllers`, старых api-клиентов; TRANSITIONAL_DEBT вычищен | verify + smoke на Практикуме |
| 5 | `backend-skeleton` | структура backend/, config, alembic, JWT-auth, users, compose, seed | pytest зелёные; `docker compose up` → curl-флоу регистрации |
| 6 | `backend-chats-ws-files` | chats/members/messages, WS-хаб + история + пагинация, files upload/download | pytest с WS-клиентом |
| 7 | `api-cutover` | фронт на `.env.own`, адаптация api-клиентов фич, новый WS-протокол, 401-guard; Практикум остаётся как `.env.development` | ручной E2E auth+чат+файл на localhost; verify |
| 8 | `backend-docs-rag` | documents/doc_chunks, pgvector, ingestion (CLI + admin endpoint), сиды | pytest: ingestion → search top-k на фикстуре |
| 9 | `backend-bot` | bot-user, is_ai-чаты, BotService + tool, ответ с file_id | integration: сообщение → ответ бота с attachment |
| 10 | `fe-ai-module` | `features/ai-assistant`, рендер файлов/ссылок, typing-индикатор, UX | verify + ручной RAG-сценарий |
| 11 | `hardening-docs` | WSTransport reconnect, пагинация истории в UI, README/AGENTS/CLAUDE, деплой-заметки | оба гейта зелёные |

### Уточнение порядка первого контура (2026-09-28)

По решению пользователя первый запуск выполняется последовательно через `dev`:
сначала `backend-skeleton` (минимальная внутренняя поставка API/БД/MinIO,
health/readiness и verify), затем `env-api-abstraction` (frontend endpoint/API
boundary). Каждый пакет проходит собственную проверку, независимый audit, freeze и
отдельный PR; следующий пакет стартует только после приёмки предыдущего в `dev`.

Локальная модель считается уже развёрнутой внешней зависимостью, но её reachability
и конфигурационная проверка намеренно вынесены из первого контура в отдельный
будущий gate перед RAG/bot. Она не блокирует первые backend/frontend пакеты.

После приёмки первых двух пакетов последующие этапы могут параллелиться только если
их ALK-пакет явно задаёт безопасный DAG и сохраняет последовательные PR и проверки.
Фронт остаётся рабочим на каждом этапе за счёт env-флага.

## Верификация

- **Фронт** (не ломаем): `npm run verify` (typecheck + mocha + eslint + stylelint); новые юнит-тесты
  Router (params/404/lazy), Store (слайсы/отписка), registry (коллизии).
- **Бэкенд**: `backend/verify.sh` = ruff check + ruff format --check + mypy app + pytest
  (unit на aiosqlite, integration на pg в docker, маркер `@pytest.mark.integration`);
  npm-скрипт `verify:backend` + итоговый `verify:all`.
- **ALK**: evidence фронтовых этапов — `npm run verify`, бэкендовых — `backend/verify.sh`,
  смешанных (7) — оба.
- **Живой сценарий** (этапы 9–10): `docker compose up` + Ollama → регистрация → чат с
  AI-ассистентом → «дай заявление на отпуск» → ответ бота с кликабельным документом →
  скачивание файла.

## Сопровождение конвенций (каждый этап)

- Обновить `AGENTS.md`/`CLAUDE.md` (карта дерева, правило «фича = самодостаточный модуль»,
  гейты по зонам, инструкция compose) и `docs/progress/progress_log.md` (запись сверху).
- Guard v2 и правки `docs/project-principles.json` → пересчёт `principlesDigest`
  (процедура в `tasks/README.md`).
- Коммит-хуки и `npm run verify` — как есть; TS 5.9 pin не трогаем.

## Первые шаги этапа 1 (`env-api-abstraction`) при запуске

1. Ветка `feature/env-api-abstraction` от main; ALK-план-пакет в `tasks/`.
2. `src/utils/env.ts` + `.env.development` / `.env.example`; `.gitignore` для `.env*` (кроме example).
3. `HTTPTransport.API_URL` → `env.apiUrl`; wss-URL в `MessagesController` → `env.wsUrl`;
   `fileUrl()` вместо хардкода в `chatAvatar.hbs:2` и `userAvatar.hbs:3`.
4. `src/api/errors.ts` (ApiError) — пока без смены поведения контроллеров.
5. `npm run verify` + smoke логина/чатов на Практикуме → PR.

## Замечание о состоянии репозитория на момент утверждения

Ветка `feature/agent-harness` опережает `main` на 11 коммитов (агентский харнесс: guard,
скилл chatty-dev, principles — ещё не смёржены). Этап 1 от `main` не зависит, но до вливания
харнесса guard-хук в ветках от main работать не будет — прогонять `npm run verify` вручную
(что и так требует workflow).
