# NEXT — точка входа для следующей сессии

Обновлено: 2026-10-25 (после ALK-прогона `2026-10-25-stories-ws-push` —
WS-push историй, ветка `feature/2026-10-25-stories-ws-push`, PR в `dev`).

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

Хвосты: `mark_viewed` — check-then-insert гонка (теоретическая) →
`INSERT ... ON CONFLICT DO NOTHING` в `backend/app/services/stories.py`;
консолидация `unread_counts` в один запрос (сейчас 3 запроса + COUNT на чат
с маркером чтения — найдено ревью 2026-10-25, осознанно вне скоупа
chats-list-members); дубль `GET /chats` на холодной загрузке — бутстрап
`src/main.ts:77` дублирует CDM-фетч страницы чатов (`pages/chat/chat.ts:451`,
LIVE-3): убрать блок fetchChats из `main.ts` (он же делает бесполезный фетч
на логине/регистрации); микроправка отдельной веткой — `main.ts` в
forbiddenWrites пакета 2026-10-25-chats-list-members. Пределы stories-push
(осознанные, см. план пакета): события вне страницы чата пропускаются,
другие вкладки владельца не получают `story_created`, запушенное кольцо
может пережить серверный TTL.

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
