# Plan review request — 2026-11-05-messenger-ux-pack

Reviewer class: `independent-plan-reviewer` · Tier: S2 (resolved, digest
`eb92c1b29fc524a870b9755562c21f02ee7af6ef95b938daa2afeec77a998aa7`) · Base: dev @
`cadf2b019c5312fbc8142f75197ab6ac8caec81e`

## What to review

Plan package `tasks/2026-11-05-messenger-ux-pack/`: `plan.md`, `specification.json`,
`developer-overview.md`, `acceptance-criteria.md`, `plan.manifest.json`.

## Scope (six operator items, one contour)

1. Новый чат — верх списка (activityOrder fallback на created_at; ChatInfo.created_at).
2. Аватар чата — из карточки списка в шапку чата (owner-only аффорданс; /files/avatars
   уже require_owned) + фикс переполнения длинного заголовка.
3. Inline-переименование (PUT /chats/{id}, require_active_member; системное сообщение
   messages.kind, миграция 012; WS chat_renamed + message-with-kind broadcast; UI: dblclick,
   сохранение по Enter/Esc/focus-out — Esc СОХРАНЯЕТ по решению оператора).
4. «Найти все чаты» + '@'-поиск ('@'-ветка GET /chats/search по участникам; сид '@'+email из
   меню контакта через шов setChatSearchOpener + setChatSearchBarValue).
5. Починка kick/leave: живой контейнер API старее репо (проверено пробами 401-vs-404) —
   пересборка compose-стека по runbook (WS-OPS-STACK, единственный репо-write —
   scripts/probe-own-backend-routes.ps1).
6. «Пометить всё прочитанными» (POST /chats/read-all; иконка в шапке списка, активна только
   при непрочитанных).

## Review focus

- Корректность архитектурных швов: consumer-side setChatSearchOpener (прецедент
  setChatOpener), gateway-notify для chat_renamed (прецедент onChatDeleted), владение
  shared-файлов между WS-FE-CHAT и WS-FE-SEARCH (последовательные волны, пересечения
  write-set'ов нет).
- Миграция 012 и сегментные тесты 009/010/011 (явные downgrade-таргеты; обязанность repin
  закреплена за WS-BE-API).
- Полнота acceptance/evidence: каждый REQ покрыт AC + EV; гейты (npm run verify,
  bash backend/verify.sh c PYTHON_BIN, guard --all --strict) достижимы и детерминированы;
  известные 4 Windows ingestion-падения оформлены deviations.
- Безопасность: SEC-AUTHZ (гварды новых эндпоинтов, скоуп '@'-поиска членством),
  SEC-XSS (системное сообщение через двойные скобки, пин).
- Риски UX-решений оператора: Esc-сохранение, unread у системных сообщений, полный email в
  строке поиска при «Найти все чаты» — задокументированы как осознанные.
- Non-goals не протекают в требования; write-sets точны (никто не пишет в чужие файлы).

## Verdict scale

`READY_TO_FREEZE` | `NEEDS_REFINEMENT` (с конкретными F-номерами) | `BLOCKED`.
