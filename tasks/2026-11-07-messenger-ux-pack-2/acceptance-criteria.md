# Acceptance criteria — 2026-11-07-messenger-ux-pack-2

## AC-ICON — прежняя иконка mark-all-read (mocha)

headerIcons рендерит '/images/settings-icon.svg' (визуал из main,
решение D-1); onClick/disabled-гейтинг и alt не изменились;
headerIcons.test.ts пинует новый src; mark-all-read-icon.svg не тронут.

## AC-LOADER — лоадер списка чатов (mocha)

Пока идёт первичная загрузка (chatsLoading=true) и список пуст, в
chat__container-users-list рендерится li[data-testid=chats-loading]
role=status с тремя точками; после загрузки (даже пустым результатом)
лоадер исчезает; поисковый режим лоадер не показывает.

## AC-AVATAR — подложка карандаша и тихая строка профиля (mocha/stylelint)

У `_type_change-profile` при hover карандаш стоит на цветной подложке
(элемент подложки запинен классом/структурой), svg-аватар больше не
просвечивает под ним; главная строка профиля не реагирует на hover и не
содержит chat__container-profile-arrow (DOM-пин отсутствия); блок стрелки
удалён из scss.

## AC-FORMS — кнопки форм профиля disabled до готовности (mocha)

Обе submit-кнопки стартуют disabled; ввод валидного изменения включает
Submit changes; возврат к сид-значениям выключает; невалидный телефон
держит disabled; Change password включается только при непустом старом +
валидном новом + совпадающем повторе; mismatch повтор держит disabled.
Пин reset-семантики (review F-4): store-эмит в середине редактирования
пересеивает инпуты И возвращает кнопку в disabled — enabled-кнопка над
пересеянными значениями не остаётся.

## AC-WSDEAD — подсветка мёртвых чатов и плашка (mocha)

Неисчерпанное закрытие: id публикуется в стор-ключ мёртвых, строка
получает chat-list-user_dead (в композиции с _ai/_archived — dead
визуально побеждает), вход в мёртвый чат и смерть сокета открытого чата
добавляют бабл «⚠ Чат недоступен» (isError+isChatUnavailable, user_id
-1) ИДЕМПОТЕНТНО — повторное открытие мёртвого чата не стекует плашки
(review F-6, пин двойного открытия); Connected/забвение удаляют id из
ключа и вычищают плашку; намеренные закрытия
(closeChat/closeAll/chat_deleted/leave/reconnectAll) не красят и не
плашкуют. Пины расширяют describe ws-death (chats.test) и
chatListUser-модификаторы.

## AC-DISCLAIMER — дисклеймер и пустое состояние (mocha)

Оба варианта дисклеймера стилизованы в семействе empty-hint (центр,
светлый текст); при chats.length===0 && !loading рендерится вариант
«создайте чат с помощью кнопки <img start-chat-icon> либо нажмите
создать» с кнопкой data-testid=disclaimer-create; клик по кнопке
вызывает onCreateChat (стаб) — тот же createAndSelect.

## AC-HINT — чип авто-названия (stylelint/визуально)

Цвет текста — определённый в репо светлый токен (--second-text-color);
чип position:absolute поднят над инпутом заголовка (лёгкое перекрытие
допустимо); несуществующая переменная --secondary-text-color больше не
используется (grep-пин).

## AC-BADGE — AI-бейдж всегда виден (mocha)

Бейдж вынесен из обрезающего h4 в flex-сиблинг строки заголовка
(min-width:0 у текста, flex:0 0 auto у бейджа); длинный заголовок
по-прежнему однострочный с ellipsis; бейдж присутствует у ai-строк и
отсутствует у обычных (пины расширены).

## AC-CHECK — галочка отправки (mocha)

Оптимистичная запись своего сообщения появляется сразу после сабмита
(ownTempId, маркер «отправляется», replyTo переносится при реплае);
эхо сервера ЗАМЕНЯЕТ временную запись — условие: incoming user_id ===
viewer id И есть ownTempId-запись (oldest; контент — только тай-брейкер
среди нескольких своих темпов, чужое совпадающее сообщение ничего не
поглощает — review F-3); у своего сообщения с серверным id рендерится
«✓»; ключ кэша owntmp:<id> переиспользует инстанс; AI-pending-хвост не
затронут.

## AC-PROCESS — гейты и буккипинг

npm run verify exit 0 (mocha 733→ grown, 0 удалённых); guard --all
--strict 0; ownership audit чист; progress_log запись сверху;
decisions.md содержит журнал операторских замещений блокеров;
конвенциональные коммиты без co-author; всё на
feature/2026-11-07-messenger-ux-pack-2 от dev @ 6eef4f0.

## Evidence routes

- EV-1 / EV-2: npm run verify output —
  work/2026-11-07-messenger-ux-pack-2/evidence/WS-ALL/ (единый
  воркстрим, D-2; одна папка, лог гейта прикладывается к task-result).
- EV-3: guard strict + ownership audit + progress-log diff — evidence/ root.

## Checklist

| Criterion | Requirements | Evidence | Status |
| --- | --- | --- | --- |
| `AC-ICON` | `REQ-ICON` | `EV-1` | pending |
| `AC-LOADER` | `REQ-LOADER` | `EV-1` | pending |
| `AC-AVATAR` | `REQ-AVATAR` | `EV-1` | pending |
| `AC-HINT` | `REQ-HINT` | `EV-1` | pending |
| `AC-BADGE` | `REQ-BADGE` | `EV-1` | pending |
| `AC-DISCLAIMER` | `REQ-DISCLAIMER` | `EV-1` | pending |
| `AC-WSDEAD` | `REQ-WSDEAD` | `EV-2` | pending |
| `AC-FORMS` | `REQ-FORMS` | `EV-2` | pending |
| `AC-CHECK` | `REQ-CHECK` | `EV-2` | pending |
| `AC-PROCESS` | `REQ-PROCESS` | `EV-3` | pending |
