# NEXT — точка входа для следующей сессии

Обновлено: 2026-11-05 — **НЕЗАВЕРШЁННЫЙ ALK-прогон `2026-11-05-messenger-ux-pack`,
продолжение с другой машины — см. раздел «Продолжение прогона» ниже.**
(До этого: закрыт ALK-прогон `2026-11-04-bot-wait-offline`,
ветка feature/2026-11-03-auth-refresh-retry, PR на `dev`: экономика рендера
(батчинг setProps, keyed-переиспользование), SSE-стриминг ответа бота с
bot_delta-мостом, браузерный offline/online с force-реконнектом, честная
ошибка эха; до этого — UX-батч `2026-11-02-ui-ux` и
`2026-10-27-ai-chat-creation`; в базу ветки вмержен dev 2026-11-01:
настройки /settings `2026-11-01-settings`, членство в чате
`2026-11-01-chat-leave`, контакты `2026-11-01-contacts`; до этого —
pg_trgm-индексы для /chats/search, `2026-10-27-chats-search-trgm`).

## Продолжение прогона `2026-11-05-messenger-ux-pack` (с другой машины)

Пакет из шести фич мессенджера (S2, план rev 3 с амендментом). Оператор
остановил прогон 2026-11-05 после приёмки трёх волн; ветка
`feature/2026-11-05-messenger-ux-pack` запушена (origin), PR ещё не открыт.

**Коммиты (старые → новые):** `2d6729b` freeze (S2 rev 2, 3 раунда ревью) →
`6bd90d1` WS-BE-API (PUT /chats/{id} + messages.kind миграция 012 + системные
сообщения + chat_renamed broadcast; POST /chats/read-all; '@'-ветка
/chats/search; +14 pytest → 291 passed) → `35a0c51` WS-OPS-STACK
(scripts/probe-own-backend-routes.ps1; compose-стек ПЕРЕСОБРАН — kick/leave
404 починены, heads 012, smoke PASS) → `f6e839d` WS-FE-CHAT (created_at-
сортировка «новый чат сверху»; аватар чата в шапке owner-only + эллипсис
длинного заголовка; dblclick-переименование с сохранением по Enter/Esc/
клику-вне; служебная строка ленты; иконка «Пометить всё прочитанными») →
`f419fc1` remediation (keydown коммитит ТОЛЬКО Enter/Escape) → `6980937`
амендмент плана rev 3 (WS-FE-CHAT write-set +2 headerIcons-файла).

**Гейты на ветке:** фронт `npm run verify` 0 (685 mocha, +30 к базе 655);
бэкенд 291 passed + 4 известных Windows ingestion-падения (селективный прогон
с 4× `--deselect` даёт exit 0; форма: `PYTHON_BIN=~/.venvs/chatty-backend/Scripts/python.exe
bash backend/verify.sh` через Git Bash); `guard-architecture --all --strict` 0.

**ВАЖНО — рантайм прогона НЕ в git:** стейт/пакеты/квитки живут в
гитигнорированном `work/2026-11-05-messenger-ux-pack/` (run.state.json
revision 19: BE-API/OPS-STACK/FE-CHAT ACCEPTED, FE-SEARCH RUNNING attempt 1,
кода ещё нет). Для продолжения на другой машине ЛИБО скопировать эту папку
целиком с машины-источника (тогда всё продолжается с revision 19), ЛИБО
восстановить с нуля: `workflow init --manifest tasks/2026-11-05-messenger-ux-pack/plan.manifest.json
--state work/.../run.state.json --run-id run-001 --package-id 2026-11-05-messenger-ux-pack
--package-root '../..' --source-revision cadf2b0... --apply <digest>` →
`task compile --write` → `adopt-plan --reset-tasks` → authorize → run-start —
но тогда принятые волны в стейте пусты и их приёмку придётся оформить заново
(код уже в ветке; честно зафиксировать как восстановление, повторив
task-result/review/audit по существующим evidence-квиткам, если папка
скопирована частично).

