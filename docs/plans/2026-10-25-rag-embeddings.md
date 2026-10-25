# План: RAG-эмбеддинги — живой инференс и закрытие пробела AI-ассистента

Дата: 2026-10-25. Статус: план-документ (исполнение заблокировано — у
оператора сейчас нет доступа к инференс-серверу). Приоритет 1 из
`docs/NEXT.md`. Когда доступ появится — исполнить этот runbook; если
потребуются кодовые изменения, оформить их как ALK-пакет (ссылка на план —
входной материал для `agent-first-planning`).

## 1. Проблема

AI-ассистент (этапы 8–10: ingestion, бот, UI) реализован в коде сквозно,
но в живом compose-стеке не работает: некому отвечать на запросы эмбеддингов
и LLM-чата. Все отказы явные (by design, «never a silent PASS»):

| Операция | Симптом без инференса | Где смотреть |
|---|---|---|
| Ingest документа | `documents.status='failed'`, `error_kind='embedding_provider_failed'` | `DocumentService.ingest` → `_fail` |
| Поиск по документам | HTTP 503 `embedding_provider_unavailable` | `DocumentService.search` |
| Вопрос боту | `bot_runs.status='failed'` (`provider` error_kind) | `app/services/bot.py` |

Формулировка NEXT: «на OpenAI-совместимом инференс-сервере поднять
`/v1/embeddings` и закрыть пробел AI-ассистента».

## 2. Что уже готово (переиспользуем, не переписываем)

Кодовая часть контура **закрыта** — изменений не требуется, пробел
операторский (поднять сервер + принять работу):

- `backend/app/ingestion/embeddings.py` — протокол `EmbeddingProvider` и
  два клиента: `OllamaEmbeddingProvider` (нативный `/api/embed`) и
  `OpenAIEmbeddingProvider` (`/v1/embeddings`, OpenAI-совместимый);
  строгая валидация пейлоада (`EmbeddingError` на всё), `cosine_similarity`.
- `backend/app/ingestion/config.py` — `RagSettings` из env:
  `CHATTY_RAG_EMBEDDING_API` (`ollama`|`openai`, default `ollama`),
  `CHATTY_RAG_EMBEDDING_URL` (default `http://127.0.0.1:11434`),
  `CHATTY_RAG_EMBEDDING_MODEL` (default `nomic-embed-text`), конвертер,
  `CHATTY_RAG_TOP_K_MAX` (default 20).
- `backend/app/services/documents.py` — ingestion
  (`processing` → `ready`/`failed`, machine-readable `error_kind`) и
  chat-scoped top-k retrieval (косинус, детерминированный порядок, cap).
- `backend/app/ingestion/chunking.py` — чанки ~800 символов, overlap 120.
- `backend/app/models/doc_chunk.py` — `embedding` как JSON (pgvector —
  осознанный carry-forward, см. §7).
- `backend/app/api/v1/endpoints/documents.py` — `POST
  /documents/{file_id}/ingest`, `POST /chats/{chat_id}/documents/search`.
- `backend/app/bot/` — LLM-провайдер за тем же швом (`ollama`|`openai`),
  `CHATTY_BOT_*` (URL, модель `qwen3:14b`, timeout 60 с, attempts 2),
  RAG-контекст `CHATTY_BOT_RAG_TOP_K=3`; бот-аккаунт резолвится по
  `CHATTY_BOT_USER_EMAIL` (`users.get_by_email`, `app/services/bot.py:79`).
- `docker-compose.yml:20-38` — все ручки пробрасываются в api-контейнер;
  дефолты mode-neutral (нативный Ollama на хосте).
- `backend/.env.example` + `docs/deployment/own-backend.md` — режимы уже
  документированы (включая `host.docker.internal` и 501-политику).
- `src/features/ai-assistant/` — фронт целиком (порты, own-адаптер,
  страница ассистента, карточки документов).
- Тесты: `backend/tests/unit/ingestion/`, `backend/tests/unit/bot/`,
  `backend/tests/integration/rag/` — провайдер стабится, сеть не нужна.

