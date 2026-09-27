---
name: chatty-dev
description: Use for development, bugfix, refactor, and implementation work in the chatty repository when tasks touch the Block component core, controllers, API layer, Store/Router utils, Handlebars templates, or the messenger UI. Point of entry for AI agents.
---

# chatty dev

Точка входа для любой нетривиальной работы в `chatty` (мессенджер на чистом
TypeScript + Vite + Handlebars, компоненты на собственном классе `Block`).

## Источники истины

- `AGENTS.md` (корень) — архитектура, команды, соглашения. Грузится в каждую
  сессию автоматически.
- `tasks/README.md` — конвенции план-пакетов agent-lifecycle-kit (ALK): пути,
  evidence-команда, операторские проверки.
- `docs/project-principles.json` — стабильные принципы проекта для агентов.

## Companion

- Плагин `agent-lifecycle-kit` — для planning сложных фич:
  `agent-lifecycle-kit:agent-first-planning`, `audit-agent-plan`,
  `agent-plan-to-workers`, `audit-plan-implementation`.
- Slash-команда `/verify` — единый гейт с evidence-вердиктом.

## Workflow

1. **Собери контекст до правки**: целевой компонент/контроллер, его `.hbs`
   шаблон, `src/core/Block.ts` (жизненный цикл, Proxy над пропсами), при
   работе с состоянием — `src/utils/Store.ts`.
2. **Размести изменение в правильном слое.** Зависимости идут только вниз:
   `pages → components → controllers → api → utils → core/helpers`.
   Компоненты не ходят на бэкенд сами — только через контроллеры
   (`src/controllers/`, синглтоны), контроллеры пишут в Store.
3. **Реализуй минимальный связный кусок**; типы DTO не тащи из API-файлов в UI
   (это известный техдолг — новые случаи не добавляй).
4. **Валидируй**: `npm run verify` (typecheck → mocha → eslint → stylelint,
   fail-fast). Прошёл — коммить; хук pre-commit прогонит verify ещё раз.
5. **Документируй**: значимая правка (код, агентская среда, документация) →
   запись сверху в `docs/progress/progress_log.md` (что/почему, коммит, чем
   проверено).

## Автоматический guard

PostToolUse-хук `.claude/hooks/scripts/guard-architecture.mjs` проверяет каждый
Write/Edit в `src/`:
- **blocker** — импорт вверх по слоям (`layer-direction`) и runtime-импорт из
  `api/` в components/pages (`ui-runtime-api`);
- **warning** — импорт типов из `api/` в UI (`ui-type-api-import`).

CLI-прогон: `node .claude/hooks/scripts/guard-architecture.mjs --all [--strict]`.
Исторический долг — в `TRANSITIONAL_DEBT` внутри скрипта (blocker понижается до
warning); починил нарушение — удали запись.

## Правила

- TypeScript ~5.9 (не обновлять до typescript-eslint поддержки TS 7).
- Импорты с расширением `.ts`; стиль — 4 пробела, одинарные кавычки, без `;`.
- Тесты — mocha + chai + sinon + jsdom (`src/**/*.test.ts`); bugfix получает
  regression-тест.
- Стили — SCSS в `src/scss/`; шаблоны `.hbs` рядом с компонентами.
- Не трогать: `.github/workflows/tests.yml`, ветки `sprint_*` и `deploy`.

## Когда НЕ использовать

- Тривиальные правки (опечатки, rename) — делай сразу, guard и verify хватит.
- Правки только в документации.