**Осталось сделать — WS-FE-SEARCH** (объём: пакет
`work/.../workflow/task-packets/WS-FE-SEARCH.task-packet.json`, write-set:
searchBar.{ts,test.ts}, contacts/{controller.ts,contacts.test.ts,pages/...},
features/index.ts, docs/NEXT.md, docs/progress/progress_log.md):
1. `src/components/searchBar/searchBar.ts`: export `setChatSearchBarValue(value)`
   — пишет модульную память (lastTypedValue=value, wasFocused:false) и гасит
   pendingSearchTimer; инстанс бара сеет value из памяти (уже умеет).
2. contacts-controller (`src/features/contacts/controller.ts`): `findChats(userId)`
   — login из contacts-слайса → инъекция `chatSearchOpener(login)`; сеттер
   `setChatSearchOpener` с noop-дефолтом (прецедент setChatOpener).
3. Страница контактов: включить кнопку «Найти все чаты» (снять disabled и
   title), клик → `findChats(id)` + закрыть меню; ошибка → фидбек
   «Не удалось выполнить поиск».
4. `src/features/index.ts`: `setChatSearchOpener((login) => { setChatSearchBarValue('@'+login);
   void ChatsController.searchChats('@'+login); Router.go(MESSENGER) })`.
5. Тесты: сид бара (следующий инстанс несёт значение, таймер погашен),
   контакты (кнопка активна, findChats → opener('@'+login), noop-дефолт,
   фидбек ошибки), passthrough сырого '@…' в порт.
6. docs: запись фичи сюда (NEXT.md «Состояние») и progress_log сверху.

**Приёмка волны (дорожка этой сессии):** commit → `workflow task-snapshot` →
task-result (schemaVersion `agent-task-result.v2`; lineage runId/packageId/
planDigest=8d8d213b.../planRevision=3/sourceRevision=cadf2b0.../taskId/attempt;
actor+actorRunId; taskPacketHash=канонический дайджест пакета; changedFiles
из снапшота; changeSet=claim; itemOutcomes со status COMPLETE; commands
только PASS/exitCode 0 — упавшие в deviations; путь по шаблону
`task-result-{attempt}.json`; файл = canonical JSON + LF) → независимое
ревью (review-raw.json: verdict/findings/acceptanceChecks списком/
dimensions) → `python work/2026-11-05-messenger-ux-pack/tools/assemble_envelopes.py
review WS-FE-SEARCH 1 <raw>` и `... evidence WS-FE-SEARCH 1 EV-FE-2 <логи>` →
`audit implementation ... --out` (rm старый --out; без --path) →
`workflow task-accept --review --implementation-audit`.

**Финал прогона:** свежий финальный аудит агентом → `audit final-implementation
--report <per-task аудиты>` (канонический) → `workflow final-audit-outcome
--verdict ACCEPTED` → `workflow finalize --final-audit --final-implementation-audit
--proof <out> --reason ...` → PR в `dev` → записи в NEXT.md/progress_log →
обновить память/эту заметку.

**Стек:** compose-API на машине-источнике уже пересобран (012_message_kind);
на новой машине поднять/пересобрать свой стек по runbook и проверить
`scripts/probe-own-backend-routes.ps1` (все строки PASS).

## Состояние

UX-батч мессенджера `2026-11-05-messenger-ux-pack` (S2 rev 3, четыре волны,
mocha 655 → 692, pytest 277 → 291 на Windows-стенде / 295 на Linux). Шесть
фич: **новый чат сверху** — сортировка списка по активности с
`created_at`-фолбэком и id DESC при ничьей (месседж-лесс чат не тонет);
**шапка чата** — аватар чата owner-only (не-владелец и архив — без
афорданса), эллипсис длинного заголовка (flex:1 + min-width:0),
dblclick-переименование с коммитом по Enter/Escape/клику-вне (обычный
набор текста не коммитит и не закрывает — remediation r2), тихий откат
пустого ввода, оптимистичный патч заголовка в сторе с откатом по ошибке
порта; **служебная строка ленты** — сообщения с `kind` (миграция 012
`messages.kind`) рендерятся центрированной приглушённой строкой без
пузыря/реакций, контент экранирован; **«Пометить всё прочитанными»** —
вторая иконка шапки (`mark-all-read-icon.svg`, currentColor), disabled без
непрочитанных, POST `/chats/read-all` гасит unread по всем членствам
(включая архивные, forward-only маркеры); **'@'-поиск участников** —
GET `/chats/search?q=@…` матчит соучастников по префиксу email/display_name
(caller исключён, кап 50, чужие чаты не светятся), rename-рассылка
`chat_renamed` по WS патчит заголовок чужого чата без рефетча;
**«Найти все чаты» в контактах** — кнопка меню контакта активна, клик →
`findChats` (login из слайса) → инъекция `chatSearchOpener` в композиции:
сид `'@'+login` в модульную память бара (гасит висящий дебаунс, фокус не
подделывает), сырой `'@'+login` в `searchChats`, переход в мессенджер с
готовым запросом; отказ (контакт исчез из слайса) — фидбек «Не удалось
выполнить поиск». Корень kick/leave-404 на приёмке стека — устаревший
контейнер (код ветки не был пересобран): compose-стек пересобран,
закоммичен probe-скрипт `scripts/probe-own-backend-routes.ps1`
(health/ready + 401-vs-404 таблица роутов). Гейты: фронт 692 mocha +
guard strict 0; бэкенд 295 pytest на Linux (291 + 4 Windows-only ingestion,
зелёные на Unix), alembic heads `012_message_kind`.