Поддерживаемые форматы ingestion (`backend/app/ingestion/parsers.py`):
`.docx`, `.pdf` (только с текст-слоем, non-OCR by design), `.xlsx`, `.doc`
(требует `soffice`-конвертер — в контейнере его нет, для приёмки
использовать `.docx`).

## 3. Цели и не-цели

Цели:
1. Живой endpoint эмбеддингов (`/v1/embeddings` или нативный `/api/embed`),
  видимый из api-контейнера.
2. Сквозная работа AI-ассистента на живом стеке: документ → чанки с
  векторами → поиск → ответ бота с RAG-контекстом.
3. Зафиксированный операторский чек-лист приёмки (этот документ, §6).

Не-цели (carry-forward, §8): pgvector, асинхронный ingestion, кэш
эмбеддингов, изменения UI, новый протокол.

## 4. Решения оператора (выбрать вариант до старта)

Все три варианта дают рабочую схему; отличаются только значением env-ручек.

| | A. Ollama, нативный протокол | B. Ollama как OpenAI-совместимый | C. Сторонний OpenAI-сервер |
|---|---|---|---|
| `CHATTY_RAG_EMBEDDING_API` | `ollama` (дефолт) | `openai` | `openai` |
| Endpoint | `/api/embed` | `/v1/embeddings` | `/v1/embeddings` |
| `CHATTY_RAG_EMBEDDING_MODEL` | `nomic-embed-text` | `nomic-embed-text` | по серверу (напр. `bge-m3`, `mxbai-embed-large`) |
| LLM-чат бота | тот же Ollama (`qwen3:14b`) | тот же | тот же или отдельный (`CHATTY_BOT_PROVIDER_URL`) |
| Когда выбирать | минимум движений, всё дефолт | формальный `/v1/embeddings` из NEXT той же установкой | Ollama недоступен/запрещён |

Требования к ресурсам:
- Эмбеддинги `nomic-embed-text`: ~274 МБ, работает на CPU.
- Чат `qwen3:14b`: ~9 ГБ (q4); желательно GPU ≥12 ГБ VRAM. На CPU ответ
  может не уложиться в `CHATTY_BOT_TIMEOUT_SECONDS=60` — ручка есть
  (поднять или выбрать меньшую модель, напр. `qwen3:8b`).

**Критичное решение — модель эмбеддингов фиксируется до первой загрузки
документов:** векторы разных моделей несравнимы, смена модели после
ingestion требует реингеста всех документов (или очистки `doc_chunks`),
иначе поиск молча деградирует. Размерность `nomic-embed-text` — 768.

## 5. Runbook (исполнять, когда появится доступ)

### Шаг 0. Пререквизиты

- Доступ к хосту, где будет инференс (тот же хост, что и compose-стек —
  проще всего; инференс — внешняя зависимость хоста, в compose не входит).
- ~10–12 ГБ диска под модели, GPU желателен для чат-модели.
- Операторский env-файл стека и runbook `docs/deployment/own-backend.md`.

### Шаг 1. Поднять инференс

Варианты A/B (Ollama, Windows-хост):

```powershell
winget install Ollama.Ollama          # или установщик с ollama.com
ollama pull nomic-embed-text          # эмбеддинги, ~274 МБ
ollama pull qwen3:14b                 # чат-модель, ~9 ГБ
```

`ollama serve` стартует службой; проверить `curl http://127.0.0.1:11434/api/tags`.

Вариант C (примеры; подставить свою модель GGUF/onnx/hf-id):

```bash
# llama.cpp: сервер с эмбеддингами
llama-server -m nomic-embed-text-v1.5.Q8_0.gguf --embedding --pooling mean \
  --host 127.0.0.1 --port 8080
# LM Studio: Developer → Start Server + загрузить embed-модель (порт 1234)
# vLLM: vllm serve BAAI/bge-m3 --task embed
```

### Шаг 2. Smoke на хосте (до трогания стека)

Нативный протокол (A):

