# Progress Log

> Журнал значимых изменений (код, агентская среда, документация).
> Новые записи — сверху. Одна запись = одна завершённая порция работы:
> что и почему сделали, где смотреть, чем проверили.

## 2026-10-05 — ALK: stage 2 kernel-router-store выполнен (r6, COMPLETE)

**Что:** по решению пользователя вернулись к дорожной карте («от простого к
сложному», маленькие пакеты с полным ALK-циклом). Пакет
`tasks/2026-09-28-kernel-router-store/` отрефризен с r1 (устаревший
`main@d79de677`) до **r6** на baseline `dev@12d37cd` (merge backend PR #16).
Refreeze-цепочка: r2 (baseline + launchGate + leadOwned для план-пакета и
журнала) → r3 (закрытие findings аудита: base-фраза в developer-overview,
квотирование `--grep "Router|Store|Block"`, guard-скрипт в WS
forbiddenWrites) → r4 (compile-блокер: `artifactPaths` массив → dict
result/review) → r5 (leadOwned += VM-smoke handoff-файл для ownership-дельты)
→ r6 (per-attempt шаблоны `task-result-{attempt}.json` — конструктивное
требование ALK 2.15 для rework-цикла: архив попытки обязан жить по пути,
следующий путь обязан быть свободен). Пять раундов независимого plan-аудита
(CHANGES_REQUIRED → PASS×4), lock и worker packet перегенерированы на каждой
ревизии. ALK CLI 2.15.0 установлен в гитигнорный `.alk/venv`.

**Реализация (WS-KERNEL):** Router — параметризованные маршруты (`/chat/:id`,
`getParams()`, повторный заход обновляет `props.routeParams`), lazy-загрузка с
error-fallback, явный 404-роут, guard-seams `beforeEach` (блокировка/редирект/
отписка, кап глубины редиректов 10), `leave()`/`detach()` destroys блок и
гасит опоздавшие lazy-резолвы. Store — типизированные слайсы `update<K>`,
shallow-equality с пре-мутационным снапшотом (helpers.set мутирует),
`withStore` с per-instance previousState и отпиской в `destroy()`. Block —
детерминированный идемпотентный `destroy()` (off EventBus, каскад к children,
снятие DOM-событий, удаление элемента). main.ts и контракты stage 1 не тронуты.

**Проверено:** независимый frontend-ревьюер дал attempt 1 REWORK (2
воспроизведённых MEDIUM: stale params при `/chat/1`→`/chat/2`; race lazy при
уходе с маршрута — поздний mount затирал DOM; + LOW redirect-цикл, вакуумный
тест); фиксы в `635c93b`, attempt 2 — **ACCEPTED** (scratch-прогон поведения:
парамы, race, retry, циклы, `/5`→404). `npm run verify` — 47 тестов (было 23),
guard `--all` — 0 блокеров (9 warnings = прежний состав), build PASS,
ownership audit — 13 путей дельты классифицированы (0 unowned/forbidden).
implementation/final-implementation/package(--strict) аудиты — PASS;
workflow-state `COMPLETE` (state rev 15), final-proof
`work/…/evidence/WS-KERNEL/final-proof.json`. Локальная модель не
использовалась; авторизация исполнения выдана пользователем явно в сессии.

**Открыто:** два остаточных INFO ревью переданы stage 3 через TRANSITIONAL_DEBT
handoff (EV-KERNEL-2): `renderNotFound` не destroy'ит error-блок; self-redirect
не сбрасывает redirectDepth. Манифесты stages 3–4 всё ещё pinned на
`main@d79de677` — перед их запуском понадобятся собственные refreeze на
`dev`-baseline (LOW из plan-review).

## 2026-10-06 — ALK: stage 4 migrate-chats-profile выполнен (r5, COMPLETE)

**Что:** chats и profile переехали за границы фич — завершён четырёхэтапный
frontend-контур дорожной карты (kernel → module/guard → миграция → …cutover).
Пакет `tasks/2026-09-28-migrate-chats-profile/` отрефризен r1→r5 за ЧЕТЫРЕ
аудит-раунда (2× CHANGES_REQUIRED → PASS → PASS): r2 — dev-база + перенос
composition-root из stage 7 (снос pages.ts без переподключения main.ts
невозможен — дыра, найденная аудитом stage 3); r3 — legacy src/api сохранён
read-only до stage 7 (auth-фича и компоненты runtime-зависят), shared-компоненты
и utils/types.ts (DTO-определения) в writes; r4 — inputFile/avatar-цепочка в
writes, 404/500 остаются by-design, embed-спек синхронизирован; r5 — тест-пути
(план-шаг 3 был невыполним без них). Реализация: фичи chats/profile (порты,
слайсы, контроллеры за инжектируемыми портами; дефолтные адаптеры над
сохранённым legacy api; MessagesController — stage 1 ws-адаптер),
`features/index.ts` — композиция (logout профиля инъектируется из auth; guard v2
реально заблокировал прямой cross-feature импорт в работе), `main.ts` на
`createApp([auth, chats, profile])`, 5 компонентов на props-over-controllers,
снос 12 legacy-путей (4 страницы, pages.ts, 3 контроллера), debt-карта −7
записей (остаток Store.ts → stage 7).

**Проверено:** независимый ревьюер дал attempt 1 REWORK (2 MEDIUM: гонка
auth-гарда с fetchUser на холодной загрузке защищённого маршрута — Router.start
до резолва пользователя; план-шаг 3 без тестов) — закрыты в `795c962`
(fetchUser до Router.start + 9 feature-boundary тестов через r5), attempt 2 —
**ACCEPTED**. `npm run verify` — **64 теста** (было 55), guard `--all --strict`
— exit 0 (1 acknowledged → stage 7), build PASS, снос = инвентарь, импортное
замыкание без остатков. Аудиты implementation/final-implementation/
package(--strict) — PASS; workflow-state **COMPLETE** (rev 14). Practicum
smoke — честно UNAVAILABLE (внешняя сеть). Локальная модель не использовалась;
исполнение авторизовано пользователем явно.

**Открыто:** stage 7 (api-cutover) потребует refreeze: убрать main.ts и
features/index.ts из своих writes (владение перенесено сюда), снять src/api со
своих forbiddenWrites и взять снос 4 legacy api-файлов с адаптерами; снос
MessagesController вместе с WS-cutover (запись Store.ts). LOW-хвосты: слабый
тест поиска (стаб метода), мёртвая isProtectedRoute-ветка в main.ts
(унаследована 1:1). Заготовка auth-cutover-дизайна из этой сессии — для stage 7.

## 2026-10-05 — ALK: stage 3 module-kernel-guard-v2 выполнен (r2, COMPLETE)

**Что:** вслед за stage 2 (PR #17) выполнен stage 3 дорожной карты. Пакет
`tasks/2026-09-28-module-kernel-guard-v2/` отрефризен r1→r2 на baseline
`dev@8dffe6d` (per-attempt artifactPaths, leadOwned-фиксации план-пакета и
журнала, dev-base в launchGate/overview); независимый plan-аудит — PASS с
первого раунда; заморожен (lock, worker packet WS-MODULE-AUTH); исполнение
авторизовано пользователем явно в сессии. Реализовано: типизированное модульное
ядро (`src/core/module/{types,registry}.ts` — коллизии/циклы/неизвестные
зависимости с явными ошибками, топологический bootstrap; `src/core/app.ts` —
createApp-шов, подключение main.ts — stage 4); фича auth за границей
(`src/features/auth/`: ports без единого импорта, store-слайс, контроллер за
инжектированным портом с Practicum-адаптером над legacy AuthApi,
Router.beforeEach-гард, feature-страницы login/register — legacy не удалён);
guard v2 (features-ранг, cross-feature runtime = blocker / type-only =
warning, dynamic import() в сканере, TRANSITIONAL_DEBT → owner-карта строго по
handoff stage 2).

**Проверено:** независимый ревьюер дал attempt-1 раунд с MEDIUM (named
value-импорты из api классифицировались как type-only) — закрыт фиксом
`d0b071b` (классификационная конвенция в контракте шапки, `* as` ужесточён до
blocker, inline-`type` клаузы, задокументирован литеральный скоуп сканера;
5 форм клауз проверены пробами); attempt 2 — **ACCEPTED**.
`npm run verify` — 55 тестов (8 новых registry/app), guard `--all --strict` —
**exit 0** (9 warnings, все acknowledged → stage 4), build PASS. Аудиты
implementation / final-implementation / package(--strict) — PASS;
workflow-state **COMPLETE** (rev 10), final-proof в
`work/…/WS-MODULE-AUTH/final-proof.json`. Локальная модель не использовалась.

**Открыто:** carry-forward в stage 4: задокументировать отсутствие rollback в
`createApp` при подключении main.ts; пересмотреть ранг features/pages при
сносе legacy; заполнить sourceRevision в следующей ревизии EV-MODULE-1; refreeze
манифеста stage 4 на dev-baseline — и закрыть вопрос владения `src/main.ts`
(сейчас он вне write-set ни одного этапа, при этом stage 4 сносит импортируемые
им src/pages и src/controllers — LOW из plan-аудита).

## 2026-10-05 — VM smoke и handoff после вливания backend PR

**Что:** пользователь подтвердил вливание PR с пакетами backend chats/WebSocket/files
в `dev`. Для внутренней проверки поднят отдельный `chatty-vm` на KVM/libvirt:
Ubuntu Server 24.04.5, виртуальный диск 25 GB, сеть libvirt `default` в режиме
NAT. В VM клонирована ветка `feature/2026-09-28-backend-chats-ws-files`,
установлены Docker Engine/Compose и Node.js 22; операторский `.env` с секретами
хранится только в VM и в Git не попадает. Локальная модель в VM и в ревью не
использовалась.

**Проверено:** аппаратная виртуализация и libvirt; `docker run --rm
hello-world`; `docker compose config --quiet`; запуск Compose со здоровыми API,
PostgreSQL и RustFS; API `8000` доступен с хоста; RustFS `9000/9001` доступен
только внутри VM, что соответствует закрытой topology; `npm ci`, `npm run verify`,
own-mode Vite build и frontend-сервер на `3000`, доступный с хоста. Это bounded
внутренний smoke, а не production/public release.

**Открыто:** полный frontend-to-owned-backend cutover ещё не выполнен. Текущий
legacy `src/api/AuthApi.ts` использует `/auth/signin`, `/auth/signup`,
`/auth/user`, тогда как собственный backend предоставляет `/auth/login`,
`/auth/register`, `/auth/me`; собственные chats/files/WS adapters также остаются
следующей frontend-задачей. Публичное размещение, TLS/reverse-proxy,
production-cookie policy, firewall/backups и local-model gate не закрыты.
Перед следующим ALK-run нужно обновить локальный `dev` после merge: текущие
локальные refs в этом workspace ещё показывают cached `origin/dev@f56318c`, а
попытка `git fetch origin dev` не завершилась из-за сетевого доступа. Подробный
handoff: `docs/progress/2026-10-05-handoff.md`.

## 2026-10-01 — ALK: backend chats ownership refreeze

**Что:** пакет `tasks/2026-09-28-backend-chats-ws-files/` переведён на
revision 5 для явной фиксации controller-owned артефактов, которые должны
сохраняться в implementation delta: самого frozen plan-пакета и этого журнала.
Требования, acceptance/evidence, worker write-set, runtime-код и baseline не
изменялись; локальная модель по-прежнему исключена из review.

**Проверено:** независимый внешний plan audit дал `READY_TO_FREEZE`; lock и
worker packet пересозданы на revision 5. Workflow переадоптирован и завершён:
`WS-BE-CHAT` принят, implementation/final/package audits — `PASS`, state —
`COMPLETE` (revision 13). Повторно прошли backend tests/Alembic, `npm run
verify`, Compose config/build, live RustFS upload/download, typed WebSocket,
negative authz и health checks. Revision 4 и прежние runtime evidence сохранены
как предшествующие run-артефакты. Локальная модель не использовалась.

## 2026-09-30 — ALK: backend chats/WebSocket/files frozen and launched

**Что:** пакет `tasks/2026-09-28-backend-chats-ws-files/` переведён на revision 4
с exact baseline `origin/dev@f56318c5fce969b3243b69c8365b8880b6813e84`. После
исправления ALK-совместимого формата `artifactPaths` выполнен повторный внешний
read-only audit; локальная модель в review не использовалась. Созданы immutable
`plan.lock.json` и worker packet для `WS-BE-CHAT`; локальная модель/provider
интеграция остаётся вне этого этапа.

**Проверено:** external audit `PASS`, `plan check --require-completeness`,
`plan verify` с lock, acceptance/refs checks и task compile — PASS. Manifest
digest: `50c2f0d20420172199a8f2451dae8bc88ce3ada72bb3e59d0ff636ee99191129`;
packet set hash: `1394f3747547df8c8b324c7040a79116db279909b0fc7babc4b072db11b21130`.

**Открыто:** execution authorization получена, `WS-BE-CHAT` запущен на ветке
`feature/2026-09-28-backend-chats-ws-files`; далее — реализация domain-кода,
контроллерских integration seams, deterministic tests и независимый task audit.

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
## 2026-09-29 — ALK: backend revision 3 refrozen and worker packets compiled

**Что:** после compile-blocker revision 2 создан отдельный пакет
`tasks/2026-09-28-backend-skeleton-r3/`; revision 2 и её lock сохранены без
изменений. Исправлен только формат `workstreams[0].artifactPaths`: ALK 2.15
получает шаблоны `result`/`review` под прежним evidence-root. Обновлены
package-local ссылки, выполнены независимый повторный audit
`READY_TO_FREEZE` и `plan.lock.json` revision 3.

**Проверено:** manifest digest
`2ffcc9757346065348353c7524ba39c39472dca1d0731eb2b9ba60099e0d1710`,
`lock-create` (`filesystemVerified: true`), `plan check`, acceptance, refs и
`plan verify` — PASS. Standard worker packet compiled with digest
`1576ebab8f990ea5d4aec385c35ec96e29bcbd1deb131f80d457b95f0af80cf3`, compact
packet (`4k-strict`) — `e5bc9774052812288c4a8b80cbe78b468f574400cd7cad4a9173f5b47d936456`.
`plan delta` r2→r3 подтвердил отсутствие изменений требований, acceptance,
evidence, budgets, gates и write-set. `audit package --strict` остаётся
`REVIEW_REQUIRED` до появления implementation/final-audit receipts — это ожидаемо.

**Открыто:** implementation остаётся `implementationAuthorized: false`; локальная
модель и live Docker/PostgreSQL/MinIO не проверялись. Следующий контролируемый шаг
— execution worker `WS-BE-SKELETON` на ветке
`feature/2026-09-28-backend-skeleton` с PR в `dev`.

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
