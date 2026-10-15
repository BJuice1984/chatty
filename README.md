[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
[![Netlify Status](https://api.netlify.com/api/v1/badges/88434455-8cb0-47c4-bae9-b763d88135f9/deploy-status?branch=deploy)](https://app.netlify.com/sites/startling-faloodeh-01b44f/deploys)
<h1 align="center">Веб-приложение для общения "Chatty"</h1>

## О проекте

Учебный мессенджер курса middle.messenger (Яндекс Практикум): чистый
TypeScript без фреймворков, сборка — Vite, шаблоны — Handlebars, собственный
компонентный слой на классе `Block` (жизненный цикл на `EventBus`, Proxy над
пропсами). Данные идут однонаправленно: компонент → контроллер → API/WS-шлюз →
бэкенд, ответ пишется в `Store`, событие Store перерисовывает страницу через
`withStore`.

Приложение работает в двух режимах (переключение — env, см. `.env.example` /
`.env.own.example`):

- **practicum** — бэкенд курса `https://ya-praktikum.tech/api/v2`;
- **own** — собственный бэкенд репозитория (`backend/`: FastAPI + PostgreSQL +
  RustFS через `docker compose`, внешний Ollama для AI-ассистента; runbook —
  [docs/deployment/own-backend.md](docs/deployment/own-backend.md)).

## Возможности

- Авторизация/регистрация/профиль, валидация форм по `blur`/`focus`/`submit`
- Чаты: создание, удаление, аватар, пользователи (поиск по логину), список
- Сообщения по WebSocket (`WSTransport`): bounded-реконнект с растущим
  backoff, явный `close()` без реконнекта и с чисткой слушателей/ping
- История чата: курсорная пагинация «загрузить ещё» (`before_id`/limit в
  own-режиме, `get old` в practicum) с дедупликацией по id
- AI-ассистент (own-режим): поиск по документам чата (RAG) и вопрос-ответ с
  вложениями; текстовый рендер ответов без исполняемого DOM
- Фичи-модули (`src/features/`) за портами: реализация выбирается по env.mode,
  UI не знает о бэкенде; архитектурные границы следит guard-хук

## Установка и запуск

1. Клонируйте репозиторий: `git clone https://github.com/BJuice1984/chatty.git`
2. `npm ci` (Node `^20.19.0 || >=22.12.0`)
3. Скопируйте `.env.example` → `.env.development` уже настроен под practicum;
   для своего бэкенда — `.env.own.example` → `.env.own`
4. Режимы:
   - `npm run dev` — dev-сервер на порту 3000 (practicum)
   - `npx vite --mode own` — dev-сервер против своего бэкенда
   - `npm run build` — проверка типов + сборка в `dist/`
   - `npm start` — сборка и express-статика из `dist/` на порту 3000

Свой бэкенд (own-режим): Preflight/health/rollback — в
[docs/deployment/own-backend.md](docs/deployment/own-backend.md); коротко —

```bash
docker compose --env-file <операторский-env> config --quiet   # preflight
docker compose --env-file <операторский-env> up -d --build    # api + db + rustfs
curl -f http://127.0.0.1:8000/health && curl -f http://127.0.0.1:8000/ready
```

Ollama (модели `qwen3:14b`, `nomic-embed-text`) — внешняя зависимость хоста.

## Проверки

```bash
npm run verify         # typecheck + mocha + eslint + stylelint (fail-fast)
npm run verify:backend # backend/verify.sh: pytest + alembic (свой бэкенд)
npm run verify:all     # фронт + бэкенд
npm test               # только mocha; один файл: npm test -- src/core/Block.test.ts
```

Pre-commit хук (husky) прогоняет `npm run verify`; коммиты — conventional
(`npm run cm`).

## Используемый стек

![TS](https://img.shields.io/badge/typescript%20-%23007ACC.svg?&style=for-the-badge&logo=typescript&logoColor=white)
![SASS](https://img.shields.io/badge/SASS%20-hotpink.svg?&style=for-the-badge&logo=SASS&logoColor=white)
![HandleBars](https://img.shields.io/badge/Handlebars-23272f?style=for-the-badge&logo=handlebarsdotjs)
![Vite](https://img.shields.io/badge/Vite-23272f?style=for-the-badge&logo=vite)
![Netlify](https://img.shields.io/badge/netlify-%23000000.svg?&style=for-the-badge&logo=netlify&logoColor=#00C7B7)
![Mocha](https://img.shields.io/badge/mocha.js-323330?style=for-the-badge&logo=mocha&logoColor=Brown)
![Chai](https://img.shields.io/badge/chai.js-323330?style=for-the-badge&logo=chai&logoColor=red)
![Python](https://img.shields.io/badge/python-3670A0?style=for-the-badge&logo=python&logoColor=ffdd54)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![Docker](https://img.shields.io/badge/docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

## [Ссылка на проект](https://deploy-preview-5--startling-faloodeh-01b44f.netlify.app/)
## [Ссылка на макет Figma](https://www.figma.com/file/bM8yGd4zQLl4H7VQSThAma/Chatty-UI-Kit---Messenger-App?type=design&node-id=0%3A1&mode=design&t=S96tosRx5QfhpWsh-1)

## Автор

[Ильяс Сибгатуллин](https://github.com/BJuice1984): [i.sibgatullin59@gmail.com](i.sibgatullin59@gmail.com)
