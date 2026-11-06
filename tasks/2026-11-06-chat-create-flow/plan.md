# План 2026-11-06-chat-create-flow: редизайн механики создания чата

Тир S2, две волны: бэкенд (миграция 013 + контракты) → фронт (удаление ChatListCreate, create-and-select, авто-название, пустое состояние, «+AI»). Ветка `feature/2026-11-06-chat-create-flow` от dev, PR в dev.

## Контекст

Сегодня создание чата — карточка-форма `ChatListCreate` в списке (поле title + чекбокс is_ai + плитка «Чат с AI»). Оператор переделывает путь: клик «Создать чат» в шапке списка сразу создаёт чат с авто-названием «Чат с», карточка появляется и активируется, дальше пользователь живёт в шапке мессенджера: инпут названия, «+» добавления, «+AI» включения бота. Пустой чат подсказывает, как добавить участников. Авто-название дописывается сервером именами добавленных, пока пользователь не задал своё. Флаг `chats.auto_titled` — персистентный маркер «название автоматическое», задел под будущий LLM-нейминг (не в этом прогоне).

Решения clarification 2026-11-06: см. `specification.json` → operatorDecisions.

## Волна 1 — WS-BE-API (backend)

Миграция `013_chat_auto_title` (additive): `chats.auto_titled Boolean NOT NULL server_default='0'`, downgrade drop_column. Модель `Chat.auto_titled`. Схемы: `ChatCreate.auto_titled: bool = False`, `ChatResponse.auto_titled: bool = False` (GET /chats — поле за полем, прецедент is_dm), `ChatUpdate`: title → optional (1..200, nonblank при наличии) + `is_ai: bool | None = None`, валидатор «хотя бы одно поле» (пустой PUT → 422).

Сервис `chats.py` (fan-out НЕ здесь — прецедент: сервисы не импортируют hub, review F-5):
- `create()` — прокидывает auto_titled.
- `add_member()` — ТОЛЬКО в ветке свежей вставки членства (early-return существующего/реактивируемого участника title не трогает — повторное добавление не дублит имя, review F-4): если `chat.auto_titled and not chat.is_dm` — пересобрать title именем добавленного (`display_name or email-local-part`, правило to_member_brief): title == `AUTO_TITLE_SEED = 'Чат с'` (именованная константа модуля, задокументированный sync-twin фронтового `NEW_CHAT_TITLE`, review F-6) → `f'Чат с {name}'`; иначе `f'{title}, {name}'`; длина > 200 — тихий пропуск. Транзакционно; сервис возвращает `(member, new_title | None)`.
- rename → обобщение до update: заданный title гасит `auto_titled = False` (равный title — идемпотентный no-op вовсе без изменений и без гашения); заданный is_ai меняет флаг; сервис возвращает `(chat, system_message | None, ai_changed: bool)`.

Эндпоинты `chats.py` — весь WS fan-out здесь: members — при non-None new_title broadcast `chat_renamed {chat_id, title}` активным (существующий ивент); `PUT /chats/{chat_id}` — расширенный payload, существующие guards (require_active_member: архив 403, чужой 403; аноним 401), response ChatResponse; при rename — message + chat_renamed, при изменении is_ai — новый ивент `chat_ai_toggled {chat_id, is_ai}` активным.

Тесты pytest: `test_chat_auto_title_api.py` (создание с auto_titled; members-append оба случая; кап 200; is_dm исключён; ручной rename гасит; повторное member-add после гашения не меняет title), `test_chat_ai_toggle_api.py` (включение; идемпотентный повтор без broadcast; 422 пустого PUT; guards 401/403/403; broadcast активным; архив 403), `test_chat_rename_api.py` (регрессия: только-title PUT работает как раньше), миграционный сегмент 013 + зелёность 009–012 (repin только при падении изоляции — владелец волны).

## Волна 2 — WS-FE-CHAT (frontend + docs)

**Удаление**: `src/components/chatListCreate/` (hbs/ts/test), экспорт из `components.ts`, `src/scss/components/chat-list-create.scss` + строка `@import './chat-list-create'` в `src/scss/components/_all.scss` (review F-1), прокидка `inputs`/`buttons`/`refs.create`/`onAiChatClick` из `chat.hbs`/`chat.ts`.

