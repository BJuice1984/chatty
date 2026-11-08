# Plan — 2026-11-08-vacation-skill (rev 3)

S2, две последовательные волны (WS-BE-DATA → WS-BE-FLOW), ветка
`feature/2026-11-08-vacation-skill` от origin/dev
@ dc65e03fc48470b9c9aabf605d09ac3886610642 (PR мобильного UX не
конфликтует — файлы непересекающиеся; если влит раньше запуска —
ребейз до task-start). Только бэкенд; фронт не трогаем.

## WS-BE-DATA — хранилище, парсер, ингест, lookup, ранбук

### 1. Модели и миграция 015 (REQ-DATA)

- `backend/app/models/vacation_schedule.py`: `VacationSchedule` —
  id, source_name String(255), year Integer, ingested_at DateTime,
  row_count Integer.
- `backend/app/models/vacation_period.py`: `VacationPeriod` — id,
  schedule_id FK vacation_schedules.id ON DELETE CASCADE, full_name
  String(120), department String(120), position String(120),
  start_date Date, days Integer; ix(schedule_id, full_name); имена
  констрейнтов руками (naming convention в проекте нет, см.
  app/db/base.py).
- `backend/app/models/vacation_name.py`: `VacationName` — user_id PK
  FK users.id ON DELETE CASCADE, schedule_name String(120),
  confirmed_at DateTime.
- `backend/app/models/assistant_dialog_state.py`:
  `AssistantDialogState` — user_id PK FK users.id ON DELETE CASCADE,
  state String(32), origin_content Text nullable, attempts Integer
  default 0, updated_at DateTime.
- `backend/alembic/versions/015_vacations.py`: все 4 таблицы одним
  сегментом, down_revision='014_message_kind_widen' (ревизия-ид
  проверен ревью r1 — буквальный '014_message_kind_widen').
- `backend/app/models/__init__.py`: экспорт 4 новых моделей — это
  ЯВНЫЙ акт регистрации для Base.metadata: тесты поднимают схему
  `Base.metadata.create_all` (conftest) и не должны зависеть от
  порядка импортов; необэкспортированные модели (Message, Document,
  BotRun) едут через цепочку app.main — на них новым пакетам
  полагаться нельзя (F-9).

### 2. Конфиг пакета (REQ-DATA)

`backend/app/vacations/config.py` по паттерну `app/bot/config.py`:
frozen dataclass `VacationSettings` + `vacation_settings_from_env()`:
`CHATTY_VACATION_DATA_DIR` (default: `<backend>/data` — Path от
`__file__` вверх, НЕ cwd), `CHATTY_VACATION_FILE_GLOB` (default
`'график отпусков*.xlsx'`), `CHATTY_VACATION_DIALOG_TTL_SECONDS`
(default 600). Записи в `backend/.env.example`. Ядро
`app/core/config.py` не трогать.

### 3. Парсер (REQ-PARSE, порт с проверенного)

`backend/app/vacations/parser.py` — перенос ПАРСИНГА даты/строк из
`tasks/RAG-docs/vacation_query.py` (readOnly, проверен на реальном
файле; матчинг НЕ портируем — см. §5): `parse_schedule(path) ->
ParsedSchedule` (source_name, year, rows[ParsedRow(full_name,
department, position, start, days)], skipped[str]). Правила: листы с
B1 == 'ФИО' (все 5 листов реального файла); строка-«департамент» —
заполнена только A → текущий department; даты: datetime/date-ячейка;
строки `%d.%m.%Y`, `%d/%m/%Y`, `%d.%m.`, `%d.%m`, `%d/%m` (усечённые
— год из regex `20\d{2}` в имени файла, fallback
`date.today().year`); days — int(num) или пропуск; строки с ФИО без
даты ИЛИ дней → skipped (D-8); whitespace-ячейки = пусто. openpyxl
`read_only=True, data_only=True`.

### 4. Ингест-CLI (REQ-INGEST, D-13)

