# Plan — 2026-11-06-llm-chat-autotitle

Ветка `feature/2026-11-06-llm-chat-autotitle` от `dev` @ `cf8c35d`.
Базовые гейты (Linux-стенд, 2026-11-06): `npm run verify` PASS (mocha 712),
pytest 307 passed, alembic head `013_chat_auto_title` (логи:
`work/2026-11-06-llm-chat-autotitle/base-verify.log`, `base-pytest.log`).

Порядок строго последовательный: WS-BE-AUTOTITLE → WS-FE-AUTOTITLE
(maxParallelTasks = 1).

---

## WS-BE-AUTOTITLE — сервис, провайдер, триггер, pytest

Owner: worker-backend-autotitle. Зависимостей нет.

### 1. Конфиг (`backend/app/bot/config.py`)

Новый frozen-dataclass `AutoTitleSettings` + `autotitle_settings_from_env()`
(стиль — рядом лежащие bot-ручки; все значения с защитой от мусора в env):

| Ручка | Дефолт | Смысл |
| --- | --- | --- |
| `CHATTY_AUTOTITLE_ENABLED` | `true` | kill-switch оператора |
| `CHATTY_AUTOTITLE_MIN_USER_MESSAGES` | `2` | порог: юзерских реплик ≥ |
| `CHATTY_AUTOTITLE_MIN_USER_CHARS` | `120` | порог: суммарно символов ≥ |
| `CHATTY_AUTOTITLE_CONTEXT_MESSAGES` | `10` | контекст: последних сообщений |
| `CHATTY_AUTOTITLE_CONTEXT_CHARS` | `2000` | контекст: кап символов |
| `CHATTY_AUTOTITLE_TIMEOUT_SECONDS` | `15` | бюджет одного вызова модели |
| `CHATTY_AUTOTITLE_MAX_TITLE_CHARS` | `48` | гигиена: макс. длина названия |
| `CHATTY_AUTOTITLE_MAX_CHAT_MESSAGES` | `40` | хвостовой гвард: чатов старше — не трогаем |

Провайдер/модель/URL — ТОЛЬКО ботовские (`CHATTY_BOT_PROVIDER_API/_URL/_MODEL`);
отдельного стека нет. Секция ручек — в `backend/.env.example`.

### 2. Провайдер (`backend/app/bot/provider.py`)

Опциональный короткий режим — `complete_short(self, messages, *, max_tokens,
timeout_seconds: float) -> str` у `OllamaBotProvider` (body: `think: False`,
`options: {'num_predict': max_tokens}`) и у `OpenAIChatProvider` (body:
`max_tokens`, `chat_template_kwargs: {'enable_thinking': False}` — ручка уже
есть в `_request_body`). Таймаут вызова — параметр `timeout_seconds` через
общий `_provider_timeout` (бюджет `CHATTY_AUTOTITLE_TIMEOUT_SECONDS` доезжает
до короткого пути; `complete()`-фолбэк остаётся на таймауте провайдера —
ботовском). Повторное использование парсинга/ошибок `BotProviderError` из
`complete()` — общие хелперы, не копипаста. Существующие
`complete`/`complete_stream` не меняются.

### 3. Промпт (`backend/app/bot/prompts.py`)

`build_title_messages(dialogue: list[dict[str, str]]) -> list[dict[str, str]]`:
один system-блок (прецедент «двух подряд system Qwen3.5 в llama.cpp падает 500»)
+ user-блок с транскриптом. Система (RU): назвать тему диалога 2–4 словами на
языке диалога, без кавычек и точки; если определённой темы нет (только
приветствия/болтовня) — вернуть ровно `NONE`. Транскрипт: строки
`user: …` / `bot: …` (роль по `user_id == bot_user_id`).

### 4. Сервис (`backend/app/services/chat_autotitle.py`, новый)

Синхронный `ChatAutoTitleService(session, bot, autotitle, *, provider)`:

```
maybe_rename(chat_id) -> str | None
```

1. Читает `Chat`; `None`/не `auto_titled`/`is_dm` → `None`.
2. Гейт по конфигу: `enabled` выключен → `None`.
3. Подсчёт юзерских реплик (SQL-агрегат или выборка): сообщения чата с
   `kind IS NULL`, непустым `content`, `user_id != bot_user_id` (бот-юзер —
   `users.get_by_email(bot.user_email)`; его нет → все реплики юзерские).
   Итоговое число сообщений чата (включая бот-ответы) ≥ `MAX_CHAT_MESSAGES`
   → `None` (хвостовой гвард). Порог: `count >= MIN_USER_MESSAGES` и
   `sum(len) >= MIN_USER_CHARS`, иначе → `None` (модель не зовётся).
