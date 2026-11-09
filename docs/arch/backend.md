# Собственный бэкенд (backend/)

Единый бэкенд Chatty: FastAPI-приложение в контейнере compose-стека
(api + PostgreSQL 16 + RustFS). Runbook развёртывания —
[docs/deployment/own-backend.md](../deployment/own-backend.md);
ИИ-контур (бот, RAG, скиллы) — отдельный документ
[ai-assistant.md](ai-assistant.md).

## Стек

- **FastAPI** (uvicorn) — REST `/api/v1` + WebSocket `/api/v1/ws/*`
- **SQLAlchemy 2** (ORM, sync-сессии) + **Alembic** — миграции `001`–`016`
- **PostgreSQL 16** — основная БД; расширение `pg_trgm` для поиска
- **RustFS** — S3-совместимое объектное хранилище (клиент — boto3)
- **PyJWT** (access/refresh) + **pwdlib[argon2]** — аутентификация
- **httpx** — исходящие HTTP-вызовы (Ollama и OpenAI-совместимые инференс-серверы)
- **openpyxl / python-docx / pypdf** — парсеры для ингеста (xlsx-график,
  документы RAG)

Python `>=3.11`, зависимости — `backend/pyproject.toml`.

## Слои

```
app/
├── main.py               # сборка приложения, CORS/origins, storage state
├── api/v1/endpoints/     # HTTP-слой: валидация схем, зависимости, статусы
├── services/             # бизнес-логика и транзакции (единственный писатель БД)
├── repositories/         # запросы к БД (без бизнес-логики)
├── models/               # ORM-модели
├── schemas/              # pydantic-схемы запросов/ответов
├── core/                 # config (pydantic-settings), deps, security
├── ws/                   # WebSocket-роутер и хабы
├── bot/                  # провайдер LLM (Ollama/OpenAI-совместимый) + промпты
├── ingestion/            # RAG-пайплайн: парсеры, конвертер, чанкинг, эмбеддинги
├── vacations/            # отпускной скилл: интенты, сервис, store, RTF-формы
└── seed.py               # идемпотентный сид (админ, демо-stories — опционально)
```

Домены регистрируют свои роутеры через композиционный шов
`register_domain_router` (`api/v1/router.py`); каждый эндпойнт-модуль
подключается в `endpoints/__init__.py`.

## Аутентификация и безопасность

- Cookie-сессии: **JWT access + refresh** (httpOnly-cookie); refresh —
  ротация, «выйти везде» — инвалидация семейства
- Пароли — **argon2** (pwdlib)
- **CSRF double-submit**: cookie-токен + заголовок на мутациях
- WebSocket: cookie-аутентификация + **Origin-check**; чат-сокет требует
  активного членства, stories-сокет — только аутентификации
- `CHATTY_ALLOWED_ORIGINS` — белый список origin для CORS и WS
- XSS-гигиена фронта: экранирование через escapeHtml-билдеры, текстовый
  рендер ответов бота без исполняемого DOM

## REST-домены (api/v1/endpoints)

| Домен | Ключевое |
|---|---|
| `auth` | signin/signup, refresh, logout, `/auth/me` |
| `users` | профиль, смена пароля, поиск по логину, preferences (read receipts и др.) |
| `chats` | CRUD чатов, `POST /chats/dm` (get-or-create диалога), members (добавить/кик), `POST /chats/{id}/leave` (архив членства), `PUT /chats/{id}` (title, `is_ai`), `GET /chats/search` (pg_trgm: заголовки, сниппеты, `'@'`-поиск участников), `POST /chats/read-all`, авто-название «Чат с …» (`auto_titled`) |
| `bot` | `POST /chats/{id}/bot/runs` — durable-запуск бота (см. ai-assistant.md) |
| `messages` (через chats) | отправка, история (`before_id`/limit), реакции, `kind`-сообщения |
| `files` | загрузка вложений и аватаров (kind=chat/user), `{id}/download`, `GET /files/usage`, фан-аут `chat_avatar_updated` / `user_avatar_updated` |
| `documents` | RAG: админ-ингест `{file_id}`, поиск `{file_id}` / чата (см. ai-assistant.md) |
| `stories` | создание/удаление, лента; WS-фан-аут `story_created`/`story_deleted` |
| `contacts` | адресная книга: добавить/удалить, список |
| `health` | `/health`, `/ready` (БД + миграции + storage) |