Прогон `2026-11-04-bot-wait-offline` закрыт (S2, три задачи, mocha
623 → 654). **Рендер** (WS-FE-RENDER-PERF): `setProps` батчит — один
FLOW_CDU на вызов; `registerComponent` с `cacheKey` переиспользует инстансы
(`id:<n>` / фиксированный `pending:tail`), `pruneComponentCache(alive)`
держит кэш размером с ленту; брошенные withStore-дети уничтожаются
(retained-изъятие). **Стриминг** (WS-BE-BOT-STREAM): провайдер стримит
SSE (`complete_stream` явно на обоих), `CHATTY_BOT_ENABLE_THINKING=false`
отключает thinking, `CHATTY_BOT_STREAMING=false` — kill-switch; сервис
коалесцирует дельты (~250мс) в мост эндпойнта → hub.broadcast
`bot_delta {'message_id','delta'}`; финальное сообщение/ределивери
байт-в-байт прежние. **Фронт-устойчивость** (WS-FE-RESILIENCE): offline →
reconnect-оверлей, online → force-дроп застрявших backoff'ов (чаты +
stories) + рефетч с Connected-ресинком; индикатор смерти WS различает
намеренность марками адаптера; `bot_delta` вяжется к pending-хвосту по
`pending_for` (один store-эмит на дельту, чужие/поздние — молчаливый дроп);
`waitForOwnEcho` 5с → честная ошибка pushError; CSS-анимация «печатает»
на pending-пузыре.

UX-батч мессенджера закрыт (2026-11-02-ui-ux, S2 rev 3, три волны, mocha
568 → 583). **Мобильная навигация /settings**: `settingsPaneOpen` в пропсах
страницы + модификатор `chat_pane-open` на корне (правила только <768,
десктоп не тронут), кнопка «назад» сохраняет текущую секцию — все шесть
пунктов открывают панель. **Вложения**: пузырь рендерит список
`.messenger__message-files` — иконка по расширению (pdf/xlsx/doc/generic,
4 новых SVG на currentColor в public/images), экранированное имя, «Скачать»
(`a[download]`); в AI-чатах входящие несут МОК-список найденных документов
(`src/components/messenger/bot-attachments.mock.ts` — УДАЛИТЬ вместе с
вызовом в `mapTypedMessages`, когда бот вернёт реальные имена; file.filename
в рантайме никто не наполняет — фолбэк «Файл»); плейсхолдеры «Вложение»
списка чатов и уведомлений не тронуты. **Автоскролл**: стор-управляемый
движок живёт на странице чата (стабильный инстанс; прежний был мёртв —
перерисовки пересоздавали Messenger без CDM/CDU, а слушатель страницы умирал
с первой заменённой нодой): память по chatId + document-capture синк в
общем модуле `src/components/messenger/feed-scroll.ts` (им же пользуется
Messenger для preserve после собственных перерисовок — модалки/черновик/
меню; контракт per-caller из ревью F-5); смена чата — низ, рост хвоста при
прижатом низе (или pending-плейсхолдер бота) — низ, чтение выше низа и
prepend «загрузить ещё» — сохранённая позиция; `selectedChat` пробрасывается
в пропсы при рождении страницы (иначе первый эмит выглядел сменой чата).
**Фокус модалок**: открытие сразу фокусирует поле и чистит черновой запрос,
полная очистка возвращает фокус (messenger + contacts, rAF-кадр). Post-run
хвост: минорный шум консоли в шестипунктном тесте настроек (нет
fetchUsage-стаба у герметичного контроллера — ревью-файндинг F1 волны).


