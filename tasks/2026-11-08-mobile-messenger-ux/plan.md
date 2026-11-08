# Plan — 2026-11-08-mobile-messenger-ux

S2, два воркстрима (BE → FE), ветка `feature/2026-11-08-mobile-messenger-ux`
от origin/dev @ dc65e03fc48470b9c9aabf605d09ac3886610642.

## WS-BE-BOT — маркер бота в форме участника

Файлы: `backend/app/schemas/chat.py`, `backend/app/services/chats.py`,
интеграционные тесты (см. manifest write-set).

1. `ChatMemberBrief.is_bot: bool = False` (schemas/chat.py).
2. `to_member_brief` вычисляет is_bot каноническим идиомом
   services/chats.py:569-571: `email.lower() ==
   bot_settings_from_env().user_email` (конфиг уже нормализован; без
   .lower() email с верхним регистром молча даёт False), lazy import;
   поле попадает и в GET /chats/{id}/members, и в members
   GET /chats автоматически (общий билдер).
3. Пины: бот-строка is_bot=True + человек False (members-эндпоинт и
   бот-кейс test_chat_ai_toggle_api).

Гейт: бэкенд-гейт по D-11 — `PYTHON_BIN=<venv-интерпретатор стенда>
bash backend/verify.sh`, всё зелёное, кроме ровно 4 известных
POSIX-only падений ingestion (полный вывод до/после — в evidence).

## WS-FE-MOBILE — весь фронтенд (после WS-BE-BOT)

### 1. Классификатор свайпов (REQ-SWIPES)

`src/utils/swipe.ts`: константы порогов (расстояние ≥ 50px,
доминантность оси ×1.5) и `resolveSwipe(start, end) → 'left' | 'right' |
'down' | null`. Чистая функция + тесты (границы, доминантность,
короткие жесты).

### 2. Жесты

- **storyViewer.ts**: events touchstart/touchend с корня; конечные точки
  TouchEvent → resolveSwipe → `props.onSwipe?.(direction)`. Шаблон не
  меняется.
- **chat.ts**: колбэк `onSwipeViewer(direction)`: 'left' — markViewed
  текущей + openStory следующей (за последней — close), 'right' —
  openStory предыдущей (перед первой — close), 'down' — closeStory.
  Прокидывается в StoryViewer.
- **messenger.ts**: touchstart/touchend в events; 'right' →
  `onBack?.()` (тот же closeChatFeed, что кнопка) с гвардом модалок:
  жест, начавшийся внутри открытой Modal
  (`closest('[data-testid="modal"]')`), игнорируется — открытое
  меню/диалог никогда не деселектит чат (review F-4).
- **profile.ts** (страница /settings): touchstart/touchend; 'right' →
  при settingsPaneOpen — закрыть секцию (та же ветка, что
  settings-back), иначе Router.back().

Тесты: пины проводки на jsdom (Event + Object.defineProperty
changedTouches), классификатор — чистыми случаями.

### 3. Мобильный layout историй (REQ-STORIES)

chat.scss, ветка <768: `grid-template-columns: minmax(0, 1fr)`;
`.chat__container-users { min-width: 0 }`; stories-списку `width: 100%`
и `max-width: 100%` в этой же ветке. Живой смоук 390px/15+ историй:
нет горизонтального скролла документа. Плюс regex-пин mobile-блока.

### 4. Кебаб-меню шапки (REQ-KEBAB)

- messenger.hbs: кнопка `messenger__header-kebab`
  (data-testid=header-kebab, aria-label) рядом с рядом иконок;
  Modal «Действия» (isOpen=kebabOpen).
- Дескрипторы headerButtons получают подписи (menuLabel); билдер
  контента меню — из visibleHeaderButtons (те же handleClick);
  «Отмена» закрывает. Делегированный клик по
  data-testid=chat-action-*.
- messenger.scss: desktop-first — кебаб `display: none`, в ветке <768
  показан, `&__header-buttons-container` скрыт.

Тесты: кебаб открывает меню, пункты зовут те же колбэки (стабы),
DOM-пин одновременного присутствия ряда и кебаба (видимость — CSS).

### 5. Чип авто-названия (REQ-HINT)

messenger.scss `&__header-title-hint`: убрать `right: 180px`, поставить
`left: 70px`; в мобильной ветке — `left: 95px`. Regex-пины обоих правил.
Живой смоук гляет и десктоп-вид чипа: left:70px не наезжает на аватар
чата/заголовок (review F-7).

### 6. Стрелка пункта настроек (REQ-ARROW)

profile-settings.hbs: класс изображения → `profile-settings-item__arrow`
(старый chat__container-profile-arrow из шаблона убрать).
profile-settings-item.scss: `margin-left: auto; align-self: center` +
hover-opacity. DOM-пин класса.

### 7. Подложка карандаша (REQ-PENCIL)

chat.scss `_type_change-profile`: background-image (radial-gradient +
pencil) перенести в `&:hover` (вся подложка целиком). Regex-пин:
правило с background-image вложено в hover-скуп.

### 8. Плашка автора + AI-плашка (REQ-AUTHOR, REQ-AIBADGE)

- types.ts: `ChatUser.is_bot?: boolean`; own.ts getChatUsers мапит
  `is_bot: member.is_bot === true`.
- messenger.ts withStore-мэппер: подготовить по chatUsers автора
  (login/email/avatar) и id бота (is_bot); mapTypedMessages расширить:
  трекер хранит user_id предыдущего ЧУЖОГО несистемного сообщения
  (свои/системные/pending трекер не обновляют — свои сообщения серию
  автора не рвут, review F-1); `authorBadge` на чужом сообщении, чей
  user_id отличается от трекнутого (или трекер пуст), `isBot` для
  user_id === botId. Гейт «группа» — chatUsers.length > 2.
- message.ts/hbs: над пузырём строка-мета: плашка автора
  (img-аватар высотой с текст + логин, title=email) и/или чип
  `✦ AI`. Стили — в messenger.scss (файла message.scss нет,
  review F-2; AI-чип — визуальное семейство
  chat-list-user__ai-badge, свой messenger-класс).
- Тесты: смена автора/повторы/свои/системные/pending, 1-1 без плашки
  автора, AI-чип у бота и не у человека, email в title, mapper-пины.

### 9. Процесс (REQ-PROCESS)

verify (mocha 756 → grown, 0 удалённых), бэкенд-гейт по D-11, guard
strict, stylelint, ownership, progress_log сверху, decisions.md,
конвенциональные коммиты без co-author.

## Evidence

- EV-1: вывод npm run verify (фронт) —
  work/2026-11-08-mobile-messenger-ux/evidence/WS-FE-MOBILE/.
- EV-2: полный вывод бэкенд-гейта (канонический вызов D-11) —
  work/2026-11-08-mobile-messenger-ux/evidence/WS-BE-BOT/.
- EV-3: guard strict + ownership + живой смоук (390px с 15+ историями
  и десктоп-вид чипа авто-названия) + progress-log diff — evidence/
  root.
