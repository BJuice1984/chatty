# tasks/ — план-пакеты agent-lifecycle-kit (ALK)

Этот каталог — хранилище **иммутабельного авторитета планов**. План-пакеты коммитятся;
их изменение после freeze возможно только новой ревизией пакета (refreeze), а не правкой на месте.

## Структура план-пакета

```
tasks/<plan-id>/
├── plan.manifest.json      # манифест (схема agent-plan-manifest.v1): workstreams, ownership, бюджеты, validation
├── plan.md                 # сам план
├── acceptance-criteria.md  # критерии приёмки
└── plan.lock.json          # заморозка (схема agent-plan-lock.v2), появляется после freeze
```

Конвенция `<plan-id>`: `<гггг-мм-дд>-<slug>` — сортируемо и уникально, например `2026-09-28-avatar-upload`.

## Рантайм — не здесь

Исполнение плана пишет артефакты в `work/<plan-id>/` (workflow state, journal, evidence-receipts,
task-пакеты воркеров, аудиты). `work/` полностью гитигнорится и не коммитится — состояние
восстанавливается повторными прогонами. Локальный профиль ALK живёт в `.alk/` — тоже не коммитится.

## Evidence-контракт

Каждый манифест цитирует единый детерминированный гейт репозитория:

```json
"validation": {
    "commands": ["npm run verify"]
}
```

`npm run verify` = typecheck → mocha → eslint → stylelint (fail-fast на первой упавшей стадии).
В evidence записывается exit-код и упавшая стадия. Минимум для S0 — одна команда.

## Операторские проверки (CLI `agent-lifecycle`)

```bash
agent-lifecycle plan check --manifest tasks/<id>/plan.manifest.json
agent-lifecycle plan acceptance-check --manifest tasks/<id>/plan.manifest.json
agent-lifecycle plan verify --manifest tasks/<id>/plan.manifest.json --lock tasks/<id>/plan.lock.json
agent-lifecycle task compile --manifest tasks/<id>/plan.manifest.json --out-dir work/<id>/workflow/task-packets
agent-lifecycle audit ownership --base HEAD --fail-on-unowned --fail-on-forbidden
```

На Windows, если `agent-lifecycle` не резолвится: `py -3.12 -m agent_lifecycle ...` (см. AGENTS.md).

## Ветки прогонов

Обычный прогон плана живёт в ветке `feature/<plan-id>` от принятого integration baseline.
Для текущего AI-messenger контура integration baseline и целевая ветка PR — `dev`:
сначала backend foundation, затем frontend boundary, каждый пакет — отдельный PR после
проверки предыдущего. Ветка `dev` должна существовать до freeze первого пакета.
Ветки `sprint_*` и `deploy` принадлежат учебному потоку Практикума — не использовать и не менять.

## Запреты

- `.alk/` и `work/` никогда не коммитятся (проверка: `git check-ignore .alk work`).
- Заранее замороженный пакет не правится — только новая ревизия/refreeze.

## Пересчёт digest у docs/project-principles.json

При правке `docs/project-principles.json` пересчитайте `principlesDigest` (sha256 канонического JSON
без самого поля digest) и обновите его в `.alk/project-profile.json`, иначе `project profile check`
упадёт у всех участников:

```powershell
py -3.12 -c "import json,hashlib;d=json.load(open('docs/project-principles.json',encoding='utf-8'));d.pop('principlesDigest',None);print(hashlib.sha256(json.dumps(d,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')).hexdigest())"
```