ИИ-чат можно создать с фронта (2026-10-27-ai-chat-creation, ветка
feature/2026-10-27-ai-chat-creation, PR на `dev`): бэкенд давно умел
`POST /chats {title, is_ai}` и автозапуск бота, фронт не мог отправить ни
одного is_ai-чата. Три явные точки входа: (A) чекбокс «AI-ассистент» —
сосед Form в ChatListCreate (у формы нет слота, а сериализация читает
`element.value`, т.е. `'on'` при любом checked — состояние читает страница
по `refs.create → input[name=is_ai]?.checked` в момент сабмита; снятый
чекбокс = прежний payload `{title}` без поля); (B) one-click-плитка
«Чат с AI» — `Button type=button` в том же `<li>`, шлёт
`ChatsController.create({title: AI_CHAT_TITLE, is_ai: true})`; (C) кнопка
«Создать чат с ассистентом» в пустом состоянии `/assistant` — ai-assistant
расширил СОБСТВЕННЫЙ порт (`AiAssistantPort.createChat` над тем же
POST /chats в своём адаптере, `AiAssistantController.createAiChat` с
рефетчем через существующий `loadChats`), ноль импортов из features/chats —
guard strict остаётся нагрузкой именно этого маршрута. Общая константа
`AI_CHAT_TITLE = 'AI ассистент'` живёт в `src/utils/constants.ts` (обе
фичи берут её вниз по слоям; из контроллера чатов не реэкспортируется).
Гейты: фронт 394 mocha, guard strict 0.

`/settings` перестал быть макетом (2026-11-01-settings, ветка
feature/2026-11-01-contacts, четыре волны: бэкенд 011_settings → тема →
логика → UI/доставка). Шесть пунктов сайдбара ведут правую панель
(section-состояние в пропсах страницы, активный пункт — модификатор
`profile-settings-item_active`): **Account** — правка display_name/phone
(Form-идиома, phone опционален — NULL на бэкенде), email/login — read-only
строки плоской разметкой, смена пароля (политика 12+, совпадение повтора),
«Sign out» и «Sign out everywhere» за модалкой-подтверждением
(escapeHtml-билдер с логином); **Chats** — архив (leftAt) с «Вернуться» →
rejoin через шов контроллера профиля, карточка оживает рефетчем стора;
**Appearance** — радио light/dark/system на utils/theme.ts (применяется
живьём в dataset); **Notification** — тумблеры звука и браузерных
уведомлений (разрешение запрашивается при включении, API-отсутствие
подсказано); **Privacy** — send_read_receipts одно-полевым PUT profile;
**Data Usage** — GET /files/usage при входе в секцию (человекочитаемые
КБ/МБ/ГБ + счётчик файлов) и тумблер автозагрузки. Доставка фоновых
сообщений — шов в features/chats/ws/own.ts: чужое сообщение в
невыбранном чате играет WebAudio-пинг (ленивый AudioContext, без ассета)
и показывает браузерное уведомление (только тумблер+granted+document.hidden,
заголовок чата + сниппет); вложения гейтятся autoDownload (выкл — ссылка
«Скачать» вместо превью, живая подписка preferences в мессенджере).
Новый scss `settings-sections.scss` — только на var(--token), без
комментариев (конвенция). Гейты: фронт 540 mocha, guard strict 0; бэкенд
контура — 248 pytest (+4 известных Windows-падения ingestion), alembic
heads == 011_settings.

