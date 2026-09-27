---
description: Запустить единый гейт npm run verify и оформить результат как evidence для ALK
allowed-tools: Bash(npm run verify)
---

Запусти `npm run verify` из корня репозитория. Это цепочка
typecheck → mocha → eslint → stylelint на `&&`: она останавливается на первом провале.

1. Зафиксируй, какая стадия упала, и последние строки её вывода.
2. Ничего не исправляй без явного разрешения.
3. При успехе верни строку вида: `verify: PASS (typecheck, mocha, eslint, stylelint)`,
   при провале: `verify: FAIL at <stage>` — эти строки цитируются в evidence ALK-пакета.
