# NEXT — точка входа для следующей сессии

Обновлено: 2026-10-25 (после ALK-прогона `2026-10-25-chats-list-members` — N+1
аватаров закрыт, ветка `feature/2026-10-25-chats-list-members`, PR в `dev`).

## Состояние

N+1 аватаров списка чатов закрыт: `GET /chats` отдаёт краткие составы
участников (`members: [{id, login, display_name, avatar_url}]`, один
batch-IN-запрос, cap 10 по `joined_at`, диалоги не режутся; `POST /chats` и
`GET /chats/{id}` — `members: []` через `default_factory`), фронт-адаптер
`toChatInfo(response, meId)` собирает аватар диалога лестницей «свой
avatar_url чата → реальный аватар собеседника → pool → пусто»,
контроллер больше не делает per-chat members-запросов
(`applyCompanionAvatar` удалён), а `changeChatAvatar` патчит ровно один чат
в сторе из ответа загрузки — без рефетча списка. Гейты: фронт 322 mocha,
бэкенд 179 pytest passed (+4 известные Windows-специфичные падения
ingestion-конвертера — вне чатов, см. runbook-заметку ниже), guard strict 0.

## Приоритеты следующей сессии (согласовано 2026-10-23, п.1 закрыт 2026-10-25)

1. **WS-push новых историй** — лента сейчас обновляется только при заходе на
   страницу или после собственных действий; событие по WS сделает кольца
   живыми.
2. **RAG-эмбеддинги** — на OpenAI-совместимом инференс-сервере поднять
   `/v1/embeddings` и закрыть пробел AI-ассистента (`src/features/ai-assistant/`).

Хвосты: `mark_viewed` — check-then-insert гонка (теоретическая) →
`INSERT ... ON CONFLICT DO NOTHING` в `backend/app/services/stories.py`;
консолидация `unread_counts` в один запрос (сейчас 3 запроса + COUNT на чат
с маркером чтения — найдено ревью 2026-10-25, осознанно вне скоупа
chats-list-members); дубль `GET /chats` на холодной загрузке — бутстрап
`src/main.ts:77` дублирует CDM-фетч страницы чатов (`pages/chat/chat.ts:451`,
LIVE-3): убрать блок fetchChats из `main.ts` (он же делает бесполезный фетч
на логине/регистрации); микроправка отдельной веткой — `main.ts` в
forbiddenWrites пакета 2026-10-25-chats-list-members.

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