Членство в чате получило два выхода с разной семантикой
(2026-11-01-chat-leave, ветка feature/2026-11-01-contacts): клик по аватару
участника в шапке мессенджера открывает Modal-контекстное меню вместо
легаси-мгновенного кика. Матрица видимости: чужой аватар — «Добавить в
контакты» (id не в слайсе контактов) и «Удалить из чата» (только владелец);
свой аватар — «Удалиться из чата»; «Отмена» всегда; контент — только через
escapeHtml-билдер (XSS-пины). Собственный выход АРХИВИРУЕТ членство
(`chat_members.left_at`, миграция 010): чат остаётся в списке потушенной
карточкой (`chat-list-user_archived` от leftAt), история читается и
скроллится, но композер и кнопка «+» шапки скрыты, меню участников нет, WS
-push отфильтрован по активному членству, бэкенд режет записи 403; повторное
добавление реактивирует членство. Кик (владелец удаляет участника) — жёсткое
удаление строки: у кикнутого чат исчезает целиком. Бэкенд: POST
/chats/{id}/leave и DELETE /chats/{id}/members/{user_id}, сплит read/write
гардов членства, user-scoped закрытие сокетов; фронт: removeUsersFromChat/
leaveChat/addContact/refreshContacts в ChatsController (контактный шов —
инъекция contacts-фичи в consumer-side, сеттер setContactsIntegration),
ChatPage CDM бутстрапит слайс контактов для условного пункта меню.
Гейты: фронт 450 mocha, бэкенд 230 pytest passed (+4 известных Windows-падения
ingestion), guard strict 0.

Контакты стали адресной книгой с собственным маршрутом (2026-11-01-contacts,
ветка feature/2026-11-01-contacts): `/contacts` монтирует ContactsPage,
защищённую существующим allowlist-гардом без единой правки гарда. Сайдбар
упрощен: шапка «Контакты» + кнопка «Добавить», список карточек ContactItem
(аватар, display_name, login, hover-крест удаления), BottomBar — без ленты
историй и поиска по чатам; правая панель — заглушка «выберите контакт».
«Добавить» переиспользует модалку дебаунс-поиска мессенджера:
`renderAddUserModalContent` получил опциональный `alreadyBadge` (мессенджер
молчит — дефолт «уже в чате» и его поведение бит-в-бит прежние, пин-тест;
контакты передают «уже в контактах», memberIds = id контактов), дебаунс 300
мс и возврат фокуса принадлежат странице (корневая делегация событий).
Клик по карточке открывает меню: «Создать» — get-or-create диалога
(POST /chats/dm) и переход в мессенджер через сеттер setChatOpener
(композиция features/index.ts), «Найти все чаты» — НЕ СДЕЛАНО: реализация
чат-поиска с другой машины не смержена, пункт кораблится disabled с title
«пока не реализовано»; hover-крест — модалка подтверждения и removeContact.
chatPaneOpen страницы чатов теперь стартует из живого выбора
(`selectedChat != null`): возврат на /messenger с выбранным чатом на
мобильном открывает панель чата, а не список (осознанное изменение,
задокументировано и пинновано). Адаптив зеркалит лестницу chat.scss:
380px сайдбар / 280px на планшете / одна колонка <768 с скрытой заглушкой
(ручной smoke, не mocha — jsdom без layout). Гейты: фронт 422 mocha, бэкенд
218 pytest passed (+4 известных Windows-падения ingestion), guard strict 0.

Истории стали живыми: глобальный канал `/api/v1/ws/stories` (cookie-auth
+ Origin-check, без membership, ping→pong) с user-keyed `StoriesHub`
(мультивкладочность, prune-stale, `exclude_user_id`); `POST /stories`
фан-аутит `story_created` фиксированной формы (`viewed/is_own=False` для
всех не-владельцев по построению, общий `_common_fields` с лентой) всем,
кроме аплоадера; `DELETE /stories/{id}` — `story_deleted {story_id}`
всем. Фронт: ws-модуль `features/chats/stories/ws/` (синглтон поверх
нетронутого `WSTransport`, открывается на CDM страницы чатов рядом с
`fetchStories`, Close обнуляет ссылку) → gateway-листенер →
`StoriesController` (единственный писатель `state.stories`): дедуп по id,
вставка чужой непросмотренной сразу после блока своих, удаление по id —
кольца обновляются без перезагрузки. Гейты: фронт 337 mocha, бэкенд 184
pytest passed (+4 известных Windows-падения ingestion), guard strict 0.