```bash
curl -s http://127.0.0.1:11434/api/embed \
  -d '{"model":"nomic-embed-text","input":["ping"]}'
# ожидание: {"embeddings":[[…768 чисел…]]}
```

OpenAI-совместимый (B; C — свой host:port):

```bash
curl -s http://127.0.0.1:11434/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"model":"nomic-embed-text","input":["ping"]}'
# ожидание: {"data":[{"embedding":[…768 чисел…], …}], …}
```

- HTTP 501 — сервер без эмбеддингов (501-политика, `own-backend.md`);
  HTTP 404 на `/v1/embeddings` у Ollama — обновить Ollama или взять
  вариант A.
- Чат-модель: `curl -s http://127.0.0.1:11434/api/chat -d
  '{"model":"qwen3:14b","messages":[{"role":"user","content":"ping"}]}'`.

### Шаг 3. Операторский env-файл

Сеть: изнутри api-контейнера `127.0.0.1` — это сам контейнер. На Docker
Desktop хост виден как `host.docker.internal`. (На Linux-хосте добавить в
compose `extra_hosts: ["host.docker.internal:host-gateway"]` — сейчас
compose этого не имеет; заметка на случай переноса.)

Вариант A (минимум — переопределяем только URL):

```env
CHATTY_RAG_EMBEDDING_URL=http://host.docker.internal:11434
CHATTY_BOT_PROVIDER_URL=http://host.docker.internal:11434
# CHATTY_RAG_EMBEDDING_API, CHATTY_RAG_EMBEDDING_MODEL, CHATTY_BOT_* — дефолты
```

Вариант B (те же URL + переключение протокола эмбеддингов):

```env
CHATTY_RAG_EMBEDDING_API=openai
CHATTY_RAG_EMBEDDING_URL=http://host.docker.internal:11434
CHATTY_RAG_EMBEDDING_MODEL=nomic-embed-text
CHATTY_BOT_PROVIDER_URL=http://host.docker.internal:11434
```

Вариант C (например, llama.cpp на 8080 + Ollama для чата):

```env
CHATTY_RAG_EMBEDDING_API=openai
CHATTY_RAG_EMBEDDING_URL=http://host.docker.internal:8080
CHATTY_RAG_EMBEDDING_MODEL=nomic-embed-text-v1.5
CHATTY_BOT_PROVIDER_URL=http://host.docker.internal:11434
```

### Шаг 4. Preflight и подъём стека

```bash
docker compose --env-file <operator-env> config --quiet   # preflight
docker compose --env-file <operator-env> up -d --build api
# health/ready — по каноническому runbook docs/deployment/own-backend.md
```

### Шаг 5. Smoke изнутри контейнера

```bash
docker compose --env-file <operator-env> exec api python -c "
import json, os, urllib.request
url = os.environ['CHATTY_RAG_EMBEDDING_URL']
api = os.environ.get('CHATTY_RAG_EMBEDDING_API', 'ollama')
path = '/v1/embeddings' if api == 'openai' else '/api/embed'
req = urllib.request.Request(url + path,
    data=json.dumps({'model': os.environ['CHATTY_RAG_EMBEDDING_MODEL'],
                     'input': ['ping']}).encode(),
    headers={'Content-Type': 'application/json'})
body = json.load(urllib.request.urlopen(req, timeout=10))
vec = (body['data'][0]['embedding'] if api == 'openai' else body['embeddings'][0])
print('OK dim=', len(vec))
"
# ожидание: OK dim= 768
```

### Шаг 6. Бот-аккаунт

Бот-раны требуют аккаунт с email `CHATTY_BOT_USER_EMAIL`
(default `bot@chatty.local`), зарегистрированный через публичный auth API
(register, затем логин не нужен — бэкенд ищет пользователя по email;
`app/services/bot.py:79`). Без него раны падают с `bot_user_not_configured`.

### Шаг 7. Сквозная приёмка через UI/HTTP

1. Админ (`admin@chatty.local` из сида) загружает в AI-чат документ
   `.docx` (не `.doc` — конвертера нет; не «картинка-скан» PDF — нет OCR).
