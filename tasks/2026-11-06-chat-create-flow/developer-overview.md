# Developer overview — 2026-11-06-chat-create-flow

## Зачем это здесь

Оператор переделывает путь создания чата. Сегодня: карточка-форма `ChatListCreate` в списке (title + чекбокс AI + плитка «Чат с AI») — лишний шаг и мёртвый UI. Новый путь: одно нажатие «Создать чат» → чат существует, карточка в списке активна, мессенджер справа готов к работе. Дальше пользователь на месте: инпут названия (авто «Чат с»), «+»/«добавить» для участников (сервер дописывает их имена в авто-название), «+AI» для бота в текущем чате. Персистентный `chats.auto_titled` — фундамент будущего LLM-нейминга (переименовать чат, если название до сих пор автоматическое).

## Что видит пользователь

1. Клик «Создать чат» (шапка списка) → карточка «Чат с» вверху списка, активна; справа мессенджер: аватар, инпут названия со значением «Чат с», кнопки +/корзина/+AI, пустая лента с подсказкой «Добавьте пользователей…» и кнопкой «добавить», композер.
2. «добавить» или «+» → модалка поиска → клик по пользователю → он в чате, подсказка гаснет, в шапке его аватар; название стало «Чат с Вася» (у всех участников).
3. Ещё участник → «Чат с Вася, Маша». Пользователь вписал в инпут «Проект X» → название фиксируется, добавления его больше не меняют.
4. «+AI» → бот включён в этот чат, кнопка подсвечена; сообщения в чате теперь получают ответы бота (существующая is_ai-механика).

## Архитектурные границы

- Слои как всегда: `pages → components → controllers → api → utils → core`; компоненты не импортируют фичи; `AppState` не редактируется; контакты/ai-assistant не трогаются.
- Единственный новый WS-контракт: `chat_ai_toggled {chat_id, is_ai}`. Авто-дописывание названия переиспользует существующий `chat_renamed` — фронт-обработчик уже существует.
- `ChatsPort.createChat` меняет возврат `void → {chatId}` — это контракт внутри chats-фичи; порт ai-assistant независим и не меняется.
- Бэкенд: одна additive-миграция 013 (chats.auto_titled); ChatUpdate расширяется optional-полями с валидатором «хотя бы одно»; авто-тайтл живёт в сервисе `add_member` транзакционно; `services/bot.py` не меняется (существующий `chat.is_ai`-гейт).

## Точки входа для чтения перед работой

- Бэкенд: `backend/app/services/chats.py` (create/create_dm/rename/add_member), `backend/app/api/v1/endpoints/chats.py` (PUT-прецедент и broadcast-узор), `backend/app/schemas/chat.py`, `backend/alembic/versions/012_message_kind.py` (последняя миграция), `backend/app/ws/hub.py` (broadcast).
- Фронт: `src/features/chats/pages/chat/chat.ts` (страница: onClick/inputs/buttons, CDU-гварды), `src/components/messenger/messenger.ts` (шапка, renamingTitle/commitTitleInput, headerButtons, модалки), `src/components/chatListCreate/*` (удаляемое), `src/features/chats/controller.ts` (create/fetchChats/selectChat/renameChat-паттерн), `src/features/chats/api/own.ts` (toChatInfo, createChat), `src/features/chats/ws/own.ts` (chat_renamed-прецедент), `src/components/headerIcons/headerIcons.ts` (кнопка уже есть — не меняется).

## Модель исполнения

Две последовательные волны (maxParallel 1): WS-BE-API (backend) → WS-FE-CHAT (frontend+docs). Каждая — task-start/task-result/task-review/implementation-audit по конвенциям репозитория (tasks/README.md, AGENTS.md). Evidence: `npm run verify` (696 mocha база), `bash backend/verify.sh` с PYTHON_BIN (277+4 known база — уточнить по факту прогона), guard strict.

## Риски и подводные камни

- `rename`-сервис обобщается до update: сохранить идемпотентный no-op при равном title (без второго системного сообщения) и НЕ гасить auto_titled на no-op.
- Фронт: инпут авто-названия должен переживать перерисовки (механика focusTitleInput уже существует); коммит пустого значения — тихий откат, не PUT.
- Пустое состояние гейтится ЧЕТЫРЬМЯ условиями (нет сообщений, нет соучастников-кроме-меня, не архив, не AI) — пин всех веток.
- `createAndSelect` обязан дождаться fetchChats ДО selectChat, иначе карточки ещё нет в слайсе (мессенджер рендерится по chatInfo из стора).
- Мобильная панель: программный selectChat из createAndSelect — открыть chatPaneOpen через CDU-гвард, не ломая существующее схлопывание.

## Не-цели

LLM-нейминг (future-step), выключение бота из UI, системное сообщение о боте, автоудаление пустых чатов, DM-контракт контактов, бот-механика/RAG, ai-assistant-фича.