Живой поиск чатов (2026-10-26-chat-search, ветка feature/2026-10-26-chat-search,
PR на `dev`): Wave-3 UI — SearchBar дебаунсит ввод (300 мс) и зовёт
GET /chats/search; список при пустом запросе идёт по активности
(`last_message.time` DESC, недатированные тонут, ничья id DESC), при
активном показывает только совпадения серверного порядка с подсветкой
`<mark>` (utils/highlight.ts, escape-then-wrap) в заголовке и/или
сниппете; текст и фокус поиска переживают перерисовки (модульная память
бара + CDU-восстановление страницы). Серверный поиск остаётся на
lower()+LIKE-скане, но ускорен pg_trgm: миграция
`008_pg_trgm_search_indexes` строит функциональные GIN-индексы ровно над
выражениями запросов (`lower(title)`, `lower(content)` в
repositories/chats.py — переписывание запросов потребует миграции
индексов в ногу); цена — поддержка GIN-индекса триграмм на каждом POST
сообщения (fastupdate амортизирует по умолчанию, тюнинг вне скоупа).
FTS/tsvector и релевантность — заявленный non-goal: морфология и
префиксный матчинг ломают контракт сырой подстроки и подсветку `<mark>`
первого вхождения.

## Приоритеты следующей сессии (согласовано 2026-10-23, пп.1–2 закрыты 2026-10-25, техдолг закрыт 2026-11-04)

1. **ТЕХДОЛГ производительность/UX бота — ЗАКРЫТО 2026-11-04** (ALK-прогон
   `2026-11-04-bot-wait-offline`, ветка feature/2026-11-03-auth-refresh-retry,
   PR на `dev`; краткая механика — в «Состоянии» выше). (а) Задержка
   появления своего сообщения: корень — экономика рендера; WS-FE-RENDER-PERF
   дал один FLOW_CDU на `setProps` (вместо по-ключного), keyed-переиспользование
   Message-инстансов (`cacheKey` `id:<n>`/`pending:tail` + prune) и destroy
   брошенных withStore-детей — подписки больше не копятся за сессию.
   (б) «Таймаут при живом запросе»: идемпотентный ретрай POST /bot/runs уже
   был, добавлена honest-ошибка `waitForOwnEcho` (5с без эха → «⚠ Ассистент
   недоступен (эхо сообщения не получено)» вместо молчаливого пропуска
   прогона), композер разблокируется в finally. (в) 30–40с на плейсхолдере:
   WS-BE-BOT-STREAM стримит ответ (SSE → throttled `bot_delta` по chat-WS,
   `CHATTY_BOT_ENABLE_THINKING`/`CHATTY_BOT_STREAMING` — ручки оператора),
   WS-FE-RESILIENCE вяжет дельты к pending-хвосту по `pending_for` (один
   store-эмит на дельту, чужие/поздние — молчаливый дроп, финальное
   сообщение заменяет хвост прежним путём) и добавил чисто-CSS анимацию
   «печатает» (три точки на pending-пузыре, без store-тиков). Гейты: mocha
   623 → 654, `npm run verify` 0, бэкенд-гейт Windows 277 passed + 4
   известных ingestion-падения (0 новых), guard strict 0. **DEFERRED
   (live-смоук; инференс-хост недоступен — операторское решение
   2026-11-04)**: замер первого токена < 3с на реальном llama-server,
   эффект `CHATTY_BOT_ENABLE_THINKING` на живой модели, офлайн во время
   ответа бота end-to-end, а также live-замер времени появления своего
   сообщения против локального compose-стека (стек на момент закрытия поднят
   не был — docker-демон выключен, операторский env недоступен; jsdom-пин
   «один рендер на store-эмит» уже стоит задачей RENDER-PERF). Известное
   ограничение (review N-3): стрим видит только вкладка, задавшая вопрос
   (у других вкладок нет pending-хвоста — им приходит финальное сообщение);
   run-scoped плейсхолдеры — возможный follow-up. Остаточная стоимость:
   перерисовка ленты O(n) на эмит без виртуализации (non-goal, review N-2).