`backend/scripts/ingest_vacations.py`: флаги `--file PATH` (default:
glob `vacation_settings_from_env()`) и `--db URL` (оверрайд
`CHATTY_DATABASE_URL` из `get_settings()` — ингест с хоста против
compose-Postgres по операторскому env, без правок compose); sync
engine + session; транзакция: удалить `VacationSchedule` с тем же
(year, source_name) → вставить снимок + периоды; печать сводки
(листы, строк, skipped); exit 1 с reason при отсутствии/нераспарсе
файла. Схема в рантайме не меняется (миграции только alembic).

### 5. Lookup-сервис (REQ-LOOKUP)

`backend/app/vacations/service.py`: `VacationService(session)`:
- `find(query) -> Match`: normalize (lower, ё→е, точки→пробел,
  squeeze); СНАЧАЛА равенство ПОЛНОЙ нормализованной строки ФИО (все
  токены: «Гончаров А.Б.» резолвится однозначно среди двух Гончаровых
  — бот сам просит инициалы при коллизии, F-R2-2); затем
  токен-правило: первый токен запроса ДОЛЖЕН РАВНЯТЬСЯ первому
  токену (фамилии) full_name — НОВОЕ, более строгое правило D-7, НЕ
  порт substring-логики vacation_query.py («Романов» НЕ матчит
  «Романову К.В.», что старая логика бы сматчила); при нуле точных —
  кандидаты по ПРЕФИКСУ (stored фамилия начинается с токена запроса:
  «Гончар» → оба Гончарова) списком уточнения; ноль кандидатов →
  difflib подсказки по фамильным токенам (n=3, cutoff 0.5);
  результат found / ambiguous / not_found(+suggestions).
- `format_periods(person) -> list[str]`: строки
  «{full_name} с {DD.MM.YYYY} на {N} {день|дня|дней}», сортировка по
  start_date; склонение: n%10==1 и n%100!=11 → день; 2–4 (кроме
  12–14) → дня; иначе дней.

### 6. Сторы (REQ-STATE, персистентность)

`backend/app/vacations/store.py`: `VacationStore(session)`:
`get_surname(user_id)`, `save_surname(user_id, schedule_name)`
(upsert + confirmed_at=now), `delete_surname(user_id)` (рекавери
устаревшей фамилии, D-15), `get_state(user_id)` (None при пустом
state ИЛИ updated_at старше TTL), `set_state(user_id, state,
origin_content, attempts)` / `clear_state(user_id)` /
`bump_attempts(user_id)`.

### 7. Ранбук оператора (REQ-RUNBOOK, D-13)

`docs/deployment/vacation-schedule.md` (рядом с own-backend.md):
куда класть файл (`backend/data/`, гитигнор); точная команда ингеста
с реальными флагами `--file`/`--db` и VENV-интерпретатором бэкенда
стенда (шов D-11: глобальный py -3.12 без sqlalchemy/pydantic-settings
— в плане плейсхолдер `<backend-venv-python>`, фактический путь стенда
записывает сам ранбук; строка postgresql — из операторского env);
семантика обновлений (тот же год —
полная замена снимка, новый год — рядом; фамилии переживают
реингест, канонические имена; исчезновение человека из снимка → бот
перезапросит фамилию); проверка (сводка + один lookup); откат
(перезапуск с прежним файлом). Команды в ранбуке обязаны совпадать с
фактическими флагами CLI — расхождение это finding.

### 8. Тесты WS-BE-DATA

- `backend/tests/unit/vacations/test_parser.py` — фикстура-билдер
  synthetic_xlsx(tmp_path) со ВСЕМИ форматами (AC-PARSE); год из
  имени файла; skipped-подсчёт.
- `backend/tests/unit/vacations/test_lookup.py` — AC-LOOKUP
  (токен-точность, Романов/Романова, префикс-кандидаты «Гончар»,
  подсказки, format_periods склонения).
- `backend/tests/integration/test_migration_015_vacations_segment.py`
  — roundtrip по шаблону `test_migration_011_settings_segment.py`
  (stamp → downgrade до собственного down_revision сегмента
  '014_message_kind_widen' → upgrade head; inspect: 4 таблицы, FK,
  index; F-R2-1).