4. Контекст: последние `CONTEXT_MESSAGES` сообщений (оба рода), сборка с хвоста,
   кап `CONTEXT_CHARS` (обрезка головы транскрипта), роли user/bot.
   В транскрипт идут ТОЛЬКО `kind IS NULL`-сообщения с непустым `content` —
   системные строки («X переименовал чат…») и file-only реплики (content NULL)
   в промпт не попадают.
5. Вызов: `complete_short = getattr(provider, 'complete_short', None)`; есть —
   `complete_short(prompt, max_tokens=64, timeout_seconds=autotitle.timeout_seconds)`,
   нет — `provider.complete(prompt)` (scripted-фейки; прецедент `_answer` в
   `BotService`). Ошибки `BotProviderError` — наружу НЕ летят: лог + `None`.
6. Гигиена ответа: `strip`; снять парные обрамляющие кавычки `"`/`'`/`«»`;
   срезать хвостовую `.`; отвергнуть пустое, `NONE` (case-fold), многострочное,
   длиннее `MAX_TITLE_CHARS` → `None` (флаг жив — ретрай на следующем сообщении).
7. CAS одним statement:
   `update(Chat).where(Chat.id == chat_id, Chat.auto_titled.is_(True))
   .values(title=title, auto_titled=False)`; `rowcount == 0` → `None`;
   иначе commit и `return title`.
   Системное сообщение НЕ создаётся (тихое переименование).
8. Сервис не импортирует `app.ws.hub` и не знает про WS (grep-пин F-5).

### 5. Планировщик (`backend/app/ws/autotitle.py`, новый) и две точки триггера

Модуль живёт в WS-слое (мост «сервис → broadcast»): `app/services` не имеет
права импортировать `app.ws.hub` (grep-пин review F-5), а эндпоинты ws-модули
импортируют уже сегодня (`from app.ws.hub import hub` в endpoints/chats.py).

- `schedule_autotitle(app_state, chat_id)`: `chat_id in _AUTOTITLE_INFLIGHT`
  (модульный `set[int]`) → тихий возврат; иначе добавить и
  `asyncio.create_task(_autotitle_task(app_state, chat_id))`;
- `_autotitle_task`: `finally: discard(chat_id)`; свежая сессия
  `app.state.session_factory()`; настройки `bot_settings_from_env()` +
  `autotitle_settings_from_env()`; провайдер — `get_bot_provider(app.state, bot)`
  (инъекция `app.state.bot_provider` уважается тестами);
  `title = await asyncio.to_thread(service.maybe_rename, chat_id)`;
  `title` не `None` → `hub.broadcast(chat_id, {'type': 'chat_renamed',
  'content': {'chat_id': chat_id, 'title': title}},
  active_user_ids=ChatService(session).active_member_ids(chat_id))`;
  любые исключения — `logger.warning(... exc_info=True)`, наружу ничего.

Обе точки вызывают `schedule_autotitle` fire-and-forget (отправка сообщения
никогда не ждёт модель):

- `backend/app/ws/router.py` — после `hub.broadcast({'type': 'message', ...})`
  в ветке `event.type == 'message'` (путь композера мессенджера);
- `backend/app/api/v1/endpoints/chats.py` `create_message` — после persist
  (путь страницы AI-ассистента: `askBot` шлёт вопрос именно через HTTP
  POST `/chats/{id}/messages` — план-ревью F-1).

### 6. Тесты (`backend/tests/unit/chat/test_chat_autotitle.py`,
`backend/tests/integration/chat/test_chat_autotitle_llm.py`, новые)

Unit (прямой вызов сервиса, sqlite, scripted-провайдер записывает промпты):
- гейт: 1 реплика/16 символов — модель не звана; 2 реплики/130 символов —
  звана; бот-реплики и `kind='chat_renamed'` строки не считаются; не-auto_titled,
  is_dm (сила-флаг через ORM — прецедент `make_dm_auto_titled`), disabled,
  `MAX_CHAT_MESSAGES` хвост — модель не звана; AI и не-AI чаты одинаково;
- контекст: роли user/bot по `bot_user_id`, капы сообщений/символов, транскрипт
  без `kind`-строк и file-only реплик (пин по записанному промпту фейка);
- гигиена: кавычки/точка снимаются; пусто/`NONE`/`none`/многострочно/длиннее
  48 → `None`, флаг жив;