2. **ТЕХДОЛГ браузерный offline/online — ЗАКРЫТО 2026-11-04** (тот же
   прогон, WS-FE-RESILIENCE). `src/features/chats/ws/connectivity.ts`
   (биндинг в `features/index.ts`): `window offline` →
   `showBusyOverlay('reconnect')`; `online` → скрыть + force-дроп всех
   НЕ-OPEN чат-сокетов (`reconnectAllChatSockets` — застрявший в backoff
   чат снова открываем) + `reconnectStoriesSocket()` (симметрия stories,
   review F-7) + `ChatsController.fetchChats()` (переоткрытие + Connected-ресинк
   хвостов, дедуп по id уже есть). Индикатор смерти WS
   дифференцирует намеренность марками адаптера (review F-3):
   каждый собственный путь закрытия (closeChat/chat_deleted/leaveChat/
   closeAll/дропы reconnectAll) маркирует chat id ДО `socket.close()`,
   нотификация — только по немаркированному исчерпанию, Connected гасит;
   `WSTransport` получил публичный read-only `isOpen` (backoff/ceiling/close
   не менялись, Close без payload). Auth-прогрев сознательно не добавлен
   (review F-4): stale access лечит глобальная 401→refresh-политика, `features/auth`
   не тронута. Приёмка «DevTools Offline 30с+ → возврат сети →
   лента догоняется без F5» пинована jsdom-сюитами connectivity
   (пары оверлея, force-дроп, рефеч, идемпотентность,
   негативы намеренных закрытий); live-проверка офлайна во время ответа
   бота — в DEFERRED-смоуке п.1.

3. **RAG-эмбеддинги — ЗАКРЫТО 2026-10-27** на инференс-хосте (LAN Mac mini):
   llama-server `:8082` (Qwen3.5-9B) перезапущен с `--embeddings --pooling mean`
   (dim 4096), модель зафиксирована в операторском env до первого ingestion; живая
   приёмка по `docs/plans/2026-10-25-rag-embeddings.md` пройдена (ingest → поиск
   0.822 → бот `succeeded` с ответом по документу; изоляция 403; идемпотентный
   реингест). По пути закрыт баг двух подряд system-сообщений (`prompts.py`,
   jinja-шаблон Qwen3.5 в llama.cpp отвечал 500). Остаточный шаг (опционально):
   переход на отдельную embedding-модель (bge-m3 на `:8083`, pooling cls) —
   качественнее и разгрузит чат-инстанс; смена векторного пространства = реингест
   всех документов. Расклад инференс-хоста (порты/модели) — в
   `docs/deployment/own-backend.md`, runbook приёмки —
   `docs/plans/2026-10-25-rag-embeddings.md`.

Хвосты закрыты 2026-10-25 веткой `feature/2026-10-25-next-tails`:
`mark_viewed` — `INSERT ... ON CONFLICT DO NOTHING` по композитному PK;
`unread_counts` — один SELECT (memberships + LEFT JOIN маркера + COUNT
FILTER) вместо 3 запросов + COUNT на чат; дубль `GET /chats` — bootstrap
`fetchChats` удалён из `src/main.ts` (CDM страницы чатов, LIVE-3, —
единственный писатель на заходе). Пределы stories-push закрыты 2026-10-26 веткой
`feature/2026-10-26-stories-push-limits`: фан-аут `story_created` уходит и
владельцу (is_own/viewed правится на клиенте по owner_id — своя история
вставляется в голову ленты), истёкшие по TTL кольца гасятся на рендере
(`stories/ttl.ts`, 24ч-зеркало серверной ручки, невалидная дата кольцо не
прячет). Третий предел — события вне страницы чата — оставлен осознанно:
сокет живёт со страницей, каждый маунт рефетчит ленту, глобальный сокет
держал бы постоянное соединение ради ленты, которую никто не смотрит.

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

Windows-заметка: `npm run verify:backend` не резолвит `.sh` через cmd —
запускайте скрипт напрямую: `PYTHON_BIN=~/.venvs/chatty-backend/Scripts/python.exe
bash backend/verify.sh`; 4 теста `tests/unit/ingestion/test_converter.py`
на Windows-хостах падают (subprocess с shell-скриптом, WinError 193) —
environment-специфика, на Unix-машинах зелёные.

Для нетривиальной фичи — полный ALK-цикл (см. `tasks/README.md` и текущий
пример пакета `tasks/2026-10-21-avatars-stories/`); история работы —
`docs/progress/progress_log.md` (новое сверху).
