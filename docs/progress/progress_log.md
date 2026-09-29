# Progress Log

> Журнал значимых изменений (код, агентская среда, документация).
> Новые записи — сверху. Одна запись = одна завершённая порция работы:
> что и почему сделали, где смотреть, чем проверили.

## 2026-09-28 — Архитектурная документация docs/arch/

**Что:** полная документация архитектуры в `docs/arch/` (5 документов +
бэклог): `README.md` (слои, поток данных, диаграмма), `component-system.md`
(Block/EventBus/registerComponent, жизненный цикл), `routing-and-state.md`
(Router, Store, withStore), `data-layer.md` (контроллеры, API, HTTPTransport
на XHR, WSTransport), `build-and-infra.md` (vite-плагин .hbs, тесты, CI,
Netlify). Найденные шероховатости собраны в `known-issues.md` (7 пунктов с
чекбоксами: ре-рендер на каждый setProps, withStore без селективности, нет
fallback 404, commitlint теперь подключён — пункт закрыт, и др.). В AGENTS.md
добавлена ссылка на docs/arch и исправлена неточность (HTTPTransport —
XMLHttpRequest, не fetch).

**Проверено:** документация описывает код по фактическому чтению исходников;
`npm run verify` зелёный (typecheck + 15 тестов + eslint + stylelint).
## 2026-09-29 — ALK: backend skeleton frozen

**Что:** пакет `2026-09-28-backend-skeleton` переведён в `FROZEN` на revision 2.
К манифесту привязан независимый review
`tasks/2026-09-28-backend-skeleton/plan-review.json` с вердиктом
`READY_TO_FREEZE`; создан immutable lock
`tasks/2026-09-28-backend-skeleton/plan.lock.json`. Зафиксированный baseline —
`dev@d79de677facf8b06290523f9589808069f6cf621`, опубликованный как `origin/dev`.

**Проверено:** `plan lock-create` (`filesystemVerified: true`),
`plan check --require-completeness`, `plan acceptance-check`, `plan refs-check` и
`plan verify` с lock — PASS. `audit package --strict` остановлен на ожидаемом
`REVIEW_REQUIRED`, поскольку implementation/final-audit receipt появится только
после выполнения worker-пакета. Локальная модель, Docker/PostgreSQL/MinIO и
runtime-код не запускались.

**Открыто:** implementation остаётся `implementationAuthorized: false`. Следующий
шаг — отдельный execution worker на ветке
`feature/2026-09-28-backend-skeleton` с PR в `dev`; frontend-пакет остаётся DRAFT
до приёмки этого PR.

## 2026-09-28 — ALK: первый контур переведён на backend → frontend

**Что:** после уточнения scope мастер-план и program index переведены на
последовательный первый контур backend → frontend. Локальная модель исключена из
первого запуска: её
развёртывание считается внешним фактом, а проверка Ollama/model перенесена в
отдельный будущий gate. Пакет `2026-09-28-backend-skeleton` обновлён до revision 2
как первая минимальная внутренняя backend-поставка: health/readiness, auth, миграции,
Compose, root/backend verify и внутренний runbook. Пакет
`2026-09-28-env-api-abstraction` зафиксирован как следующий frontend-пакет после
приёмки backend в `dev`.

**Проверено:** JSON-манифест backend синхронизирован со specification, acceptance,
health ownership и runbook; runtime-код ещё не создавался. Структурные ALK-гейты и
второй независимый read-only audit дали `READY_TO_FREEZE`; `plan.lock.json` пока не
создавался до явного freeze.

**Открыто:** baseline `dev@d79de677facf8b06290523f9589808069f6cf621` создан
локально и опубликован на `origin`; остаются независимый review и freeze. Живые
Docker/PostgreSQL/MinIO проверки выполняются на внутреннем хосте и фиксируются как
`PASS` либо `UNAVAILABLE`.

## 2026-09-28 — ALK: program draft разделён на 11 stage packages

**Что:** после ревью program-level черновика он заменён индексом
`tasks/2026-09-28-ai-messenger-program/program-overview.md` и 11 самостоятельными
ALK-пакетами по master-plan: frontend stages 1–4, backend stages 5–6, cutover,
RAG, bot, AI UI и hardening/docs. Для каждого пакета закреплены отдельный
`plan-id`, branch/PR boundary, owner, write set, predecessor gate, acceptance/evidence
contract, security/release gates, manual checklist при необходимости и S2 tier digest.

Ownership остаётся disjoint: root npm metadata принадлежит backend skeleton,
`MessagesController` — env stage, `TRANSITIONAL_DEBT` handoff — kernel stage, guard
map — module stage, legacy deletion — migration stage, adapters/composition —
cutover stage, file contract — chat stage, shared `WSTransport`/history/docs — final
stage. В старом каталоге больше нет исполняемого program manifest.

**Проверено:** ALK `tier resolve` для всех 11 пакетов; для каждого
`plan check --require-completeness`, `plan acceptance-check`, `plan refs-check` и
read-only `plan verify` — PASS. Дополнительно проверено отсутствие пересечений
между 166 stage write paths. Код и runtime-сценарии не запускались;
`plan.lock.json` намеренно отсутствует до независимого review/freeze.