- `backend/tests/integration/vacations/test_ingest_cli.py` —
  идемпотентность замены того же года, второй год рядом, `--db`
  оверрайд (AC-INGEST); запуск main() скрипта (не subprocess),
  scratch-sqlite в tmp_path через monkeypatch CHATTY_DATABASE_URL.
- `backend/tests/unit/vacations/test_store.py` — TTL, upsert,
  delete_surname.

Гейт волны: D-11 (`PYTHON_BIN=<venv> bash backend/verify.sh`), всё
зелёное кроме ровно 4 известных ingestion-падений, ноль новых;
новые тесты не зависят от soffice. EV-2: прогон CLI на РЕАЛЬНОМ
графике (оператор стейджит файл в `backend/data/` — шаг launchGate,
F-6) в scratch-sqlite + контрольный вывод vacation_query.py.
`.gitignore` (корневой): добавить `backend/data/` И `tasks/RAG-docs/`
(реальный xlsx и персональные RTF лежат там untracked — один
`git add` до утечки, F-5).

## WS-BE-FLOW — интент, машина состояний, хук бота, LLM-ответ

### 1. Классификатор (REQ-INTENT)

`backend/app/vacations/intent.py`, чистые функции + константы:
`SCHEDULE_RE` (явный график: «график … отпуск», «отпуск … график»,
«мои даты», «когда мой отпуск»), `VACATION_RE` =
`\bотпуск(?:а|у|е|ом|и|ов|ам|ах)?\b` — хвостовая граница слова САМА
является глагольным гвардом: продолжения глаголов («отпускает»,
«отпускаю», «отпускаешь») не заканчиваются на именной суффикс и не
мэтчатся, а «отпуска/отпуске/отпуском» — да (D-9; прежняя
negative-lookahead-формулировка была мёртвым кодом — F-3); наборы
`YES_WORDS` (да/давай/хочу/узнать/покажи/конечно/ага/ок/окей),
`NO_WORDS` (нет/не хочу/не надо/позже/неа), `CANCEL_WORDS`
(отмена/отменить/стоп/пропустить). `classify(content) -> 'schedule'
| 'vacation' | 'yes' | 'no' | 'cancel' | None`, порядок проверки
schedule → vacation → yes → no → cancel → None; регистронезависимо,
ё→е.

### 2. Машина состояний (REQ-FLOW)

`backend/app/vacations/skill.py`: `VacationSkill(session,
provider)`; `handle(*, content, user_id) -> SkillOutcome | None`,
`SkillOutcome(reply: str | None, passthrough_question: str | None)`:

- стейт из стора (с TTL): `awaiting_yes` → yes: (фамилия есть →
  ответ С3, при not_found по сохранённой фамилии — рекавери D-15:
  удалить фамилию, сообщить «график обновился», переспросить один
  раз в том же флоу; нет → вопрос фамилии, state=awaiting_surname) /
  no: `passthrough_question=origin_content`, clear (D-6) / cancel:
  короткий ack и clear / сообщение снова классифицируется как
  vacation/schedule → ПОВТОРНОЕ предложение с обновлённым
  origin_content (F-7) / прочее → clear, вернуть None (обычный путь
  обработает само);
- `awaiting_surname` → cancel-слова: ack и clear БЕЗ сжигания
  попытки; иначе ввод — кандидат-фамилия: `VacationService.find`:
  found → save_surname + ответ С3, clear; ambiguous → список
  «ФИО (отдел)», attempts+1; not_found → подсказки, attempts+1;
  attempts ≥ 2 → вежливый выход, clear;
- без стейта: classify: schedule → (фамилия есть → С3; нет → вопрос
  фамилии, state=awaiting_surname); vacation → предложение «Хотите
  узнать свои даты по графику отпусков?», state=awaiting_yes,
  origin_content=content; yes/no/cancel/None → None.

