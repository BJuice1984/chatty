# Plan review request — 2026-11-06-chat-create-flow

## Что ревьюим

S2-пакет `tasks/2026-11-06-chat-create-flow/`: specification.json, plan.md, developer-overview.md, acceptance-criteria.md, plan.manifest.json (status DRAFT, rev 1). Запрос независимого ревью по конвенции audit-agent-plan до freeze.

## Суть изменения одной строкой

One-click создание чата («Чат с» + автоселект) вместо карточки-формы ChatListCreate; серверное автодополнение названия именами добавляемых участников (пока не задано своё — chats.auto_titled, миграция 013); подсказка пустого чата с кнопкой «добавить»; кнопка «+AI» в шапке каждого чата включает бота (is_ai через расширенный PUT /chats/{id}).

## Решения оператора (clarification 2026-11-06)

1. Точка входа — существующая кнопка «Создать чат» шапки списка; форма-карточка удаляется.
2. «+AI» включает бота в текущем чате (расширение PUT), не создаёт отдельный AI-чат.
3. Подсказка — в любом чате без сообщений и соучастников (гейт по данным).
4. Авто-название — серверный персистентный флаг auto_titled (основа будущего LLM-нейминга; сам LLM-нейминг — future-step, вне скоупа).

## Базовая линия

dev @ efdc8c3 (2026-11-06): npm run verify зелёной (mocha 696 passing); backend verify.sh — 291 passed + 4 известных Windows-ingestion-падения (test_converter.py, env-специфика, полный лог сохранён).

## На что смотреть отдельно (просьба ревьюера)

- Корректность обобщения rename → update в сервисе: сохранение идемпотентного no-op (равный title — без системного сообщения и БЕЗ гашения auto_titled) и гашение auto_titled только при фактическом rename.
- Автодополнение в add_member: атомарность транзакции, переиспользование chat_renamed (не плодим ивенты), кап 200 с тихим пропуском, исключение is_dm.
- Смена контракта ChatsPort.createChat (void → {chatId}): все ли вызовы/тесты учтены; ai-assistant-порт не задет.
- Фронт: инпут авто-названия (renamingTitle-механика) — не ломает ли статичный dblclick-режим и архивный гейт; пустое состояние — полнота гейта (4 условия); createAndSelect — порядок POST → fetchChats → selectChat; мобильный CDU-гвард.
- Write-set'ы волн: полнота (удаления ChatListCreate: components.ts, scss, тесты) и отсутствие пересечений; forbiddenWrites для бэкенда (миграции 001–012, docs/, src/) и фронта (backend/**, contacts, ai-assistant, core, Store.ts).
- Non-goals не протекают в реализацию (LLM-нейминг, выключение бота, DM-контракт).

## Вердиш

Ожидаем READY_TO_FREEZE / NEEDS_REFINEMENT с номерованными findings.
