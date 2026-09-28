# Сборка, тесты и инфраструктура

## Инструменты

- **Vite 8** — dev-сервер и прод-сборка (`vite.config.ts`: порт 3000, выход в `dist/`).
- **TypeScript 5.9** — только проверка типов: `build` = `tsc && vite build` при `noEmit: true`. Версия зафиксирована: TS 7 (нативный компилятор) несовместим с `@typescript-eslint`.
- **Sass/SCSS** — стили в `src/scss`, подключаются из шаблонов и входного `index.html`.
- **Node** — `^20.19.0 || >=22.12.0` (поле `engines`).

## Кастомный плагин предкомпиляции Handlebars

`vite-plugin-handelbars-precompile.ts` (имя с опечаткой — рабочее) перехватывает модули `.hbs`/`.handlebars` через хук `transform` и превращает файл в ES-модуль:

```ts
import Handlebars from 'handlebars'
export default Handlebars.template(<результат Handlebars.precompile(code)>)
```

Благодаря этому импорт `template from './button.hbs'` в компоненте — это уже готовая функция шаблона, без компиляции в рантайме.

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` | dev-сервер на 3000 |
| `npm run build` | проверка типов + сборка в `dist/` |
| `npm start` | `build` + `server/server.js` — express-статика из `dist/` на 3000 |
| `npm test` | mocha; один файл: `npm test -- src/core/Block.test.ts`; фильтр: `npm test -- --grep Block` |
| `npm run eslint[:fix]` | eslint 10, flat config `eslint.config.js`, линтит только `src/` |
| `npm run stylelint[:fix]` | stylelint 17, все `.css/.scss` |

## Тесты

- Раннер — **mocha 12** c загрузчиком **tsx** (`.mocharc.json`: `node-option: import=tsx`, спеки `src/**/*.test.*`).
- **jsdom** в `mochaSetup.ts` подменяет `window`/`document`/`Node`/`MouseEvent`.
- Утверждения и стабы — **chai 6** + **sinon 22**.
- Покрытие: `Block`, `Router`, `HTTPTransport`, компоненты `Button` и `Input`.
- Тестовые файлы исключены из eslint (`src/**/*.test.*` в ignores).

## Линтеры и качество

- **eslint 10** (flat config): `@eslint/js` recommended + `typescript-eslint` recommendedTypeChecked (типизированные правила требуют `projectService`) + `eslint-config-stylelint`. Стилистические правила — плагин `@stylistic` (отступы 4, одинарные кавычки, без `;`).
- **stylelint 17** (`stylelint-config-standard-scss`); вендорный `src/scss/libs/**` и `scrollbar.scss` игнорируются.
- **husky 9** pre-commit: `npm run test && npm run eslint:fix && npm run stylelint:fix` — автофиксы попадают в коммит.
- Коммит-сообщения — conventional commits; интерактивно через `npm run cm` (commitizen). Конфиг commitlint есть, но commit-msg хук не подключён.

## CI — `.github/workflows/tests.yml`

Автотесты Яндекс Практикума (bats из репозитория `tests-middle-frontend`). Особенности:

- запускаются **только на PR из веток `sprint_N` в `main`** (фильтр по `github.head_ref`);
- шаг «проверь, что репозиторий публичный» — на приватном workflow падает намеренно (`exit 1`);
- Node 22.x; набор bats-тестов выбирается по номеру спринта + отдельный прогон `node_build.bats`.

Прямые пуши в `main` CI не проверяют.

## Деплой — Netlify

`netlify.toml`: сборка `npm run build`, публикация `dist/`, SPA-редирект `/* → /index.html` (status 200) — чтобы маршруты Router открывались по прямой ссылке. Деплой привязан к веткам, на имя репозитория не завязан.

## Структура репозитория

```
├── index.html                          # входной документ, <main id="app">
├── vite.config.ts                      # конфиг сборки
├── vite-plugin-handelbars-precompile.ts # кастомный плагин .hbs → ES-модуль
├── server/server.js                    # express-статика для локальной проверки prod
├── src/                                # код приложения (см. README.md)
├── docs/arch/                          # эта документация
├── .github/workflows/tests.yml         # CI практикума
└── netlify.toml                        # деплой
```
