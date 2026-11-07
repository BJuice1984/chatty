# Acceptance criteria — 2026-11-08-mobile-messenger-ux

## AC-STORIES — мобильный layout при длинном ряде историй (scss + смоук)

Ветка <768 chat.scss зажимает grid-трек (`minmax(0, 1fr)`), сайдбар и
stories-список не растут шире контейнера (min-width: 0 / width-max
100%); regex-пины mobile-блока; живой смоук на 390px с 15+ историями —
горизонтального скролла документа нет, ряд скроллится внутри себя,
правая панель на месте. stylelint зелёный.

## AC-SWIPES — три жеста (mocha)

Классификатор resolveSwipe: порог 50px, доминантность оси ×1.5 —
чистые юнит-пины (границы, недоминантные и короткие жесты → null).
Вьюер: onSwipe('left') — следующая история (текущая markViewed), за
последней — close; 'right' — предыдущая, перед первой — close;
'down' — close с маркировкой. Панель чата: 'right' → onBack (стаб); жест, начавшийся внутри
открытой модалки `[data-testid="modal"]`, панель НЕ деселектит
(негативный пин, review F-4).
Настройки: 'right' при открытой секции закрывает её, на корне —
Router.back (стаб). Пины проводки через Event + changedTouches
(Object.defineProperty). Мышь/клик-пути не затронуты (существующие
тесты зелёные).

## AC-KEBAB — меню «⋮» мобильной шапки (mocha)

Кнопка header-kebab в DOM всегда, видимость — CSS (<768). Клик
открывает Modal со пунктами «Включить/Выключить AI» (по is_ai),
«Добавить пользователей», «Удалить чат», «Отмена»; каждый пункт зовёт
тот же handleClick, что иконка шапки (стабы); «Отмена» и выбор пункта
закрывают меню. Десктопный ряд кнопок остаётся в DOM (CSS-only
скрытие). Существующие сценарии шапки (archived-фильтр cross, +AI)
зелёные.

## AC-HINT — чип авто-названия (scss-пин)

Правило messenger__header-title-hint не содержит right, позиционируется
left: 70px; мобильная ветка — left: 95px (regex-пины); живой смоук
подтверждает десктоп-вид чипа без коллизии с аватаром/заголовком;
stylelint зелёный.

## AC-ARROW — стрелка пункта настроек (mocha/stylelint)

Изображение стрелки в profile-settings-item несёт класс
profile-settings-item__arrow (chat__container-profile-arrow из шаблона
убран), scss прижимает её к правому краю (margin-left: auto); DOM-пин
класса.

## AC-PENCIL — подложка карандаша только на ховере (scss-пин)

В блоке _type_change-profile правила background-image (radial-gradient
+ pencil) вложены в hover-состояние, в базовом состоянии подложки нет
(regex-пин); hover-затухание аватарки не тронуто; stylelint зелёный.

## AC-AUTHOR — плашка автора в групповых (mocha)

Гейт: chatUsers.length > 2. Плашка (аватар + логин, title=email) —
над пузырём первого чужого сообщения серии; подряд идущие того же
автора (в т.ч. через свои сообщения) — без плашки; свои сообщения,
системные строки, pending-плейсхолдер — без плашки; в 1-1 (2 участника)
плашек нет; автор отсутствует в chatUsers — без плашки. mapper-пины
(mapTypedMessages) + компонентные пины.

## AC-AIBADGE — AI-плашка ответов бота (mocha)

Сообщение с user_id === id бота (chatUsers is_bot) рендерит чип «✦ AI»
в визуальном семействе chat-list-user__ai-badge; сообщения людей чип
не получают; работает во всех чатах (1-1 и групповые); в групповом
чип соседствует с плашкой автора. own.ts мапит is_bot; компонентные
пины.

## AC-BOTMARK — is_bot в форме участника (pytest)

ChatMemberBrief несёт is_bot; GET /chats/{id}/members: бот-строка
is_bot=True, человек False; краткие составы GET /chats строятся тем же
билдером (поле аддитивно). Бэкенд-гейт по D-11: канонический вызов
`bash backend/verify.sh` (PYTHON_BIN на venv стенда) — всё зелёное,
кроме ровно 4 известных POSIX-only падений ingestion, 0 новых, 0
удалённых тестов; полный вывод до/после в evidence.

## AC-PROCESS — гейты и буккипинг

npm run verify exit 0 (mocha 756 → grown, 0 удалённых); бэкенд-гейт
зелёный по D-11 (канонический bash-вызов; из падений — только ровно 4
известных ingestion-падения); guard --all --strict 0; ownership audit
чист; progress_log запись сверху; decisions.md журнал полон;
конвенциональные коммиты без co-author на
feature/2026-11-08-mobile-messenger-ux от dev @ dc65e03.

## Evidence routes

- EV-1: npm run verify output —
  work/2026-11-08-mobile-messenger-ux/evidence/WS-FE-MOBILE/.
- EV-2: npm run verify:backend output —
  work/2026-11-08-mobile-messenger-ux/evidence/WS-BE-BOT/.
- EV-3: guard strict + ownership audit + живой смоук (390px с 15+
  историями И десктоп-вид чипа авто-названия; заметка и
  скриншот/описание) + progress-log diff — evidence/ root.

## Checklist

| Criterion | Requirements | Evidence | Status |
| --- | --- | --- | --- |
| `AC-STORIES` | `REQ-STORIES` | `EV-1`, `EV-3` | pending |
| `AC-SWIPES` | `REQ-SWIPES` | `EV-1` | pending |
| `AC-KEBAB` | `REQ-KEBAB` | `EV-1` | pending |
| `AC-HINT` | `REQ-HINT` | `EV-1` | pending |
| `AC-ARROW` | `REQ-ARROW` | `EV-1` | pending |
| `AC-PENCIL` | `REQ-PENCIL` | `EV-1` | pending |
| `AC-AUTHOR` | `REQ-AUTHOR` | `EV-1` | pending |
| `AC-AIBADGE` | `REQ-AIBADGE`, `REQ-BOTMARK` | `EV-1`, `EV-2` | pending |
| `AC-BOTMARK` | `REQ-BOTMARK` | `EV-2` | pending |
| `AC-PROCESS` | `REQ-PROCESS` | `EV-3` | pending |
