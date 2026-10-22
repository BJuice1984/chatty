# 2026-10-22 — Avatars and stories on the own backend (ALK 2026-10-21-avatars-stories)

Перевёл истории и аватары с клиентских моков на собственный бэкенд через файловый конвейер `/files` (RustFS + метаданные в PostgreSQL): миграция 007 (`batch_alter_table`: nullable `files.chat_id`, `users/chats.avatar_file_id`, таблицы `stories`/`story_views`), `POST /files/avatars` (kind=user|chat, owner-only чаты, image/*-whitelist), роутер `/stories` (upload, лента «свои первыми» + TTL 24ч + per-viewer `viewed`, идемпотентный view), `avatar_url`-property в auth/chats/members; доступ: чат-вложения остаются participant-only (регресс-пин), глобальные медиа — любому аутентифицированному. Фронт: stories-модуль внутри фичи chats (`features/chats/stories`: порт → own-адаптер → контроллер → срез `state.stories`), страница чата ушла от `initialStories`/blob-URL (таймер/фокус/delegated change не тронуты, stories-пропсы страница больше не пишет — единственный писатель срез), аватары в auth/chats/profile адаптерах с pool-фолбэком, `changeChatAvatar` читает `chatId` из UI-формы. Проверено: `npm run verify` (311 mocha-тестов, +14), `npm run verify:backend` (174 pytest, +12), guard `--all --strict` — 0 нарушений; миграция 007 round-trip на scratch-SQLite (записано как manual-note; PG-прогон по compose-ранбуку — до мержа). План-пакет `tasks/2026-10-21-avatars-stories/` (freeze rev 5, 5 раундов независимого ревью плана), прогон `work/2026-10-21-avatars-stories/` — обе волны ACCEPTED (FE со 2-й попытки: ревью поймало двойную обработку делегированного change на аватарных инпутах чатов и неверную цель пикера историй). Follow-up после финализации рана (по находкам независимых ревью): владение чатом проверяется до загрузки аватара (без orphan-файлов на 403/404), заказ ленты «свои первыми» закреплён тестами с более свежей чужой историей (unit + integration), `use_alter` на avatar-FK убрал SAWarning-циклы (49 → 1 предупреждение), Form-импорт без алиаса.

# Progress Log

> Журнал значимых изменений (код, агентская среда, документация).
> Новые записи — сверху. Одна запись = одна завершённая порция работы:
> что и почему сделали, где смотреть, чем проверили.

## 2026-10-21 — Feat(stories): полноэкранный вьюер историй, добавление по фото, рамка непросмотренных (ALK 2026-10-21-stories)

**Что:** оживлён ряд историй `chat__container-stories-list` на мок-этапе
(без бэкенда). Клик по истории открывает полноэкранный `StoryViewer`
(`src/components/story/storyViewer/`) с фото, прогресс-баром и
автозакрытием через 5000 мс (`STORY_VIEW_DURATION_MS` в `chat.ts`, дубль
в CSS-анимации); ручное закрытие — бэкдроп/крестик/Escape. Клик по
add-плитке открывает системный выбор фото (скрытый `input[type=file]
[accept=image/*]`); выбранное фото встаёт первой обычной историей
(«You story», `blob:`-URL) с выделенной рамкой. Просмотренная история
теряет градиентную рамку (`chat-story__container_viewed`), состояние — в
пропсах страницы до перезагрузки.

**Почему/как:** таймер автозакрытия и фокус оверлея принадлежат странице,
не вьюеру — hbs-дети пересоздаются каждой перерисовкой родителя (старые
без `destroy()` и без повторного CDM), таймер в компоненте становился бы
зомби; делегированный `change` на корне страницы переживает перерисовки
(`_addEvents`), слушатель в CDM умер бы после первого `fetchChats`;
Escape требует фокуса на оверлее — `tabindex="-1"` + восстановление
фокуса в `componentDidUpdate`. План-пакет `tasks/2026-10-21-stories/`
(S2, независимое ревью 2 раунда, freeze rev 3).

**Где смотреть:** `src/components/story/`, `src/features/chats/pages/chat/`
(`chat.ts`, `chat.hbs`), `src/scss/components/story{,-viewer}.scss`.

**Проверено:** `npm run verify` — 297 тестов (17 новых: story-плитка,
вьюер, страница с sinon fake timers), `guard-architecture --all --strict`
— 0 нарушений. Визуальные пункты (прогресс-бар, fullscreen на
375/768/1280) — ручной чек-лист, не гейт. Независимое ревью попытки 1
потребовало remediation: инпут скрыт CSS-правилом (раньше обрезался
случайно), id открытой истории хранится полем страницы, добавлены тест
«вьюер без таймеров» и end-to-end делегированный change, мобильный
брейкпоинт вьюера.

## 2026-10-21 — Fix(chats): аватар чата — пусто по умолчанию, pool-аватар собеседника сразу в списке

**Что:** по замечанию оператора — `toChatInfo` own-адаптера раздавал всем
чатам pool-аватарки по id чата (каждый чат выглядел «с картинкой»).
Теперь: `toChatInfo` отдаёт пустой avatar (в списке чатов — пустая
заглушка `chat-list-user__img`), а аватаром личного диалога становится
pool-аватар единственного собеседника. Назначение — `applyCompanionAvatar`
в `ChatsFeatureController`: `fetchChats` сразу после установки списка
параллельно подтягивает участников для чатов без аватара (GET /members —
own-контракт GET /chats участников не несёт) и вешает pool-аватар
собеседника, не дожидаясь открытия чата (доводка по замечанию оператора:
изначально назначение работало только в getChatUsers — при открытии чата
или после добавления юзера, после перезагрузки аватар пропадал до клика);
addUsers перезванивает getChatUsers и аватар обновляется. Групповые чаты
(2+ собеседника), чаты без участников и чаты с назначенным аватаром не
трогаются; отказ обогащения не роняет список.

**Проверено:** `npm run verify` (277 тестов, включая регрессионные:
назначение аватара собеседника, группа/занятый аватар не меняются;
обновлён тест toChatInfo — пустой avatar) — зелёные.

## 2026-10-21 — Fix(ui): жёлтая ошибка бота, аватар профиля из пула, имя на hover аватарок

**Что:** три правки по замечаниям оператора. (1) Системное сообщение
«⚠ Ассистент недоступен (provider_failed)» рендерилось обычным пузырём —
контроллер chats теперь ставит `isError: true` (поле в `Message`),
`message.hbs` вешает `messenger__message-bubble_error`, стиль — жёлтая
подсветка (фон/рамка `rgb(255 193 7 / …)`, текст `$warningColor: #ffc107`,
новая переменная в variable.scss). Доводка: `messenger.hbs` вызывает
`Message` с явным списком пропсов — `isError` добавлен туда, без этого
флаг терялся на шаблоне и пузырь оставался серым (тест первого прохода
это не ловил — создавал Message напрямую; теперь тест гоняет живой
сценарий через стор). (2) Аватар «моего профиля» не грузился:
`toAuthUser` own-адаптера хардкодил `avatar: ''`, а `UserAvatar` не умел
статические пути (гонял их через filesUrl бэкенда). Формула пула аватаров
вынесена в `src/utils/avatarPool.ts` (её же использовал chats-адаптер
инлайн), `toAuthUser` назначает аватар по id — как у участников чата в
шапке messenger; `UserAvatar` научен правилу ChatAvatar: пути от корня —
статика, без filesUrl. (3) На аватарках участников чата
(`messenger__chat-users-container`) при наведении показывается имя —
нативный `title` c `display_name` через ChatAvatar.

**Проверено:** `npm run verify` (275 тестов, включая регрессионные:
`_error`-модификатор пузыря, avatar pool в toAuthUser) — зелёные.

## 2026-10-21 — Fix(auth): ошибка сети видна и при первой загрузке (не только после сабмита)

**Что:** замечание оператора — «Нет связи с сервером…» появлялось только
после отправки формы. Причина: конструкторы `LoginPageBase`/`RegisterPageBase`
были без параметров и затирали стор-пропсы, которые withStore передаёт в
`super({ ...props, ...initialState })` — `authError`, записанный в стор ДО
монтирования (bootstrap `/auth/me` при лежащем сервере), терялся; после
сабмита всё работало, потому что там уже живёт подписка storeHandler. Фикс
по образцу `ChatPageBase`: конструкторы страниц принимают
`LoginPageProps`/`RegisterPageProps` и прокидывают `authError` в super.

**Проверено:** `npm run verify` (274 теста, включая новые регрессионные —
ошибка в сторе до монтирования рендерится сразу на login и register).

## 2026-10-21 — Fix(auth): ошибки запросов авторизации видны в UI (сервер не поднят/сеть)

**Что:** при недоступном бэкенде (не поднят compose-стек, CORS/network) UI
молчал: контроллер auth глотал TransportError в console.error, а bootstrap
`/auth/me` молча обнулял пользователя — гард уводил на страницу входа без
объяснений, нажатие Sign in/Sign up выглядело как «кнопка не работает».
Каноничный путь проекта: контроллер → Store → withStore-пропсы страницы.
`AppState.authError` + `authSlice.get/setAuthError`; контроллер
(`src/features/auth/controller.ts`) в signin/signup кладёт человекочитаемое
сообщение (сеть — «Нет связи с сервером…», timeout — «Сервер не отвечает…»,
HTTP — message бэкенда от getHttpErrorMessage), перед новой попыткой чистит;
fetchUser различает: network/timeout/5xx — ошибка видна, 401 — тишина
(легитимная неавторизованность). Страницы login/register обёрнуты withStore
и рендерят `login__error` под формой (`role="alert"`, стиль в login.scss).
`/chats` при сетевом сбое остаётся за скобом (страница чатов не показывается
— гард уже увёл на вход).

**Проверено:** `npm run verify` (typecheck, 270 тестов — включая 8 новых
регрессионных в `controller.test.ts` и `pages/login/login.test.ts`, eslint,
stylelint) — зелёные.

## 2026-10-21 — Fix(ui): адаптив строки создания чата (мобильная и планшетная ветки)

**Что:** строка создания чата (`ChatListCreate`, открывается иконкой в шапке
сайдбара) не имела адаптива вовсе и была сломана на всех вьюпортах: строка
держала фикс-высоту 56px, а вложенная универсальная `Form` несла «логинные»
паддинги `.login-form` (50px 30px 30px) — инпут вылезал из строки и наезжал
на соседние пункты списка; на планшете (сайдбар 280px) аватар-заглушка и
боковые паддинги оставляли инпуту ~120px. Фикс — только
`src/scss/components/chat-list-create.scss`, desktop-first по образцу
`chat.scss`/`modal.scss`: база — высота по контенту, `align-items: center`,
скоуп-переопределение `.login-form` (паддинги 0) и `label` (высота auto) по
узору композера; планшет 768–1023 — скрыта пустая аватар-заглушка; мобилка
<768 — тоже без заглушки, касательный таргет 44px и font-size 16px (против
авто-зума iOS Safari). Классы с `__` напрямую не селектятся (stylelint
kebab-case) — использованы элементные селекторы (`> div:first-child`,
`label`, `input`).

**Проверено:** `npm run verify` целиком (typecheck, 262 теста, eslint,
stylelint) — зелёные.

## 2026-10-20 — Fix(ui): автоскролл сообщений, реакции без задвоения, панель списка (просмотр оператора)

**Что:** по замечаниям оператора при живом просмотре stage 16. (1) Счётчик
реакции показывал «2» — REST-сводка приходила раньше собственного WS-эха, и
гвард in-flight уже был сброшен: добавлен grace-window 1500 мс по ключу
chat:message:emoji (контроллер). (2) «Обновление всей страницы» и (3)
«при заходе в чат видны верхние сообщения» — перерисовки дочернего Messenger
пересоздают DOM списка и сбрасывают scrollTop: в Messenger встроен автоскролл
(модульная память позиций по chatId, переживающая пересоздания инстансов;
однокадровый планировщик; document-capture scroll-синк; фильтр нулевого
эха от сброса рендера) — открытие чата показывает последние сообщения,
реакция/отправка у низа не прыгают. (4) Нижняя панель пересекалась со
списком чатов: абсолют заменён потоком. (5) Горизонтальный скролл списка
чатов: overflow-x hidden.

**Проверено:** 261 тест зелёные, stylelint/eslint чисты; живые сценарии
playwright — открытие 0px от низа, реакция не прыгает, счётчик 1, отправка
докручивает, панель не пересекается. **Остаточный хвост (известен):** при
реакции во время чтения середины истории позиция сбрасывается в низ —
следствие пересоздания инстансов Messenger на каждой перерисовке (шов
рендер-цикла фреймворка); закрывается отдельным рефакторингом рендера.

## 2026-10-20 — Fix(ui): единый скролл в длинных списках (двойной скролл)

**Что:** по замечанию оператора при просмотре — при длинной истории
сообщений появлялись два скроллбара (внутренний список + внешняя панель),
а при длинном списке чатов страница росла за вьюпорт. Корень: grid-строки
без ограничения высоты (`min-height`/`rows`) и отсутствие собственного
скролла у списка чатов. Фикс (в ветке stage 16, файлы её write-set):
`.messenger__container` — `min-height: 0` (единственный внутренний скролл
сообщений); `.chat__container-chats` — `overflow: hidden`; `.chat` —
`grid-template-rows: 100%; overflow: hidden`; `.chat__container-users-list` —
`flex: 1; min-height: 0; overflow-y: auto` (собственный вертикальный
скролл списка чатов). Проверено: 1280/768/375 — doc=viewport, скроллы
только внутренние (сообщения + список чатов), 261 тест зелёные, stylelint
чист; скриншот 1280-scrolled-bottom-fixed в evidence.

## 2026-10-19 — ALK: stage 16 chats-social выполнен (r2, обе фазы ACCEPTED attempt 1) — P2P-чаты целиком

**Что:** закрыта социальная сторона мессенджера по запросу оператора
(модалки header-buttons полностью, поиск юзеров по @логину, удаление чата,
P2P-общение, реакции-эмоции, цитирование, выделение ИИ-чатов). Пакет
`tasks/2026-10-19-chats-social/` — два workstream'а с дизъюнктными зонами
(backend/** vs src/**): plan-ревью 2 раунда (11 находок раунда 1 —
неполнота write-set'ов обеих фаз (FormContainer retirement + components.ts;
services/repositories messages), контракт поиска (display_name = local-part),
единый механизм реакций (always-in-DOM affordance), порядок удаления
(broadcast → delete → close), WS-поле реплая, пути тестов, бюджеты → всё
закрыто → READY_TO_FREEZE) → FROZEN r1 `90e739ae…` → авторизация →
**фаза A (backend)** attempt 1 ACCEPTED: `GET /users?login=` (префикс,
LIKE-экранирование, own-exclusion, лимит), `DELETE /chats/{id}`
(owner-only, broadcast-первым, каскады включая files/documents/chunks),
миграция 005 (reactions unique(message,user,emoji) + reply_to_id SET NULL,
применена на живой БД), реакции с WS-broadcast и viewer-scoped summaries,
реплаи через REST и WS со сниппетами — 162 pytest (+10). → **фаза B (фронт)**
attempt 1 ACCEPTED: порты/адаптеры/контроллер (searchUsers/deleteChat/
setReaction/replyToId/closeChat; is_ai/replyTo/reactions в маппингах;
viewer-side mine без доверия WS — carry-forward фазы A исполнен),
модальный слой (Modal с aria/Escape/бэкдропом; FormContainer снесён),
@-поиск с дебаунсом, подтверждение удаления, реакции (hover-аффорданс на
pointer:fine, постоянно на touch, чипы с подсветкой своего), реплаи
(превью над вводом, блок цитаты), бейдж ✦ AI, обработка chat_deleted —
261 тест (+58). Remediation r2 по решению оператора: write-set +
`history.test.ts` (обязательный tsc-фикс порт-литералов, прецедент
stage 12), digest `64c4d437…`, lock/verify PASS.

**Живой P2P-пруф (контроллер, EV-FE-2, две сессии):** A находит B по
@логину в модалке («Пользователь добавлен»), обмен сообщениями в обе
стороны по живому WS, реакция 👍 (у A подсвечена своя, у B — не своя:
viewer-side mine доказан вживую), реплай с цитатой у обоих, AI-бейджи ×5;
модалки 375/768 без overflow, скриншоты в evidence.

**Проверено:** оба task-review ACCEPTED (гейты перепрогнаны ревьюерами;
финальный аудит — см. квитанцию). Хвосты (LOW/INFO): grace-window
двойного счёта при гонке REST/WS-эхо, фокус-менеджмент модалок, потеря
текста поиска при перерисовке в окне дебаунса, smoke-нотки (нижняя панель
перекрывает последние пункты списка; setProps-revisit не перечитывает
список — контракты stage 14).

## 2026-10-19 — ALK: stage 15 chat-ui-polish выполнен (r1, ACCEPTED attempt 1) — пузыри, время, адаптив

**Что:** по запросу оператора сообщения получили мессенджер-подачу: свои —
справа, чужие — слева (пузыри с фонами/хвостами), время ЧЧ:ММ у каждого
сообщения, маркеры дней («Сегодня»/«Вчера»/дата), планшетная (768–1023) и
мобильная (<768) вёрстка с переключением список↔чат и кнопкой «назад».
Пакет `tasks/2026-10-19-chat-ui-polish/`: ревизия r1 → plan-ревью 1 раунд
(3 нагрузочные находки закрыты дословно: **F1** — проводка `time/showDate`
в `messenger.hbs` (без неё стадия молча бы не отрендерилась) + NaN-безопасность
форматтеров до Intl (кривая метка → без времени/маркера, без throw —
RangeError ронял бы весь мессенджер); **F2** — scope-guard статус-строки
`li.chat-history` в общем списке (никаких голых li-селекторов и
align-items/gap контейнера); **F3** — полная механика `chatPaneOpen` с
проводкой `onBack` через white-list конструктора Messenger (урок LIVE-7),
кнопка скрыта по умолчанию (desktop-first)) → FROZEN, digest `52188793…`,
lock, verify PASS → авторизация (запрос оператора) → воркер attempt 1
COMPLETED.

**Реализация (WS-CHAT-UI):** `message.ts/hbs` — `time?/showDate`,
NaN-гвард `parseTime` до обоих Intl-форматтеров, пузырь с модификаторами
mine/theirs на li и временем в хвосте; `messenger.ts` — именованный
`mapTypedMessages`, `showDate` по смене календарного дня (невалидная метка
не рвёт цепочку); мобильное переключение — `chatPaneOpen` в ChatPageBase
(default false; любой выбор чата → true, включая повторный клик; назад →
false), модификатор `chat_pane-open` на корне, кнопка «назад» видна <768;
SCSS — токены `$tablet/$desktop`, стороны через `align-self` на
модификаторах, max-width 80%, планшет — сайдбар 280px/компакт, мобайл —
одна колонка. +17 тестов (**203** = 186+17): модификаторы/HH:MM/маркеры
только по showDate/invalid-time без throw/механика переключателя.

**Viewport-evidence (playwright, 375/768/1280):** нет горизонтального
overflow; на 375 свои пузыри строго правее центра вьюпорта, чужие левее;
на 768/1280 — против центра панели чата (сайдбар смещает геометрию);
переключение список↔чат 5/5; 5 скриншотов в evidence для обзора оператора.
Десктоп ≥1024 геометрически не изменён. Гейты: verify 203, stylelint,
guard strict 0.

**Проверено:** task-review attempt 1 **ACCEPTED** (гейты перепрогнаны,
скриншот 1280 визуально сверен ревьюером; CU-R1..R4 INFO). Финальный аудит
— см. квитанцию. Отклонения воркера (4) задокументированы и признаны:
посев theirs-сообщений peer-пользователем через REST (правило стороны
продакшенное `user_id !== state.user.id`), центр панели на широких
вьюпортах, 3 резервных scss-файла не тронуты, кнопка сырым button с
делегированием по прецеденту chat-history.

## 2026-10-16 — ALK: stage 14 block-cdm выполнен (r1, ACCEPTED attempt 1) — жизненный цикл CDM активирован

**Что:** активирован спавший с рождения проекта `componentDidMount`-флоу
(`dispatchComponentDidMount` не вызывался никем — ядро из LIVE-3). Пакет
`tasks/2026-10-16-block-cdm/`: ревизия r1 → plan-ревью 2 раунда (раунд 1:
5 находок — семантика повторного захода (F-1 MEDIUM: Route на повторном
заходе делает setProps без ре-диспатча; leave уничтожает инстанс, возврат
монтирует новый с новым CDM — это и держит LIVE-3 «чаты при каждом заходе»);
безосновательная «идемпотентность» двойного фетча (F-2 MEDIUM: реальная
безопасность — синхронный WS-дедуп адаптера и content-дедуп Store; смоук
переведён в измеримый профиль); guard-семантика (F-3); LIVE-3-интент
миграции теста (F-4); именованный инвариант симметрии dispatch↔destroy
(F-5) → всё закрыто; раунд 2 — остаток OF-1 (три копии AC-CDM-3 сведены к
одному измеримому профилю) → READY_TO_FREEZE) → FROZEN, digest `7863a781…`,
lock, `plan verify` PASS, коммит → task compile → авторизация ALLOW
(«делай block-cdm ядро») → воркер attempt 1 чисто.

**Реализация (WS-BLOCK-CDM):** `Block.dispatchComponentDidMount` — приватный
per-instance флаг с ПОЛНЫМ short-circuit (без спуска к детям; флаг
выставляется до emit — реентерабельная безопасность; reset в destroy не
нужен: destroy снимает lifecycle-хендлеры, доказано существующим тестом);
рекурсия `children + _hbsChildren` — то же множество, что `destroy()`
(инвариант симметрии). `Router` module `render()` — единственная точка
активации (все пути монтирования сходятся в неё). `ChatPage.fetchChats`
мигрировал из конструктора в CDM (обход LIVE-3 снят); спящий
`AssistantPage.componentDidMount → loadChats` ожил без правок. +5 тестов
(тишина повторного dispatch; симметрия с реальным hbs-ребёнком; CDM при
монтировании роутером; revisit с параметром → count 1, leave→return →
count 2; chat — CDM-фетч + «конструктор не фетчит» + ре-фетч на повторном
заходе; assistant — loadChats на CDM). Итог: 186 тестов (181+5),
единственный мигрировавший — старый конструкторный LIVE-3.

**Живой смоук (контроллер, EV-CDM-2, измеримый профиль):** холодная
загрузка /messenger — ровно 2 `GET /chats` (bootstrap + CDM) и ровно 1 WS
на каждый из 6 чатов (дедуп адаптера); истинный SPA-переход (клики UI:
чаты→профиль→чаты) — ровно 1 `GET /chats`; /assistant загружает селектор
AI-чатов (5 опций). Расследован «двойной запрос при логине»: это гостевой
безусловный fetchChats из bootstrap `main.ts` (401 до логина) — давнее
поведение вне скоупа (main.ts forbidden), зафиксировано как note в квитанции.

**Проверено:** task-review attempt 1 **ACCEPTED** (гейты перепрогнаны,
digest-цепочка цела, оба отклонения воркера легитимны; TR-1..3 INFO).
Финальный аудит — см. квитанцию. Хвосты (INFO): live-смоук исполнен
контроллером; getToken-грань профиля не инструментирована (закрыта более
сильной наблюдаемой — ровно 1 WS/чат); SPA-строка EV-CDM-2 из ad-hoc
UI-прогона (значение закреплено Router-тестом).

## 2026-10-16 — ALK: stage 13 ai-provider-openai выполнен (r1, ACCEPTED attempt 1) — живой AI заработал

**Что:** бэкенд научен говорить с OpenAI-совместимым inference-сервером
оператора (llama.cpp + Qwen3.5-9B на 192.168.1.121:8080) — живой AI-контур
работает впервые. Пакет `tasks/2026-10-16-ai-provider-openai/`: ревизия r1 →
plan-ревью в 1 раунд (CHANGES_REQUIRED: 5 текстовых находок — симметричная
политика невалидных ручек, полнота тест-перечисления, точные места правки
runbook, режимо-нейтральные коммитимые дефолты compose, scripted-grep для
.env.example; архитектура seam подтверждена самодостаточной) → закрыты →
FROZEN r1, digest `fe334314…`, lock, `plan verify` PASS, коммит → task
compile → авторизация ALLOW («делаем A») → воркер attempt 1 чисто.

**Реализация (WS-AI-PROVIDER):** `CHATTY_BOT_PROVIDER_API` /
`CHATTY_RAG_EMBEDDING_API` ('ollama' дефолт | 'openai'; невалидное значение —
молчаливый fallback на 'ollama' по конвенции модуля); `OpenAIChatProvider`
(`/v1/chat/completions`, единый словарь error-kind с Ollama-веткой, пустой
ответ → `provider_malformed`); `OpenAIEmbeddingProvider` (`/v1/embeddings`,
позиционный парс с теми же guard'ами); фабрики диспетчеризуют по ручке.
+53 pytest (152 суммарно): оба режима × оба шва × error-kind'ы × невалидная
ручка × factory-dispatch. Compose прокидывает AI-переменные с
режимо-нейтральными дефолтами (адрес оператора — только в операторском env,
grep '192.168' по коммитимому пусто); `.env.example` и `own-backend.md`
описывают оба режима и 501-политику эмбеддингов.

**Живой смоук (контроллер, EV-AI-2):** api-контейнер в openai-режиме на
сервер оператора; обнаружен и закрыт недостающий пререквизит — аккаунт бота
`bot@chatty.local` (первый ран честно упал `bot_user_not_configured`,
зарегистрирован через публичный API); вопрос в is_ai-чат → `bot/runs`
`succeeded` → ответ модели в чате («Я — модель Chatty assistant.»): 4 рана —
первый честно упал на недостающем пререквизите, затем 3 успешных подряд. RAG-строки — честные UNAVAILABLE: у сервера нет
`/v1/embeddings` (501, llama.cpp без `--embeddings`); бот отвечает без
RAG-контекста штатным short-circuit'ом.

**Проверено:** task-review attempt 1 **ACCEPTED** (ревьюер перепрогнал
verify:backend 152 / verify:all / compose / grep'ы / guard и перепроверил
БД bot_runs); финальный аудит — см. квитанцию. Хвосты (INFO): live-смоук
исполнен контроллером (EV-AI-2 атрибуция), устаревшая строка EV-AI-1 об
отсутствии AI-переменных в операторском env на момент воркера, позиционный
парс embeddings без index-поля (задокументировано).

## 2026-10-16 — ALK: stage 12 practicum-cutover выполнен (r2, ACCEPTED attempt 1)

**Что:** проект полностью отвязан от бэкенда Я.Практикума (решение оператора
2026-10-16) и закрыты находки первого живого смоука. Пакет
`tasks/2026-10-16-practicum-cutover/`: ревизия r1 → независимое plan-ревью в
2 раунда (CHANGES_REQUIRED: 10 находок, 5 HIGH — неполнота write-set против
grep-гейта, 5 удаляемых адаптеров и 3 тест-хоста вне владения, дыра
`.env.development` с курсными URL и решение по именованию Vite-режима,
конфликт forbiddenWrites с удалением курсного CI, гонка HD-R2 → всё закрыто
→ READY_TO_FREEZE + 3 advisory) → FROZEN r1, digest `357d5846…`, lock,
`plan verify` PASS → авторизация ALLOW → task compile. Воркер исполнил обе
фазы в attempt 1; remediation r2 по решению оператора расширил write-set на
2 пути (`safety.test.ts` — неизбежный typecheck-фикс после схлопывания
`AppEnvironment.mode`; `constants.ts` — подсказка пароля «от 12 до 40»),
digest `cdb4eac8…`, lock пересоздан, ownership 60+3/0/0.

**Реализация (WS-LIVE-CUTOVER):** фаза A — живые фиксы LIVE-2…LIVE-7/HD-R3
приняты в delta без переписывания семантики, по одному осмысленному
регрессионному тесту на находку (Store-эмит вложенных слайсов, email-точки/
тримминг, отправка с актуальным `selectedChat` через `this.props`, fetchChats
при монтировании, null-avatar, ping-контент, таймаут/hold статуса); HD-R2
закрыт — единственный отправитель первичной истории живёт в подписке
`Connected` (пост-await send удалён), маршрутизация через сброс pending-load,
тест реконнекта на реальном backoff без дублей и переупорядочивания;
`oldestMessageId`/`cursorForBatch` удалены. Фаза B — удалены 5
practicum-адаптеров, env-развилка схлопнута в единственный own-режим
(`--mode own` и `.env.own.example` сохранены как имя Vite-конфигурации;
`.env.development` переписан на own-дефолты), формы на own-контракте
(login=email, register=email+password+confirm, пароль ≥12), `types.ts`/
`ports.ts` консервативно (AuthUser и валидаторы profile-страницы целы),
курсный bats-CI `tests.yml` удалён (verify.yml нетронут), README/AGENTS/CLAUDE
и docs/arch вычищены. Проверка: `npm run verify` 181 (172+9),
`verify:all` 181+99 pytest + alembic, compose preflight, guard strict 0,
grep-гейт 0 упоминаний practicum, live re-smoke PASS ×3 (чеклист этапа 11
дополнен секцией CUT-SMOKE), Ollama-строки честные UNAVAILABLE.

**Проверено:** независимый task-review attempt 1 **ACCEPTED** (гейты
перепрогнаны ревьюером, отклонения воркера признаны обоснованными, r2-аддендум
авторитетен). Контроллером закрыты carry-forward: строки CUT-SMOKE аппенднуты
в lead-owned чеклист, эта запись — финальная фиксация пакета. Открытый долг:
Block CDM (componentDidMount не активируется ядром — fetchChats в конструкторе
ChatPage как рабочий обход), Store-эмит теоретически избыточен на
перестановках ключей (лишний ре-рендер, INFO), AI live-строки — до появления
Ollama.

## 2026-10-16 — Live smoke own-стека: чеклист HARDEN-* закрыт, LIVE-2…LIVE-7 найдены и закрыты

**Что:** первый живой прогон полного контура после PR #24 (stage 11). Поднят
compose-стек (api/db/rustfs; пароль сентябрьского postgres-тома синхронизирован
через unix-socket ALTER ROLE, данные не удалялись), фронт — `vite --mode own`
(порт 3001: 3000 занят сторонним проектом; origin добавлен в
`CHATTY_ALLOWED_ORIGINS` операторского env). Ollama на хосте нет — AI-строки
остаются UNAVAILABLE, для чеклиста HARDEN-* не требуются. Все пять строк
закрыты PASS: DISCONNECT/RECONNECT — рестарт api (~14 c простоя, backoff
1→2→4→8→15с, обе вкладки переподключились, echo ровно один), HISTORY —
догрузка 01–10 без дублей с исчерпанием курсора (+ WS-контрактный носитель
`ws-history-smoke.mjs`, 30/30), ERROR — текстовые ошибки без крэша и recovery
по таймауту, CLOSE — детерминированный носитель. Браузерная проверка —
playwright-core headless + оператор вручную; запись — в
`tasks/2026-09-28-hardening-docs/harden-reconnect-history.md`.

**Найдено и закрыто вживую (фиксы в рабочем дереве, регресс-покрытие и
оформление — пакет `2026-10-16-practicum-cutover`):**

- **LIVE-5 (HIGH):** `Store.set` + мутирующий `helpers.merge` навсегда
  подавляли эмит `Updated` для вложенных слайсов после первого патча
  (`chatHistory`, `aiAssistant`) — рендер происходил только от посторонних
  эмитов, недетерминированно. Гвард ядра переведён на сравнение содержимого
  (deep-снимок до/после мержа).
- **LIVE-7:** отправка сообщений не работала в own-режиме никогда: колбэк
  `onSendMessage` не прокидывался в пропсы `Messenger`, а обработчик читал
  замыкание конструктора с устаревшим `selectedChat=undefined` (то же у
  кнопки удаления чата). Оба места читают `this.props`, колбэк прокинут.
- **HD-R3 (закрыт):** потерянный WS-ответ догрузки вечно держал
  `isLoading` — теперь таймаут 10 с возвращает строке рабочее состояние
  (текст + «Попробовать снова»); плюс UX-удержание статуса «Загружаем
  сообщения…» 2 с после успеха (по замечанию оператора), тесты обновлены.
- **LIVE-2:** вход через UI в own-режиме был невозможен — валидатор логина
  Практикума запрещал `@`/точки; email-валидация по `env.mode`, локальная
  часть допускает точки, логин триммится при отправке.
- **LIVE-3:** список чатов не запрашивался после SPA-входа (bootstrap из
  `main.ts` не повторяется) — `fetchChats` в конструкторе `ChatPage`; попутно
  выяснено: `componentDidMount` в `Block` не активируется никем
  (`dispatchComponentDidMount` без вызовов) — системный долг ядра.
- **LIVE-4:** чат без аватара ронял рендер списка — `src=null` в `chat.hbs`
  доходил до `fileUrl(null)`; null-guard в `ChatAvatar`.
- **LIVE-6:** ping уходил без `content` → `invalid_event_payload`,
  keepalive был мёртв; `WSTransportMessage.content` расширен объектным
  контентом, тест обновлён.

**Проверено:** `npm run verify` — 172 теста PASS (обновлены ping и
hold-status контракты); живой смоук — headless + вручную; WS-контракт —
30/30; auth-smoke runbook — register/me/refresh(CSRF-ротация)/logout/me-401.
HD-R2 (перезапрос истории после реконнекта) остаётся открытым LOW-долгом,
переносится в пакет `2026-10-16-practicum-cutover`.

## 2026-10-15 — ALK: stage 11 hardening-docs выполнен (r2, COMPLETE)

**Что:** закрыт финальный этап дорожной карты AI-messenger — runtime-hardening
и release-boundary документация. DRAFT-пакет `tasks/2026-09-28-hardening-docs/`
ревизован r1→r2 до freeze: база переставлена на `dev@99c5502` (PR #23, этап 10),
`leadOwned` выровнен по прецеденту (каталог пакета + progress-log за
контроллером), write-set расширен явным решением пользователя — точки
композиции history (`chats/ports.ts`, `ws/*`, `messenger.hbs`; строго
аддитивно) плюс закрытие всех хвостов этапа 10 (NEW-1, NEW-2/NEW-3, RV5/RV6
в `ai-assistant` + `HTTPTransport`) и протечки `Block.destroy/__children`.
Независимое plan-ревью: раунд 1 CHANGES_REQUIRED (F-01 HIGH — RV2-идиома NEW-3
требовала readOnly `store.ts`; F-02/03 MEDIUM — незафиксированный guard-легальный
маршрут врезки history-UI и незаписываемая строка HARDEN-CLOSE; 3 LOW) → все
закрыты → раунд 2 READY_TO_FREEZE. Freeze: lock `82a0d672…`, FROZEN r2,
коммит `ff7c3d9`; попутно исправлен формат `artifactPaths` r1-драфта (список
вместо dict), блокировавший task compile.

**Реализация (WS-HARDEN-DOCS, attempt 1→2):** `WSTransport` — bounded-реконнект
(backoff 1→16с, потолок 5 попыток), one-subscription semantics, явный
`close()` (intentional-close, снятие слушателей, чистка ping, reject
connect-промиса), 8 новых тестов; аддитивный `loadHistory` в `ChatMessagesPort`
(own: `before_id`/limit; practicum: `get old`) и модуль
`src/features/chats/history/` — курсор `next_before_id`, prepend-merge с
дедупликацией по id, состояния loading/error/empty, саморегистрирующийся
хелпер `ChatHistory` в `messenger.hbs` (22 теста); хвосты этапа 10 — по одному
регресс-тесту на находку; `Block.destroy` уничтожает compile-захваченных
`__children` (снимает протечку withStore-подписки при уходе с маршрута);
README/AGENTS актуализированы под own-эпоху, канонический runbook
`docs/deployment/own-backend.md` (preflight/health/rollback, без
production-заявлений; `internal-backend.md` сохранён как superseded).

**Проверено:** независимый ревьюер дал attempt 1 **REWORK** (HD-R1 MEDIUM —
practicum-курсор брал первый id DESC-пачки, т.е. новейший, вырождая пагинацию;
юнит-тест закреплял ошибку) — закрыт в attempt 2 (min-id, порядко-независимо;
оба порядка покрыты), **ACCEPTED**. `npm run verify` — **172 теста**
(129 базовых + 43 stage-11), `npm run verify:all` PASS (99 pytest + alembic;
PYTHON_BIN-venv воспроизведение), `docker compose config --quiet` PASS,
guard `--all --strict` — 0 нарушений, build PASS (ChatHistory в dist);
ownership 27/27, 0 forbidden. Финальный implementation-аудит — **PASS**,
3/3 finalAuditGates, final proof READY_FOR_FINALIZATION. Браузерные строки
HARDEN-DISCONNECT/RECONNECT/HISTORY/ERROR — честно **UNAVAILABLE** без живого
стека (HARDEN-CLOSE закрыт детерминированным носителем по формулировке r2).

**Открыто:** HD-R2 (LOW — первичная история не перезапрашивается после
внутреннего реконнекта), HD-R3 (LOW — нет recovery зависшего isLoading),
HD-R6/R7 (INFO: 4px-зазор пустого li, нюансы комментария/двойного connect),
LIVE-1 (INFO — браузерные строки дополнить при первом живом прогоне
compose+Ollama). Дорожная карта 11/11 этапов закрыта; PR этапа 11 в `dev`.

## 2026-10-07 — ALK: stage 10 fe-ai-module выполнен (r3, COMPLETE)

**Что:** открыт AI-frontend-контур дорожной карты — первый «модуль нового
образца» `src/features/ai-assistant/`. Пакет `tasks/2026-09-28-fe-ai-module/`
отрефризен r1→r3 за ДВА независимых аудит-раунда (CHANGES_REQUIRED →
фокусный PASS): r2 — база `dev@9b19dea` (PR #22, stage 9), закрытие трёх
дыр r1 (композиция: `features/index.ts`+`main.ts` были forbidden при том,
что только через них фича монтируется — перенесены в write-set со строго
аддитивными правками по прецеденту stage 4; тест-пути: директорная запись
вместо файла без тестов; адаптер `api/{index,own,practicum}.ts` по идиоме
stage 7 — без него reachable-бэкенд требовал бы cross-feature импорт);
r3 — закрытие находок раунда 1: **HIGH** — абсолютный запрет triple-stache
противоречил единственному механизму вложения компонентов
(registerComponent-хелперы возвращают raw HTML) — инвариант перецифицирован
на wire data (triple только для хелперов, все данные double-stache) +
детерминированный template-ассерт; MEDIUM — путь загрузки scss; 4 LOW.
Freeze: lock `bcd89228…`, worker packet WS-FE-AI; исполнение авторизовано
пользователем явно.

**Реализация (WS-FE-AI):** фича 25 файлами — module/ports/api (own —
реальный HTTP по контрактам stages 8/9: чаты, documents/search, messages,
bot/runs + ответ из истории по response_message_id; practicum — явный
unsupported), типизированный слайс с каст-идиомом (Store.ts не тронут),
контроллер-стейт-машина `idle/searching/typing/success/empty/error`,
`safety.ts` — единственное место рождения URL (положительный целый
file_id + настроенный базис через joinUrl → `files/{id}/download`;
небезопасный id деградирует в карточку без ссылки), компоненты
typing-индикатор и document-card, страница `/assistant` на withStore,
стили; строго аддитивные правки `features/index.ts` и `main.ts`. Два
инженерных решения в рамках write-set: scss-импорт в main.ts (mocha/tsx
не грузит .scss из графа тестов — план-отклонение зафиксировано) и
колокированный `hbs-test-loader.ts` — тестовый погрузчик .hbs через тот
же Handlebars, где живут компоненты-хелперы (первый в репо; в прод-сборку
не попадает — проверено ревьюером по dist).

**Проверено:** независимый ревьюер дал attempt 1 **REWORK** (HIGH RV1 —
stylelint-ошибка в новой scss роняла `npm run verify` exit 2; 3 LOW —
затирание input при ре-рендере, устаревший контент в error-состояниях,
selectChat без сброса; всё воспроизведено независимыми mocha-прогонами;
+2 INFO carry-forward) — закрыто в attempt 2 (+5 регрессионных тестов),
**ACCEPTED** (ревьюер воспроизвёл все четыре закрытия исполнением, гейты
с настоящими exit-кодами). `npm run verify` — **129 тестов** (88 базовых +
41 stage-10), `npm run build` PASS, guard `--all --strict` — 0 нарушений;
браузерный чеклист — честно **UNAVAILABLE** без живого own-бэкенда
(AI-HTML/AI-URL вердикты несут детерминированные сюиты по формулировке
r3). Аудиты implementation (attempt 2 PASS) / ownership (25/25
workstream-owned, 0 forbidden) / final-implementation / package
**--strict** — PASS (архивный FAIL-аудит попытки 1 выносился из каталога
на время скана — прецедент stages 4/7/8); workflow-state **COMPLETE**.

**Открыто:** браузерный смоук `/assistant` против живого own-бэкенда с
Ollama; NEW-1 (LOW — selectChat не сбрасывает status-флаги, пустой
error-бокс) и NEW-2/3 + RV5/6 (INFO: гонка selectChat с in-flight
запросом, uncontrolled ask-инпут, XHR timeout 0) — кандидаты в hardening.
Далее по дорожной карте: hardening/docs — финальный этап (pgvector,
live-Ollama-смоуки, runtime both-mode, UX-хвосты stages 4/7/10).

## 2026-10-06 — ALK: stage 9 backend-bot выполнен (r3, COMPLETE)

**Что:** открыт bot-контур дорожной карты — durable AI bot поверх контрактов
stage 6/8. Пакет `tasks/2026-09-28-backend-bot/` отрефризен r1→r3 за ДВА
независимых аудит-раунда (CHANGES_REQUIRED → фокусный PASS): r2 — база
`dev@e33c699` (PR #21, stage 8), сверка write-set с реальным деревом
(три дыры r1: точка монтирования `endpoints/__init__.py`, репозиторий
`repositories/bot_runs.py`, `.env.example` под `CHATTY_BOT_*`;
`pyproject.toml` — forbidden: ноль новых зависимостей), per-attempt
artifactPaths, воспроизводимая validation-команда; r3 — закрытие находок
раунда 1: **кросс-чат дыра** (чужой `message_id` мог протащить контент чата B
в ответ чата A — теперь 4 проверки source-message: 404/400/400/409),
**противоречие duplicate-delivery vs crash-resume** ( claim =
условный CAS `queued→running`, гонка первого создания — через unique-key
IntegrityError, зависший ряд ре-клеймится только после окна
`CHATTY_BOT_STALE_AFTER_SECONDS` на инжектируемых часах, бюджет попыток —
явный 409), bootstrap бот-пользователя (обычный аккаунт через публичный
auth API), FK-пины `bot_runs`. Freeze: lock `4d1e7393…`, worker packet
WS-BE-BOT; исполнение авторизовано пользователем явно.

**Реализация (WS-BE-BOT):** модель `BotRun` (`unique(message_id)`,
queued/running/succeeded/failed, attempt, error_kind, трассируемость
response/attachment) + миграция 004 зеркально с пинами FK; пакет `app/bot`
(env-настройки, локальный Ollama-only `/api/chat`-провайдер с injectable
transport и явными transport/HTTP/timeout/malformed-ошибками, промпт-граница
только system+chat-scoped-контекст+source); репозиторий с тремя CAS-клеймами
(fresh/stale/failed); сервис — валидация source-message, is_ai-гейт,
бот-пользователь по email с входом через `ChatService.add_member`, RAG за
инжектируемым швом (`DocumentService.search`, прокинут embedding-seam),
ответ публикуется через `MessageService.create` (авторизация вложения —
точка принуждения контракта, не обходится), top-hit `file_id`; endpoint
`POST /chats/{chat_id}/bot/runs` через seam `register_domain_router` —
main.py/router.py/ws не тронуты. WS-хук триггера/ broadcast — честный
carry-forward в AI-UI.

**Проверено:** независимый ревьюер дал attempt 1 **ACCEPTED** с первого раза
(исполнял код в контейнере: оба гейта воспроизведены — 99 и 48 passed;
11 payload-проб провайдера — stage-8 RV1-класс закрыт; 6 thread-race проб
файлового sqlite — ровно один ответ при гонках; пробы авторизации — ноль
чужого контента в промптах doc-less соседнего чата; миграция сверена с
моделью по PRAGMA). 0 HIGH/MEDIUM; LOW RV1 (дубль-ответ в миллисекундном
окне крэша между коммитами) и RV2 (нет кросс-валидации timeout/stale-окна
при операторской переконфигурации) — записаны carry-forward в hardening.
Изолированный docker-гейт `backend/verify.sh` — **99 тестов** (51 базовых +
48 stage-9: 31 unit, 17 integration), alembic head `004_bot_runs`; фокусная
команда манифеста — 48 passed; **BOT-OLLAMA — честно UNAVAILABLE** (ollama
не установлен, 127.0.0.1:11434 refused). Аудиты implementation (PASS) /
ownership (17/17 workstream-owned, 0 forbidden) / final-implementation /
package **--strict** — PASS; workflow-state **COMPLETE** (rev 9).

**Открыто:** live-смоук с поднятым Ollama (`qwen3:14b`); RV1-фикс через
`client_message_id='bot-run-{run.id}'` и RV2-гард конфигурации — кандидаты в
hardening; WS-хук авто-триггера и broadcast ответов — в AI-UI. Далее по
дорожной карте: AI-UI, hardening/docs.

## 2026-10-06 — ALK: stage 8 backend-docs-rag выполнен (r3, COMPLETE)

**Что:** открыт RAG-контур дорожной карты — document ingestion и chat-scoped
retrieval на бэкенде. Пакет `tasks/2026-09-28-backend-docs-rag/` отрефризен
r1→r3 за ДВА независимых аудит-раунда (CHANGES_REQUIRED → фокусный PASS):
r2 — база `dev@ac50c6f` (PR #20, stage 7), сверка write-set с реальным деревом
(две дыры r1: `backend/pyproject.toml` под парсерные зависимости и
`backend/app/api/v1/endpoints/__init__.py` под монтирование домена),
per-attempt artifactPaths, honest-заявления среды (compose — обычный
postgres:16-alpine; pgvector — записанный carry-forward, эмбеддинги —
портативные JSON-векторы + cosine top-k в сервисе); r3 — закрытие находок
раунда 1 (сортировка planFiles, воспроизводимая validation-команда,
`.env.example` в write-set, cold-import guard). Freeze: lock
`0e53a6a2…`, worker packet WS-BE-RAG; исполнение авторизовано пользователем
явно.

**Реализация (WS-BE-RAG):** модели Document/DocChunk (ready/processing/failed
с явными error_kind, миграция 003 зеркально); ingestion-пакет —
детерминированные парсеры docx/text-PDF/xlsx, bounded `.doc`-конвертер
(soffice-сабпроцесс с жёстким таймаутом и инжектируемой командой),
word-aware чанкер, embeddings-шов Ollama-only без cloud fallback; сервис
ingest (только `require_roles('admin')`) + membership-scoped top-k retrieval
с file_id-трейсируемостью и детерминированным порядком; монтирование через
шов `register_domain_router` из `endpoints/__init__.py` — main.py/router.py
не тронуты, холодный `import app.api.v1.router` гасится явным guard-сообщением;
5 операторских CHATTY_RAG_* в `backend/.env.example`. Фикстуры-бинарники
сгенерированы контейнером + хостовым soffice (sample.doc — настоящий OLE2).

**Проверено:** независимый ревьюер дал attempt 1 **REWORK** (MEDIUM RV1,
воспроизведён в контейнере: malformed embedding-payload пробивал мимо
EmbeddingError → HTTP 500 и документ навсегда в processing; +2 INFO) —
закрыто в attempt 2: float-конвертация под try/except, отказ пустых
векторов, length-guard'ы в обоих путях сервиса (раньше `zip` молча мог дать
ready без чанков), сквозной регрессионный тест с провайдером-нарушителем;
attempt 2 **ACCEPTED** (ревьюер независимо воспроизвёл RV1 как закрытый).
Изолированный docker-гейт `backend/verify.sh` — **51 тест** (было 10 на
базе), alembic head `003_documents_chunks`; живая `.doc`-конвертация
хостовым LibreOffice 7.3.7.2 — 3.06 с при границе 30 с; **RAG-OLLAMA —
честно UNAVAILABLE** (ollama не установлен, 127.0.0.1:11434 refused).
Аудиты implementation (attempt 2 PASS) / ownership (28/28 workstream-owned,
0 forbidden) / final-implementation / package **--strict** — PASS
(архивный FAIL-аудит попытки 1 выносился из каталога на время скана —
прецедент stages 4/7); workflow-state **COMPLETE** (rev 12).

**Открыто:** live-смоук с поднятым Ollama (нужна нативная установка —
сейчас UNAVAILABLE); pgvector-носители/индексация — carry-forward в
hardening; processing-окно при жёстком крэше процесса задокументировано
(RV3, поиск исключает, ре-ingest восстанавливает). Далее по дорожной карте:
bot, AI-UI, hardening/docs.

## 2026-10-06 — ALK: stage 7 api-cutover выполнен (r4, COMPLETE)

**Что:** завершён cutover-этап frontend-контура дорожной карты — фронтенд
переведён с legacy `src/api`/`MessagesController` на режимные адаптеры за
неизменными фича-портами. Пакет `tasks/2026-09-28-api-cutover/` отрефризен
r1→r4 за ТРИ независимых аудит-раунда (CHANGES_REQUIRED → PASS → фокусный
PASS): r2 — база `dev@66b2d44` (PR #19, stage 4), reconciliation write-set с
post-stage-4 деревом (main.ts остался readOnly+forbidden, композиция — только
`features/index.ts`), снос 5 файлов `src/api` + `MessagesController` со своими
адаптерами, `ChatsPort.searchUsers` (перевод прямого legacy-вызова в контракт),
`Message`-DTO в `utils/types.ts`; r3 — маппинг креденциалов own-режима
(login→email, UserResponse→AuthUser с дефолтами) и console-level own-смоук
(валидаторы форм остаются калиброванными под Практикум — записанное
ограничение), `messenger.hbs` в write-set (URL вложения идёт через хэш
хелпера), `csrf.test.ts`; r4 — однопредложенческие уточнения (матрица
поддержки own-chats, PR-boundary, `npm run dev -- --mode own`).

**Реализация (WS-API-CUTOVER):** адаптеры `features/{auth,chats,profile}/api/
{practicum,own,index}.ts` (выбор по `env.mode`; practicum — endpoint'ы 1:1 с
legacy; own — реальный контракт: register/login/refresh/logout/me с CSRF
double-submit `chatty_csrf`/`X-CSRF-Token` и refresh-retry-once на 401,
chats create/list/members с токен-сентинелом для cookie-auth WS, остальные
операции — явные unsupported-ошибки); WS-шлюз `features/chats/ws/
{gateway,practicum,own}.ts` вместо MessagesController (события message/history
с маппингом created_at→time и file_id→filesUrl, единственный reverse за
`appendMessages`, наблюдаемое `closeAllChatSockets`); `sendMessage` — пропсами
через страницу чата (компоненты больше не импортируют ни controllers, ни
фичи); URL вложения — через хэш Message-хелпера в рендерер; последняя запись
`TRANSITIONAL_DEBT` (Store.ts) снята — карта долга пуста.

**Проверено:** независимый ревьюер дал attempt 1 **REWORK** (2 HIGH:
двойной reverse own-истории — воспроизведено исполнением кода; `fileUrl` не
прокинут в хэш хелпера — фича была мёртвым кодом; + 2 MEDIUM: вакуумный
signup-тест, AC-гейт при UNAVAILABLE-смоуке; LOW/INFO) — всё закрыто в
attempt 2, **ACCEPTED** (ревьюер исполнял реальный код: desc-история →
возрастание, эхо в конец; трассировка CSRF-точек и refresh-логики).
`npm run verify` — **88 тестов** (было 64; +24: csrf/api/ws), guard `--all
--strict` — exit 0, **карта долга пуста**, build PASS, ownership 40/40,
аудиты implementation/final-implementation/package(--strict) — PASS;
workflow-state **COMPLETE**. Practicum-эндпоинты живы (401/400 пробы), полный
логин-смоук и own-бэкенд в этой среде недоступны — честно UNAVAILABLE.
Локальная модель не использовалась; исполнение авторизовано пользователем явно.

**Открыто:** runtime-смоук обоих режимов (нужны курс-креды/поднятый own-бэкенд)
и LOW-хвост stage 4 (слабый тест поиска, мёртвая isProtectedRoute-ветка) —
кандидаты в hardening-этап. Новый INFO-долг (найден ревьюером stage 7,
унаследован из stage 4 байт-в-байт): замыкание кнопки отправки в messenger
читает `selectedChat` из конструкторных пропсов, а withStore обновляет
внутренние — отправка сразу после холодного выбора чата уходит с `undefined`
(фикс — чтение `this.props` в обработчике). Далее по дорожной карте: RAG,
bot, AI-UI, hardening/docs.

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
workflow-state **COMPLETE** (state rev 10), final-proof в
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
packet set hash: `1394f3747547df8c8b324c704a79116db279909b0fc7babc4b072db11b21130`.

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
получает шаблоны `result`/`review` под прежний evidence-root. Обновлены
package-local ссылки, выполнены независимый повторный audit
`READY_TO_FREEZE` и `plan.lock.json` revision 3.

**Проверено:** manifest digest
`2ffcc9757346065348353c7524ba39c39472dca1d0731eb2b9ba60099d0d171e`,
`lock-create` (`filesystemVerified: true`), `plan check`, acceptance, refs и
`plan verify` — PASS. Standard worker packet compiled with digest
`1576ebab8f990ea5d4aec385c35ec96e29bcbd1deb131f80d457b95f0af80cf3`, compact
packet (`4k-strict`) — `e5bc9774052812288d4a8b80cbe78b468f574400dc7dad9a9170f5b47d936456`.
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
отдельный будущий gate. Пакет `2026-09-28-backend-skeleton` обновлен до revision 2
как первая минимальная внутренняя backend-поставка: health/readiness, auth, миграции,
Compose, root/backend verify и внутренний runbook. Пакет
`2026-09-28-env-api-abstraction` зафиксирован как следующий frontend-пакет после
приёмки backend в `dev`.

**Проверено:** JSON-манифест backend синхронизирован со specification, acceptance,
health ownership и runbook; runtime-код еще не создавался. Структурные ALK-гейты и
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
