# Acceptance criteria — 2026-11-06-chat-create-flow

## AC-BE-AUTO-TITLE — миграция и контракт auto_titled (pytest)

alembic heads == 013_chat_auto_title; миграция additive (chats.auto_titled Boolean NOT NULL server_default '0', downgrade-safe); сегмент-тест 013 roundtrip зелёный; сегменты 009–012 зелёные (repin только при падении изоляции). ChatCreate.auto_titled/ChatResponse.auto_titled: POST /chats с auto_titled=true сохраняет флаг и возвращает его в 201-ответе; существующие чаты (премиграционные) читаются как auto_titled=false; GET /chats несёт поле.

## AC-BE-MEMBERS-APPEND — автодополнение названия при добавлении участника (pytest)

POST /chats/{id}/members в чате с auto_titled=true (не is_dm), ветка свежей вставки: title 'Чат с' становится 'Чат с <имя>' (display_name добавленного, фолбэк — локальная часть email); добавление другого участника — '<title>, <имя2>'; повторное добавление уже существующего (активного или реактивируемого архивного) участника title НЕ меняет (early-return, review F-4); добавление в NOT-auto_titled-чат не меняет title; is_dm-чат не меняет title; title, который с добавлением превысил бы 200, остаётся как был (добавление при этом успешно, 201); активным участникам ушёл WS chat_renamed {chat_id, title} (переиспользованный ивент; fan-out в эндпоинте, ни один сервис не импортирует app.ws.hub — grep-пин, review F-5).

## AC-BE-PUT-EXT — расширенный PUT /chats/{id} (pytest)

PUT {title} — прежняя семантика (rename + системное сообщение + chat_renamed) И auto_titled := false; PUT {title: равный текущему} — идемпотентный no-op 200 без системного сообщения и БЕЗ гашения auto_titled; PUT {is_ai: true} в обычном чате — is_ai=true в ответе, WS chat_ai_toggled {chat_id, is_ai: true} активным участникам, системных сообщений нет; повторный PUT {is_ai: true} при уже true — 200 без повторного broadcast; PUT {} → 422; архивный участник 403; не-участник 403; аноним 401; пустой/пробельный title 422.

## AC-FE-CREATE-FLOW — one-click создание и автоселект (mocha)

Кнопка «Создать чат» шапки списка вызывает контроллер createAndSelect: POST /chats {title: 'Чат с', auto_titled: true} (+csrf) → {chatId} → fetchChats → selectChat(chatId) + getChatUsers(chatId) (порядок закреплён: select после fetch). Компонент ChatListCreate не существует (файлы удалены, страница не монтирует карточку-форму, inputs/buttons из chat.ts ушли). Карточка нового чата поднимается вверх списка существующим created_at-fallback. Мобильная панель: программная смена selectedChat открывает chatPaneOpen (гвард CDU), сброс selectedChat по-прежнему схлопывает.

## AC-FE-TITLE-INPUT — инпут авто-названия (mocha)

Чат с auto_titled=true: заголовок шапки — инпут со значением title сразу при входе (без dblclick); Enter, Escape и focusout коммитят: непустое ≠ текущему → onRenameChat(chatId, value); пустое/равное — тихий откат без вызова. Оптимистичный патч renameChat гасит auto_titled вместе с title (заголовок статичен сразу после ручного коммита; откат по ошибке возвращает оба поля — review F-3). Чат с auto_titled=false — статичный h2 (dblclick-режим как сегодня). Архивный чат — никогда инпута.

## AC-FE-EMPTY-HINT — подсказка пустого чата (mocha)

Блок подсказки с текстом «Добавьте пользователей с помощью кнопки + в верхнем меню, либо нажмите "добавить"» и кнопкой «добавить» (data-testid=empty-chat-add) рендерится ТОЛЬКО при: сообщений нет И соучастников кроме меня нет И чат не архивный И не is_ai; selectChat сбрасывает устаревший chatUsers-слайс до ответа getChatUsers (пин — review F-7); клик по «добавить» открывает модалку добавления (addUserOpen); появление сообщения или соучастника убирает блок. Каждая из четырёх веток гейта запинена отдельным кейсом.

## AC-FE-AI-BUTTON — кнопка «+AI» (mocha)

Кнопка рендерится в шапке каждого не-архивного чата; в архивном скрыта (вместе с cross); в is_ai-чате — активный модификатор без обработчика; клик в обычном чате → onEnableAi(chatId) → контроллер: port.enableAi (PUT /chats/{id} {is_ai: true} + csrf) → оптимистичный патч is_ai=true в chats-слайсе, откат при ошибке порта. WS chat_ai_toggled патчит is_ai в слайсе (путь gateway → контроллер закреплён).

## AC-PROCESS — гейты и буккипинг

npm run verify и backend verify.sh зелёны с ростом счётчиков от базы (mocha 696; pytest 291 + 4 known ingestion как deviations с логом); guard-architecture --all --strict — 0 нарушений; docs/progress/progress_log.md — запись сверху; docs/NEXT.md — фича-запись + future-step LLM-нейминга (auto_titled) + пометка, что backlog «тематические чаты» покрывается новым флоу; ни один файл вне write-set'ов манифеста не меняется; прогон живёт на feature/2026-11-06-chat-create-flow от dev @ efdc8c3.
