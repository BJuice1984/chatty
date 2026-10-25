# NEXT — точка входа для следующей сессии

Обновлено: 2026-10-25 (хвосты stories-ws-push закрыты веткой
`feature/2026-10-25-next-tails`; до этого — ALK-прогон
`2026-10-25-stories-ws-push`, WS-push историй, PR #34 смёржен в `dev`).

## Состояние

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

## Приоритеты следующей сессии (согласовано 2026-10-23, пп.1–2 закрыты 2026-10-25)

1. **RAG-эмбеддинги** — на OpenAI-совместимом инференс-сервере поднять
   `/v1/embeddings` и закрыть пробел AI-ассистента (`src/features/ai-assistant/`).
   Подробный операторский план с runbook и чек-листом приёмки:
   `docs/plans/2026-10-25-rag-embeddings.md` (код контура готов, исполнение
   заблокировано доступом к инференс-серверу; выбрать вариант A/B/C и
   зафиксировать модель эмбеддингов до первой загрузки документов).

Хвосты закрыты 2026-10-25 веткой `feature/2026-10-25-next-tails`:
`mark_viewed` — `INSERT ... ON CONFLICT DO NOTHING` по композитному PK;
`unread_counts` — один SELECT (memberships + LEFT JOIN маркера + COUNT
FILTER) вместо 3 запросов + COUNT на чат; дубль `GET /chats` — bootstrap
`fetchChats` удалён из `src/main.ts` (CDM страницы чатов, LIVE-3, —
единственный писатель на заходе). Остались осознанные пределы stories-push
(см. план пакета): события вне страницы чата пропускаются, другие вкладки
владельца не получают `story_created`, запушенное кольцо может пережить
серверный TTL.

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
