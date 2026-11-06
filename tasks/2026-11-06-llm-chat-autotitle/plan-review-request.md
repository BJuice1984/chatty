# Plan review request — 2026-11-06-llm-chat-autotitle

## Что ревьюится

S2-пакет `tasks/2026-11-06-llm-chat-autotitle`: one-shot LLM-автоназвание
чатов. Tier resolve: S2 (multiple executable owners; подтверждено CLI —
`tier-resolution.json`, digest `5fb06649…`).

Просьба проверить против кодовой базы (база — `dev` @ `cf8c35d`):

1. **Требования/AC/евиденции** (`specification.json`, `acceptance-criteria.md`):
   каждое AC имеет ровно один workstream-владелеца evidence; таблица AC
   соответствует манифесту построчно; пороги и ручки согласованы между
   specification/plan/манифестом.
2. **Write-сеты и изоляция** (`plan.manifest.json`): нет пересечений между
   WS-BE-AUTOTITLE и WS-FE-AUTOTITLE; forbiddenWrites не конфликтуют с
   чужими write-сетами; в `src/` пишет только FE-воркстрим, в `backend/` —
   только BE.
3. **Архитектурные швы**: сервис не импортирует `app.ws.hub` (grep-пин
   review F-5 в `test_chat_ai_toggle_api.py`); провайдер переиспользуется
   (нет второго стека); `getattr`-фолбэк `complete_short` → `complete` не
   ломает scripted-фейки; триггеры покрывают ОБА прод-пути отправки (WS
   композера и HTTP POST `/chats/{id}/messages` — askBot ассистента) через
   общий планировщик `app/ws/autotitle.py` (WS-слой владеет мостом, пин
   F-5 не нарушен).
4. **Корректность механики одноразовости и гонок**: CAS
   `WHERE auto_titled=true` + rowcount против ручного rename (013 уже гасит
   флаг в той же транзакции) и против 013-append (узкая гонка «append поверх
   свежего LLM-титула» принята как задокументированная деградация —
   constraints манифеста); гашение `auto_titled` в WS-событии на фронте
   покрывает identical-title случай.
5. **Небюджетные обещания**: миграций нет (head остаётся 013); модель
   исполнения (2 workstream, последовательно); риски закрыты (kill-switch,
   in-flight гвард, хвостовой MAX_CHAT_MESSAGES, fire-and-forget латентность).
6. **Полнота для исполнителя**: plannedItems достаточны для детерминированной
   реализации без дооткрытия архитектуры; контекстные ссылки
   (contextRefs/readOnly) содержат всё нужное.

Вернуть вердикт `READY_TO_FREEZE` / `NEEDS_REFINEMENT` / `BLOCKED` с
находками `F-N` (severity major/minor/info, what + disposition).