## WebSocket (`app/ws/`)

Две конечные точки (`router.py`), обе с ping→pong (клиентский `WSTransport`
пингует каждые 5 секунд):

- **`/api/v1/ws/chats/{chat_id}`** — лента чата. Требует активного
  членства; user-keyed соединения (мультивкладочность), prune устаревших.
  Клиент получает: `message` (новое сообщение), `history` (пакет при
  коннекте/подгрузке), `reaction`, `chat_renamed`, `chat_ai_toggled`,
  `chat_deleted`, `chat_avatar_updated`, `user_avatar_updated`,
  `bot_delta` (стриминг ответа бота), `error`.
- **`/api/v1/ws/stories`** — глобальный канал историй (без membership):
  `story_created` (всем, кроме автора; `is_own`/`viewed` правит клиент),
  `story_deleted`.

Рассылка — через хабы (`hub.py`): `hub.broadcast(chat_id, payload,
active_user_ids=…)` фильтрует получателей по активным членствам;
рассинхронизация «записали в БД, но не разослали» исключена порядком
«сначала коммит, потом broadcast» (бот-раны дополнительно перечитывают
флаг `is_ai` перед рассылкой — гонка выключения).

## Модель данных (по миграциям Alembic)

| Миграция | Что вводит |
|---|---|
| `001_users` | пользователи |
| `002_chat_messages_files` | чаты, сообщения, файлы |
| `003_documents_chunks` | документы и чанки RAG |
| `004_bot_runs` | durable-раны бота (`unique(message_id)`) |
| `005_reactions_replies` | реакции и ответы на сообщения |
| `006_chat_last_reads` | маркеры прочитанного (композитный PK) |
| `007_avatars_stories` | аватары чатов/юзеров, stories |
| `008_pg_trgm_search_indexes` | GIN-индексы триграмм для поиска |
| `009_contacts` | контакты |
| `010_chat_leave` | `chat_members.left_at` — архив членства |
| `011_settings` | пользовательские preferences |
| `012`/`014_message_kind*` | служебные `kind`-сообщения (события ленты) |
| `013_chat_auto_title` | `chats.auto_titled` для авто-названий |
| `015_vacations` | график отпусков: снапшоты, периоды, подтверждённые фамилии, состояние диалога скилла |
| `016_vacation_forms` | payload-JSON визардов заявлений |

Сущности отпускного контура: `vacation_schedules` (снапшот по году и имени
файла — реингест идемпотентно заменяет), `vacation_periods` (строки людей),
`vacation_names` (подтверждённая фамилия пользователя, переживает
реингест), `assistant_dialog_state` (TTL-состояние диалога + payload).

## Файлы и хранилище

`FileService` — единственная точка записи в RustFS: вложения сообщений,
аватары чатов и пользователей (`kind`). Доступ на скачивание — через
авторизацию членства в чате сообщения; `GET /files/usage` — суммарный
объём и счётчик для настроек. Загруженный файл проходит статусную машину
(`ready`/`failed`); в сообщение файл попадает только из `ready`.

## Развёртывание и операция

- Compose-стек: `api` (build из `backend/`), `db` (postgres:16-alpine),
  `object-storage` (rustfs) + volume-init; внутренняя сеть `chatty-internal`
- Команда контейнера: `alembic upgrade head && python -m app.seed && uvicorn …`
- Health: `/health` (процесс), `/ready` (БД + голова миграций + storage)
- Все секреты — в операторском env-файле (НЕ в git): пароли БД, ключи
  storage, JWT-секрет, сид-админ
- Инференс (Ollama `qwen3:14b`, `nomic-embed-text`) — внешняя зависимость
  хоста; переключение на OpenAI-совместимый сервер — env-ручками
  `CHATTY_BOT_PROVIDER_*` / `CHATTY_RAG_EMBEDDING_*`

## Тесты

`backend/tests/` — pytest (440+ тестов): юниты сервисов и скиллов, контракты
эндпойнтов, golden-тесты RTF-шаблонов и пины WS-фан-аута. Гейт —
`npm run verify:backend` (`backend/verify.sh`: pytest + проверка одной
головы Alembic). Известная специфика: 4 ingestion-теста падают на Windows-хостах
(subprocess с shell-скриптом) — на Unix зелёные.
