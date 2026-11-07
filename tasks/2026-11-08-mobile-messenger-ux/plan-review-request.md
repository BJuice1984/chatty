# Plan review request — 2026-11-08-mobile-messenger-ux

Просим независимое ревью план-пакета S2 до freeze.

## Что ревьюить

- `tasks/2026-11-08-mobile-messenger-ux/plan.manifest.json` — контракт
  (требования, write-set, evidence, бюджеты).
- `specification.md` — продуктовая спецификация (8 операторских
  пунктов + бэкенд-маркер бота).
- `plan.md`, `acceptance-criteria.md`, `developer-overview.md`,
  `decisions.md`.

## Контекст репозитория

- База: origin/dev @ dc65e03fc48470b9c9aabf605d09ac3886610642 (после
  влития PR #57 — 2026-11-07-messenger-ux-pack-2).
- Архитектурные правила: AGENTS.md (слои, guard, гейты verify /
  verify:backend; комментарии в scss не пишем).
- Ключевые исследования: touch-обработки в src/ отсутствуют; chatUsers
  несут login/email/avatar; ChatMemberBrief без маркера бота;
  chat__container-profile-arrow в profile-settings потерял стили после
  pack-2; подложка карандаша красится всегда (chat.scss:257-265);
  чип авто-названия стоит на right: 180px (messenger.scss:73-87).

## На что смотреть особенно

1. Полнота покрытия восьми операторских пунктов требованиями.
2. Write-set точен (ничего лишнего/недостающего; тест-файлы на месте).
3. Правила плашки автора (D-2) реализуемы и проверяемы в mapper-пинах.
4. Бэкенд-минимализм is_bot (D-4) и отсутствие миграций.
5. Свайп-пороги/доминантность и jsdom-проводка тестами.
6. Risks: layout-гипотеза D-5 и обязательность живого смоука.
7. Evidence-маршруты и гейты финального аудита.

## Вердикт

READY_TO_FREEZE / REWORK / BLOCKED с findings по схеме ревью.
