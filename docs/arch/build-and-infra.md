# Сборка, тесты и инфраструктура

## Инструменты

- **Vite 8** — dev-сервер и прод-сборка (`vite.config.ts`: порт **3001**,
  `strictPort` — занятый порт даёт loud-отказ, а не молчаливый сдвиг,
  который рассинхронизирует front-origin с `CHATTY_ALLOWED_ORIGINS`
  бэкенда; выход в `dist/`).
- **TypeScript 5.9** — только проверка типов: `build` = `tsc && vite build`
  при `noEmit: true`. Версия зафиксирована: TS 7 (нативный компилятор)
  несовместим с `@typescript-eslint`.
- **Sass/SCSS** — стили в `src/scss`, подключаются из шаблонов и входного
  `index.html`. В `src/scss/**` комментарии не пишутся (конвенция);
  `src/scss/libs/**` и `utils/scrollbar.scss` — вендорные, исключены из
  stylelint.
- **Node** — `^20.19.0 || >=22.12.0` (поле `engines`).

## Кастомный плагин предкомпиляции Handlebars

`vite-plugin-handelbars-precompile.ts` (имя с опечаткой — рабочее,
см. [known-issues.md](known-issues.md)) перехватывает модули
`.hbs`/`.handlebars` через хук `transform` и превращает файл в ES-модуль:

```ts
import Handlebars from 'handlebars'
export default Handlebars.template(<результат Handlebars.precompile(code)>)
```

Благодаря этому импорт `template from './button.hbs'` в компоненте — это
уже готовая функция шаблона, без компиляции в рантайме.

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` | dev-сервер на 3001 против локального own-бэкенда (`.env.development`) |
| `npx vite --mode own` | то же с явным Vite-режимом `own` (грузит `.env.own`) |
| `npm run build` | проверка типов + сборка в `dist/` |
| `npm start` | `build` + `server/server.js` — express-статика из `dist/` на 3001 |
| `npm run typecheck` | только `tsc --noEmit` |
| `npm test` | mocha; один файл: `npm test -- src/core/Block.test.ts`; фильтр: `npm test -- --grep Block` |
| `npm run eslint[:fix]` | eslint 10, flat config `eslint.config.js`, линтит только `src/` |
| `npm run stylelint[:fix]` | stylelint 17, все `.css/.scss` |
| `npm run verify` | единый гейт фронта: typecheck + mocha + eslint + stylelint (fail-fast) |
| `npm run verify:backend` | гейт бэкенда: `backend/verify.sh` (pytest + alembic) |
| `npm run verify:all` | фронт + бэкенд вместе |
| `npm run cm` | интерактивный conventional-commit (commitizen) |

## Тесты

- Раннер — **mocha 12** с загрузчиком **tsx** (`.mocharc.json`:
  `node-option: import=tsx`, спеки `src/**/*.test.*`). 830+ тестов.
- **jsdom** в `mochaSetup.ts` подменяет `window`/`document`/`Node`/`MouseEvent`.
- Утверждения и стабы — **chai 6** + **sinon 22**.
- Бэкенд — **pytest** (440+ тестов) в `backend/tests/`, включая
  golden-тесты RTF-шаблонов и пины WS-фан-аута.
- Тестовые файлы исключены из eslint (`src/**/*.test.*` в ignores).

## Линтеры и качество

- **eslint 10** (flat config): `@eslint/js` recommended +
  `typescript-eslint` recommendedTypeChecked + `eslint-config-stylelint`.
  Стилистические правила — плагин `@stylistic` (отступы 4, одинарные
  кавычки, без `;`, trailing-запятые). Спорить с `@stylistic` бесполезно —
  `npm run eslint:fix`.
- **stylelint 17** (`stylelint-config-standard-scss`).
- **husky 9** pre-commit: `npm run verify` — **строгий гейт без
  автофиксов**; нужны фиксы — запускайте `eslint:fix`/`stylelint:fix`
  руками до коммита.
- **commit-msg хук** — commitlint (conventional commits); интерактивно —
  `npm run cm`. `--no-verify` — аварийный обход, нежелателен.

## Архитектурный guard

PostToolUse-хук `.claude/hooks/scripts/guard-architecture.mjs` блокирует
ИИ-редакторам (и проверяет по CLI: `node … --all [--strict]`) импорты
вверх по слоям `pages → components → controllers → api → utils → core`,
runtime-импорты `api/` из UI и cross-feature импорты вне портов/композиции.
Исторический долг — константа `TRANSITIONAL_DEBT` в скрипте.

## CI — `.github/workflows/verify.yml`

`npm run verify` на всех PR и прямых пушах в `main`; Node 22, `npm ci`,
concurrency-группа на ветку.

## Рантайм и деплой

- **Compose-стек бэкенда** (`docker-compose.yml`): `api` (FastAPI,
  alembic+seed на старте) + `db` (postgres:16-alpine) + `object-storage`
  (RustFS, S3-совместимый) + volume-init; сеть `chatty-internal`, порты
  публикуются на `127.0.0.1` по умолчанию. Операторский env-файл (секреты)
  в git не входит; preflight/health/rollback —
  [docs/deployment/own-backend.md](../deployment/own-backend.md).
- **Netlify** (`netlify.toml`): сборка `npm run build`, публикация `dist/`,
  SPA-редирект `/* → /index.html` (status 200) — чтобы маршруты Router
  открывались по прямой ссылке.
- `server/server.js` — express-статика из `dist/` для локальной проверки
  prod-сборки.

## Структура репозитория

```
├── index.html                          # входной документ, <main id="app">
├── vite.config.ts                      # конфиг сборки
├── vite-plugin-handelbars-precompile.ts # кастомный плагин .hbs → ES-модуль
├── server/server.js                    # express-статика для локальной проверки prod
├── src/                                # код фронтенда (см. README.md)
├── backend/                            # собственный бэкенд (см. backend.md)
├── docs/                               # arch/, deployment/, progress/, plans/
├── tasks/                              # ALK план-пакеты (коммитятся)
├── work/                               # ALK рантайм прогонов (гитигнор)
├── .github/workflows/verify.yml        # CI: npm run verify
├── docker-compose.yml                  # стек бэкенда
└── netlify.toml                        # деплой фронта
```

## Агентская среда (ALK)

Репозиторий — харнесс для плагина agent-lifecycle-kit: планирование →
ревью → freeze → worker-пакеты → аудиты. План-пакеты в `tasks/<plan-id>/`
коммитятся, рантайм — в `work/` (гитигнор). Evidence-команда план-манифестов
— `npm run verify`. Конвенции и операторские команды — `tasks/README.md`.