**Открыто:** каждый пакет остаётся `DRAFT`; перед execution нужны независимый
plan audit, явный freeze и создание lock уже на конкретном stage package.

## 2026-09-28 — Черновой ALK-план AI-messenger program

**Что:** в ветке `feature/agent-harness` создан S2 plan package
`tasks/2026-09-28-ai-messenger-program/` для реализации мастер-плана: спецификация,
developer overview, DAG из 14 workstreams, write-set ownership, acceptance/evidence
контракты, security/release gates и независимый review request. План намеренно остаётся
`DRAFT`: реализация не авторизована, `plan.lock.json` до независимого ревью не создаётся.

**Проверено:** `tier resolve` подтвердил S2, затем `specification check`,
`plan check --require-completeness`, `plan acceptance-check`, `plan refs-check`
и read-only `plan verify` — PASS.
Команды проекта и runtime-сценарии не запускались; отсутствие lock ожидаемо до freeze.

## 2026-09-27 — Фикс деплоя Netlify (EBADENGINE)

**Что:** `netlify.toml` теперь пиннит `NODE_VERSION = "22"` в
`[build.environment]`. Сборка PR падала на `npm install` с `EBADENGINE`:
Netlify использовал Node 18, а `engines: ^20.19.0 || >=22.12.0` (появился при
мажорном апгрейде зависимостей) в сочетании с `engine-strict=true` в `.npmrc`
делает несовпадение фатальным. Локально не воспроизводилось (Node 24).

**Проверено:** локально `npm run build` зелёный; после пуша — пересборка PR в
Netlify на Node 22.

## 2026-09-27 — Перенос агентских практик из zakazprom-front

**Что:** архитектурный guard + входной скилл, откалиброванные по реальному коду.

- `feat(claude)` [`721dc1f`]: PostToolUse-guard `.claude/hooks/scripts/guard-architecture.mjs`
  (блокер — импорт вверх по слоям и runtime-импорт `api/` в UI; warning — типы
  из `api/` в UI; долг подавляется через `TRANSITIONAL_DEBT`), подключение в
  `.claude/settings.json`, входной скилл `chatty-dev`, заметки в AGENTS.md.
- `refactor(types)` [`99e88c7`]: guard при калибровке нашёл настоящий блокер —
  `components/messenger` тянул интерфейсы `Input`/`Button` из *страницы*
  profile (components→pages). Типы вынесены в `src/utils/types.ts`,
  `Button` стал дженериком, исправлена опечатка `alue`.
- Осознанно НЕ перенесено (по принципу «расширяй по факту» из их же гайда):
  `script-ai` dispatcher, select-validation-gates, `.ai-artifacts`,
  evals-runner, `.codex`-зеркало — machinery под другой стек.

**Проверено:** guard `--all` — 0 блокеров (9 warnings: 7 известных типовых
импортов + 2 подавленных долга Store.ts); симуляция PostToolUse покрывает
block/warning/тишину; `npm run verify` зелёный.

## 2026-09-27 — Агентский харнесс под agent-lifecycle-kit

**Что:** репозиторий стал харнессом для плагина ALK v2.15.0. Ветка
`feature/agent-harness`, 7 коммитов `21aeb62..1a96b27` (+2 позже).

- Evidence-гейт: `npm run typecheck` + `npm run verify`
  (typecheck → mocha → eslint → stylelint, fail-fast) — команда, которую
  план-манифесты ALK цитируют в `validation.commands`.
- Git-гейты: pre-commit → строгий `verify` без автофиксов; commit-msg →
  commitlint (конфиг переименован в `.cjs` — был сломан ESM `"type": "module"`).
- CI `verify.yml`: npm ci + verify на все PR и прямые пушu в main
  (bats-workflow Практикума не тронут).
- Среда Claude: `.claude/settings.json` (командный allow-лист, `agent-lifecycle`
  + fallback `py -3.12 -m agent_lifecycle`), slash-команда `/verify`.
- Конвенции: `tasks/README.md` (план-пакеты коммитятся, `work/` и `.alk/`
  игнорируются), `docs/project-principles.json` (digest `08c989…`,
  `principles check` PASS), раздел про ALK в AGENTS.md.
- Локально (не в git): CLI `agent-lifecycle` 2.15.0 в Python 3.12,
  `.alk/project-profile.json` из пресета `feature-implementation` (adapter
  `claude`), `profile check` PASS.

**Попутно починено (найдено гейтом при настройке):**

- `npm run build` был сломан на main: `AppState.messages` объявлен не тем
  типом (реально `Record<number, Message[]>`), 2 ошибки narrowing в EventBus;
  исчез каст `as unknown as` в messenger.
- Windows-чекауты падали на 2740 linebreak-ошибках eslint → `.gitattributes`
  с `eol=lf`.
- `node_modules` не соответствовал package.json после апгрейда зависимостей
  → `npm ci`.

**Проверено:** `npm run verify` зелёный (tsc, 15 тестов, eslint, stylelint);
негативные тесты (плохой commit message отклонён, ошибка типов роняет
typecheck); CI-джоба Verify зелёная на PR.