2. `POST /api/v1/documents/{file_id}/ingest` → статус `ready`,
   `error_kind=null`; в БД `doc_chunks` заполнены, `embedding` не пуст.
3. `POST /api/v1/chats/{chat_id}/documents/search` с фразой из документа →
   top-чанки со score > 0; релевантный фрагмент в top-3.
4. `POST /api/v1/chats/{chat_id}/bot/runs` с вопросом по документу →
   `bot_runs.status='succeeded'`, ответ опирается на содержание.
5. Фронт: страница ассистента (`/assistant`) — те же операции из UI.

### Шаг 8. Разбор падений

| Симптом | Причина | Куда смотреть |
|---|---|---|
| ingest `failed/embedding_provider_failed` | URL недостижим/501/кривой пейлоад | шаг 5 smoke, `docker compose logs api` |
| search 503 `embedding_provider_unavailable` | то же в рантайме поиска | шаг 5 |
| бот `failed`, provider kind | чат-модель не поднята/timeout | шаг 2 чат-smoke, `CHATTY_BOT_TIMEOUT_SECONDS` |
| ingest `failed/no_text` | PDF без текст-слоя | взять `.docx` |
| ingest `failed/converter_failed` | `.doc` без `soffice` в контейнере | осознанно, брать `.docx` |
| из контейнера connection refused | URL указывает на 127.0.0.1 или файрвол хоста | шаг 3 сеть |

## 6. Критерии приёмки (чек-лист)

- [ ] Шаг 2 smoke: оба curl-запроса дают вектор длины 768 (nomic-embed-text).
- [ ] Шаг 5 smoke изнутри контейнера: `OK dim= 768`.
- [ ] Ingest `.docx` → `status=ready`, `doc_chunks ≥ 1`, `embedding` не пуст.
- [ ] Поиск по фразе из документа: top-1 чанк содержит фразу, score > 0.3
  (ориентир, не жёсткий порог).
- [ ] Бот: run `succeeded`, ответ по существу документа.
- [ ] Идемпотентность: повторный ingest того же файла заменяет чанки
  (`replace_chunks`), дублей нет.
- [ ] Изоляция: search в чужом чате → 403 (membership-check).
- [ ] Negative-path: остановить инференс → search 503 и ingest
  `failed/embedding_provider_failed` (явные отказы, не молчание).

Код не меняется → гейты `npm run verify` / `verify:backend` не требуются;
любая кодовая правка, возникшая по ходу (например, `extra_hosts` для
Linux-хоста), идёт отдельной веткой через гейты как обычно.

## 7. Риски и осознанные ограничения

- **Смена модели эмбеддингов = реингест** (см. §4) — самое частое
  приглашение к тихой деградации поиска.
- Косинус считается на Python по всем `ready`-чанкам чата
  (`DocumentService.search`): приемлемо для учебных объёмов, не масштаб —
  pgvector-харденинг в backlog.
- Батч эмбеддингов — все чанки документа одним запросом: очень большой
  документ = большой батч (chunking ~800 символов смягчает; лимитов
  на количество чанков в `ingest` нет).
- `qwen3:14b` на CPU — риск таймаута бота (ручка timeout/attempts есть).
- Инференс — внешняя зависимость хоста: compose её не оркестрирует и не
  мониторит (кроме явных отказов на стороне api).

## 8. Carry-forward backlog (вне этого плана)

1. pgvector: тип `vector` + ANN-индекс вместо JSON+Python-косинуса
   (миграция + пересчёт не нужен — векторы переносятся as-is).
2. Асинхронный ingestion (сейчас синхронно в HTTP-запросе; длинные
   документы держат соединение).
3. Кэш эмбеддингов поисковых запросов.
4. Отложенный реингест `failed`-документов (сейчас — ручной повтор ingest).
5. CLI/эндпоинт для массового реингеста при смене модели.

## 9. Ссылки

- Канонический runbook стека: `docs/deployment/own-backend.md`.
- Архитектура: `docs/arch/` (README, data-layer).
- История этапов 8–10: `docs/progress/progress_log.md`.