**Создание**: HeaderIcons-кнопка onClick (уже есть) → `ChatsController.createAndSelect()`: `port.createChat({title: NEW_CHAT_TITLE, auto_titled: true})` → `{chatId}` → `fetchChats()` (карточка + WS-сокет) → `selectChat(chatId)` + `getChatUsers(chatId)`. Константа `NEW_CHAT_TITLE = 'Чат с'` в `utils/constants.ts` (константа `AI_CHAT_TITLE` НЕ трогается — живой код ai-assistant `createAiChat`, review F-2). `ChatsPort.createChat` меняет контракт на `Promise<CreateChatResult>` (`{chatId: number}`; own-адаптер маппит `response.id`); `ChatInfo.auto_titled?: boolean` в `utils/types.ts`, `toChatInfo` маппит. Мобильная панель: CDU-гвард chat.ts — появление/смена selectedChat извне открывает `chatPaneOpen` (симметрично существующему сбросу; setProps идемпотентен).

**Инпут авто-названия**: messenger.ts — при `chatInfo.auto_titled === true && !archived` заголовок рендерится инпутом сразу (`renamingTitle`-механика без dblclick-гейта): Enter/Escape/focusout → commitTitleInput; ≠ и непустое → onRenameChat; пустое/равное — тихий откат. `ChatsController.renameChat` добавляет `auto_titled: false` в существующий оптимистичный патч title (адаптер discard-ит PUT-ответ, WS chat_renamed не различает ручной rename и автодополнение — review F-3): заголовок статичен сразу после ручного коммита, откат по ошибке возвращает оба поля. Архив — h2 без инпута.

**Пустое состояние**: messenger.hbs — блок вместо пустой ленты при `messages.length === 0 && соучастников нет (selectedChatUsers без meId) && !archived && !is_ai`: текст «Добавьте пользователей с помощью кнопки + в верхнем меню, либо нажмите "добавить"» + кнопка «добавить» (`data-testid="empty-chat-add"`) → `addUserOpen = true`. `selectChat` сбрасывает слайс `chatUsers` (устаревший список от прошлого чата не флипает гейт — review F-7; каждый выбор и так зовёт getChatUsers). Стили — messenger.scss.

**«+AI»**: `public/images/ai-toggle-icon.svg` (currentColor); третья кнопка headerButtons: скрыта в архиве (фильтр visibleHeaderButtons), is_ai-чат — модификатор active/некликабельна; клик → `onEnableAi` → `ChatsController.enableAi(chatId)`: `port.enableAi(chatId)` (PUT `{is_ai: true}` + csrf) → оптимистичный патч `is_ai: true` в chats-слайсе, откат по ошибке. `ChatsPort.enableAi(chatId)` + own-адаптер. WS: `ws/own.ts` обрабатывает `chat_ai_toggled` → `gateway.notifyChatAiToggled` → контроллер патчит `is_ai` в слайсе (для других клиентов).

**Доки**: `docs/progress/progress_log.md` (запись сверху), `docs/NEXT.md` (фича-запись + future-step LLM-нейминга со ссылкой на auto_titled-флаг; закрыть/пометить backlog «тематические чаты» — покрывается новым флоу).

**Тесты mocha**: chats.test.ts (createAndSelect: порядок POST→fetch→select; enableAi: оптимистичный патч+откат; chat_ai_toggled-патч), api.test.ts (createChat резолвит chatId + payload auto_titled шлётся только выставленным — прецедент is_ai; enableAi PUT-форма + csrf), messenger.test.ts (инпут авто-заголовка: рендерится сразу для auto_titled, не для обычного/архивного; коммит → onRenameChat; пустое состояние: гейт по всем четырём условиям, кнопка открывает модалку; «+AI»: рендер, скрытие в архиве, active в is_ai, клик → onEnableAi), chat.test.ts (createAndSelect-колбэк страницы; удаление ChatListCreate — не монтируется; CDU-гвард мобильной панели), ws.test.ts (chat_ai_toggled → notify).

## Не-цели

См. specification.json → nonGoals. Ключевое: LLM-нейминг — future-step; DM-контракт контактов не меняется; бот-механика не меняется; ai-assistant-фича не трогается.

## Верификация

- `npm run verify` (typecheck + mocha + eslint + stylelint) — фронт-волна; база 696 passing (2026-11-06).
- `PYTHON_BIN=~/.venvs/chatty-backend/Scripts/python.exe bash backend/verify.sh` (pytest + alembic) — бэкенд-волна; база 291 passed + 4 известных Windows-ingestion-падения test_converter.py (2026-11-06) — deviations с полным логом.
- `node .claude/hooks/scripts/guard-architecture.mjs --all --strict` — обе волны.
- Живой compose-стек (миграция 013) — операторская процедура по `docs/deployment/own-backend.md` при влитии PR; в прогоне не поднимается.