Ответ С3 (`_compose_answer`): периоды из стора+сервиса →
`app/vacations/prompts.py::build_vacation_messages(person_lines)`
(system: отвечай ТОЛЬКО по этим строкам, не выдумывай даты,
обращайся по ФИО из данных; user: строки периодов) →
`provider.complete()`; `BotProviderError`/таймаут → шаблон:
строки format_periods через «\n» (D-10).

### 3. Хук в BotService (REQ-FLOW, шов по F-2)

`backend/app/services/bot.py`, `_execute` — вставка НЕПОСРЕДСТВЕННО
перед вызовом rag_search (~строка 229; не просто «выше порога 244»):

```
outcome = VacationSkill(self.session, self.provider).handle(
    content=source_content, user_id=message.user_id)
if outcome and outcome.reply:      # постим reply существующим путём, ран succeeded
elif outcome and outcome.passthrough_question:  # обычный путь с ИСХОДНЫМ вопросом
else:                              # обычный путь как есть
```

Провайдер — УЖЕ инжектированный атрибут сервиса (`self.provider`;
резолвится один раз на эндпоинте, api/v1/endpoints/bot.py:106 →
services/bot.py:69 — app.state внутри сервиса НЕ трогаем), сессия —
`self.session` сервиса (фабрики нет), user_id — автор source-сообщения
`message.user_id` (приватность D-2), НЕ переменная requester. Скилл
строится лениво на каждый ран (дёшево: обёртка над session+provider).
Durable-ран/CAS/broadcast/`MessageService.create` (~261) — без
изменений; is_ai уже проверен выше по коду.

### 4. Приватность (REQ-PRIVACY)

В `handle` НЕТ ветки поиска по фамилии из свежего сообщения: lookup
только из `VacationName` юзера или ответа на awaiting_surname.
Сообщение с schedule/vacation-интентом — всегда свой-даты маршрут.
Тест-пин: «Когда отпуск у Иванова?» → предложение своих дат,
чужих запросов к vacation_periods нет (счётчик запросов сессии).

### 5. Тесты WS-BE-FLOW

- `backend/tests/unit/vacations/test_intent.py` — AC-INTENT.
- `backend/tests/integration/bot/test_vacation_skill_flow.py` —
  AC-FLOW сценарии 1–7 (1b «да» с фамилией → сразу ответ; cancel
  без сжигания попытки; повторный отпускной вопрос → повторное
  предложение; 7 — устаревшая фамилия после реингеста: удаление,
  сообщение, переспрос); AC-LLMFMT (промпт без RAG-чанков; фейк с
  BotProviderError → шаблон); AC-PRIVACY. FakeBotProvider из
  прецедента `tests/integration/bot/test_bot_api.py`, sqlite,
  ингестнутая синтетика: Сибгатуллин И.Р. 3 периода + Гончаров×2 +
  Романов/Романова.
- Прогресс-лог: запись прогона сверху в
  `docs/progress/progress_log.md`.

### 6. Живой гейт (REQ-LIVE, ОТЛОЖЕН)

AC-LIVE не исполняется воркером: чеклист оператора — поднять
compose+Ollama, прогнать диалоги а–ж (а–е — флоу бота; ж — обновление
графика по ранбуку: новая сводка и ответы без рестарта кода),
evidence EV-4 в `work/2026-11-08-vacation-skill/evidence/live/`.
Финальный аудит BLOCKED до EV-4; PR мержится после (D-3).

## Гейты и evidence

- EV-1: бэкенд-гейт D-11 волны WS-BE-DATA до/после (полный вывод).
- EV-2: ингест CLI на реальном графике (стейджинг в backend/data/ —
  шаг launchGate) в scratch-sqlite + контрольный вывод
  vacation_query.py (сходство сводок) + walkthrough ранбука.
- EV-3: бэкенд-гейт D-11 волны WS-BE-FLOW до/после + ownership-аудит.
- EV-4: живой смоук AC-LIVE (отложен, блокирует финальный аудит и
  мерж PR — D-3).
- Conventional-коммиты без co-author (D-12); пакет плана коммитится,
  work/ — нет.