- CAS: после успеха второй вызов `rowcount=0` → `None`; флаг, погашенный
  вручную до вызова, — LLM-название не применяется.

Integration (один `TestClient(app)` на HTTP-сидирование и `websocket_connect`
— паттерн `test_bot_ws_broadcast.py`: лишние клиентские контексты прогоняют
lifespan-shutdown и dispose'ят общий in-memory движок; `app.state.bot_provider`
— scripted; autouse-фикстура сбрасывает `app.ws.autotitle._AUTOTITLE_INFLIGHT`
между тестами — схема пересоздаётся, id чатов повторяются):
- юзер шлёт сообщения в auto_titled чат через WS; до порога `chat_renamed`
  не приходит; после пороговой реплики с валидным ответом фейка приходит
  `chat_renamed {chat_id, title}` активным участникам, `chats.auto_titled == 0`,
  строки `kind='chat_renamed'` в истории НЕТ; следующие сообщения не
  переименовывают;
- HTTP-путь: тот же one-shot срабатывает при отправке через
  POST `/chats/{id}/messages` (путь askBot — план-ревью F-1);
- `NONE`-ответ: события нет, флаг жив; следующее сообщение с валидным ответом
  переименовывает;
- гонка: ручной rename (PUT) до фоновой отработки — флаг уже погашен, LLM
  CAS тихо пропускает, ручное название остаётся.

Ожидание фоновой задачи в тестах — receive/poll с таймаутом (не sleep-фиксации).

Известная принятая гонка (ревью F-3, не чиним): 013-append читает флаг из
in-memory строки чата — участник, добавленный в секундное окно вызова модели,
может перезаписать свежий LLM-титул механическим «Чат с …» при уже погашенном
флаге; исход деградационный, задокументирован в constraints манифеста.

### Гейт качества WS-BE-AUTOTITLE

`bash backend/verify.sh` зелёный (pytest + `alembic heads` ==
`013_chat_auto_title` — миграций нет); ни один файл `src/` не тронут.

---

## WS-FE-AUTOTITLE — фронтовые дельты + docs

Owner: worker-frontend-autotitle. dependsOn: WS-BE-AUTOTITLE.

### 1. `src/features/chats/controller.ts` — `handleChatRenamedEvent`

Сейчас: skip при identical title, иначе патч только `title`. Стало:
- при `current.auto_titled === true` — гасить флаг в том же патче
  (`auto_titled: undefined`) ВСЕГДА, включая identical-title случай
  (LLM могла вернуть текущий заголовок — сервер флаг уже погасил);
- не-auto_titled чат: прежнее поведение (identical — идемпотентный skip).

Инпут в шапке меняется на h2 сам — `messenger.ts` `autoTitleInput` читает
слайс (его НЕ трогаем).

### 2. AI-чат рождается auto_titled

- `src/features/ai-assistant/pages/assistant.ts`: `createAiChat({ title:
  AI_CHAT_TITLE, is_ai: true, auto_titled: true })`;
- `src/features/ai-assistant/controller.ts`: тип параметра
  `createAiChat(data: { title: string, is_ai?: boolean, auto_titled?: boolean })`
  с прокидом в порт;
- `src/features/ai-assistant/ports.ts`: `createChat?(data: { title: string,
  is_ai?: boolean, auto_titled?: boolean })`;
- `src/features/ai-assistant/api/own.ts`: payload `auto_titled` — только когда
  явно выставлен (зеркало `src/features/chats/api/own.ts` `createChat`).

### 3. Тесты (mocha)

- `src/features/chats/chats.test.ts`: `chat_renamed` патчит title И гасит
  `auto_titled` (включая identical-title при живом флаге; не-auto_titled —
  прежний идемпотентный skip);
- `src/features/ai-assistant/api/api.test.ts`: POST /chats payload несёт
  `auto_titled: true` когда передан, отсутствует когда нет;
- `src/features/ai-assistant/controller.test.ts` / `pages/assistant.test.ts`:
  прокид `auto_titled: true` из пустого состояния ассистента.

### 4. Docs

`docs/progress/progress_log.md` — запись сверху: фича, механизм (гейт/контекст/
CAS), ручки оператора, чем проверено.

### Гейт качества WS-FE-AUTOTITLE

`npm run verify` зелёный (счётчик растёт от 712);
`node .claude/hooks/scripts/guard-architecture.mjs --all --strict` — ноль
нарушений; ни один файл `backend/` не тронут.
