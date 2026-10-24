# NEXT — точка входа для следующей сессии

Обновлено: 2026-10-23 (после влития PR #32 `feature/2026-10-21-avatars-stories`).

## Состояние

Тема «истории и аватары на own-бэкенде» полностью закрыта и влита в `dev`
(весь стек: `chats-social` → `2026-10-21-stories` (#31) →
`2026-10-21-avatars-stories` (#32)). Гейты на момент влития: фронт
`npm run verify` — 319 mocha, бэкенд `verify:backend` — 181 pytest,
`guard-architecture --all --strict` — 0 нарушений, миграция `007_avatars_stories`
round-trip проверена и на scratch-SQLite, и на чистом compose-PostgreSQL.

Контракт: `/files` (глобальные медиа `chat_id IS NULL`), `POST /files/avatars`
(kind=user|chat, owner-only чаты), `/stories` (лента: свои первыми и всегда
непросмотренные владельцу; чужие — непросмотренные выше просмотренных; TTL 24 ч,
cap 100, `is_own`; идемпотентный view; owner-only delete), `avatar_url`
(«{file_id}/download») в auth/chats/members; фронт — `src/features/chats/stories/`,
реалтайм-счётчик непрочитанных в `ws/own.ts` (`incrementUnread`), демо-сид
opt-in `CHATTY_SEED_DEMO_STORIES` (ранбук: `docs/deployment/own-backend.md`).

## Приоритеты следующей сессии (согласовано 2026-10-23)

1. **N+1 аватаров в списке чатов** — главный приоритет: `fetchChats` делает
   `GET /chats/{id}/members` на каждый чат ради аватара собеседника
   (`applyCompanionAvatar` в `src/features/chats/controller.ts`).
   Решение: участники/аватар прямо в `GET /chats` (бэкенд + own-адаптер +
   упрощение контроллера).
2. **WS-push новых историй** — лента сейчас обновляется только при заходе на
   страницу или после собственных действий; событие по WS сделает кольца живыми.
3. **RAG-эмбеддинги** — на OpenAI-совместимом инференс-сервере поднять
   `/v1/embeddings` и закрыть пробел AI-ассистента (`src/features/ai-assistant/`).

Хвосты: `mark_viewed` — check-then-insert гонка (теоретическая) →
`INSERT ... ON CONFLICT DO NOTHING` в `backend/app/services/stories.py`.

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

Для нетривиальной фичи — полный ALK-цикл (см. `tasks/README.md` и текущий
пример пакета `tasks/2026-10-21-avatars-stories/`); история работы —
`docs/progress/progress_log.md` (новое сверху).
