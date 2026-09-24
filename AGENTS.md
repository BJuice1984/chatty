# AGENTS.md

Общие инструкции для ИИ-агентов, работающих с этим репозиторием. Редактируйте этот файл как единый источник; CLAUDE.md импортирует его.

## Проект

**Chatty** — мессенджер на чистом TypeScript без фреймворков (учебный проект курса middle.messenger Яндекс Практикума). Сборка — Vite 8, шаблоны — Handlebars, компонентный подход — собственный, на классе `Block`.

Требования: Node `^20.19.0 || >=22.12.0`. TypeScript зафиксирован на **5.9** — TS 7 это нативный компилятор без JS API, который нужен `@typescript-eslint`; не обновляйте его, пока typescript-eslint не заявит поддержку.

## Команды

```bash
npm run dev          # vite dev-сервер на порту 3000
npm run build        # проверка типов (tsc) + сборка в dist/
npm start            # build + express-статика из dist/ на порту 3000
npm test             # mocha (конфиг .mocharc.json, стек tsx + chai + sinon + jsdom)
npm test -- src/core/Block.test.ts       # один файл тестов
npm test -- --grep "Block"               # тесты по названию
npm run eslint       # проверка src/ (flat config в eslint.config.js)
npm run eslint:fix   # автофикс
npm run stylelint    # проверка **/*{.css,.scss}
npm run stylelint:fix
npm run cm           # интерактивный conventional-commit через commitizen
```

## Архитектура

Поток данных однонаправленный: **компонент → контроллер → API → бэкенд**, ответ пишется в **Store**, событие Store обновляет пропсы страниц.

- `src/main.ts` — входная точка: регистрирует все компоненты как Handlebars-хелперы, объявляет маршруты, на DOMContentLoaded получает пользователя и чаты; при ошибке редиректит на логин.
- `src/core/Block.ts` — базовый компонент. Жизненный цикл на `EventBus` (`init → render → componentDidMount/componentDidUpdate`). Пропсы обёрнуты в Proxy: запись через `setProps` эмитит `FLOW_CDU` и перерисовывает блок. Значения-инстансы `Block` в пропсах автоматически раскладываются в `this.children`. Шаблон рендерится через `compile()` (Handlebars + вставка детей через `__children`, ссылки через `__refs`).
- `src/core/registerComponent.ts` — превращает класс компонента в Handlebars-хелпер, чтобы компоненты вкладывались друг в друга прямо в `.hbs`-шаблонах.
- `src/utils/Router.ts` — singleton (`export default new Router('#app')`), history API, монтирует страницу в `#app` из `index.html`. Маршруты — в `src/main.ts` (`Routes`).
- `src/utils/Store.ts` — глобальное состояние на EventBus, `StoreEvents.Updated`. Типы состояния — `AppState`. Пишут в Store контроллеры (`store.set('chats', ...)`).
- `src/controllers/` — синглтоны (`export default new ...Controller()`), единственное место бизнес-логики; вызывают API и пишут в Store.
- `src/api/` — классы над `BaseApi`, работают через `HTTPTransport`. Бэкенд курса: `https://ya-praktikum.tech/api/v2` (`HTTPTransport.API_URL`).
- `src/utils/HTTPTransport.ts` — обёртка над fetch (+ `src/helpers/fetchWithRetry.ts`). `src/utils/WSTransport.ts` — WebSocket для сообщений чата (`MessagesController`).
- Шаблоны `.hbs` лежат рядом с компонентами и предкомпилируются кастомным плагином `vite-plugin-handelbars-precompile.ts` (обратите внимание на опечатку «handelbars» в имени файла — она в коде и путях).
- Стили — SCSS в `src/scss/` (миксины, переменные, normalize в `libs/`).
- `server/server.js` — express-статика из `dist/` (для проверки прод-сборки локально).

## Соглашения и ограничения

- Стиль кода enforced линтерами: отступы 4 пробела, одинарные кавычки, без точек с запятой, trailing-запятые в многострочных литералах. Не спорьте с `@stylistic`-правилами — запускайте `eslint:fix`.
- Импорты пишутся с расширением `.ts` (`moduleResolution: bundler`, `allowImportingTsExtensions`).
- Тесты (`src/**/*.test.*`) исключены из eslint; `src/scss/libs/**` и `src/scss/utils/scrollbar.scss` — из stylelint.
- Pre-commit хук husky сам запускает `test + eslint:fix + stylelint:fix` — автофиксы попадают в коммит; после коммита проверяйте, что хук ничего не «исправил» лишнего.
- CI (`.github/workflows/tests.yml`) — автотесты Практикума (bats). Запускается **только на PR из веток `sprint_N` в main** и требует, чтобы репозиторий был публичным. Прямые пушу в main CI не проверяют.
- Деплой — Netlify из `dist/` по `netlify.toml` (SPA-редирект `/* → /index.html`).
- Коммит-сообщения — conventional commits (`npm run cm`; конфиг commitlint есть, но commit-msg хук не подключён).
- Репозиторий GitHub: `BJuice1984/chatty` (origin по SSH).
