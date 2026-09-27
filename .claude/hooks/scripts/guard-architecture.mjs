#!/usr/bin/env node
// Guard границ слоёв Chatty (компонент → контроллер → API → утилиты → core).
// Запускается вручную/CI и из PostToolUse hook (.claude/settings.json).
//
// Ранги слоёв (зависимость идёт только вниз по потреблению):
//   helpers/core(0) < utils(1) < api(2) < controllers(3) < components(4) < pages(5)
// main.ts — композиционный корень, не проверяется.
//
// Правила:
//   blocker  layer-direction       — импорт из верхнего слоя (utils→api, api→controllers, ...)
//   blocker  ui-runtime-api        — default-импорт (runtime) из api/ в components|pages
//   warning  ui-type-api-import    — named-импорт типов из api/ в components|pages (техдолг)
//
// Известный долг заносится в TRANSITIONAL_DEBT: blocker понижается до warning.
// Починил нарушение — удали запись.
//
// CLI:
//   node .claude/hooks/scripts/guard-architecture.mjs --files src/utils/Store.ts
//   node .claude/hooks/scripts/guard-architecture.mjs --all [--strict] [--format json]
// Без аргументов — режим PostToolUse hook: читает событие из stdin, проверяет один
// файл, блокирует (decision:block) или дополняет контекст (additionalContext).
// Любой сбой разбора не должен ронять сессию агента — выходим 0.

import fs from 'node:fs';
import path from 'node:path';

const LAYER_RANK = {
    helpers: 0,
    core: 0,
    utils: 1,
    api: 2,
    controllers: 3,
    components: 4,
    pages: 5,
};

// Файл → правила, чей blocker подавлен до warning (исторический долг).
const TRANSITIONAL_DEBT = {
    'src/utils/Store.ts': ['layer-direction'], // типы ChatUser/Message из api и controllers
};

const RULE_LAYER_DIRECTION = 'layer-direction';
const RULE_UI_RUNTIME_API = 'ui-runtime-api';
const RULE_UI_TYPE_API = 'ui-type-api-import';

const args = process.argv.slice(2);

if (args.includes('--files') || args.includes('--all')) {
    runCli(args);
} else {
    runHookMode();
}

function runCli(cliArgs) {
    const strict = cliArgs.includes('--strict');
    const asJson = cliArgs.includes('--format');
    const files = cliArgs.includes('--all')
        ? collectAllFiles()
        : collectListedFiles(cliArgs);
    const findings = [];
    for (const file of files) {
        checkFile(file, findings);
    }
    if (asJson) {
        process.stdout.write(`${JSON.stringify({ findings, total: findings.length })}\n`);
    } else {
        for (const f of findings) {
            process.stdout.write(`${f.level === 'blocker' ? '✖' : '⚠'} ${f.rule} ${f.file}:${f.line} — ${f.message}\n`);
        }
        process.stdout.write(findings.length === 0 ? 'guard: 0 нарушений\n' : `guard: ${findings.length} нарушений\n`);
    }
    const failed = findings.some((f) => f.level === 'blocker' || (strict && f.level === 'warning'));
    process.exit(failed ? 1 : 0);
}

function runHookMode() {
    try {
        const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
        if (payload?.hook_event_name !== 'PostToolUse') process.exit(0);
        const filePath = payload.tool_input?.file_path;
        if (!filePath) process.exit(0);
        const cwd = payload.cwd || process.cwd();
        const rel = path.relative(cwd, filePath).replaceAll('\\', '/');
        if (!isTargetSource(rel)) process.exit(0);

        const findings = [];
        checkFile(rel, findings);
        const blockers = findings.filter((f) => f.level === 'blocker');
        const warnings = findings.filter((f) => f.level === 'warning');

        if (blockers.length > 0) {
            const lines = blockers.map((f) => `  • ${f.rule} (${f.file}:${f.line}) — ${f.message}`).join('\n');
            process.stdout.write(`${JSON.stringify({
                decision: 'block',
                reason: `Архитектурный guard Chatty обнаружил нарушения:\n${lines}\n\nИсправь эти импорты перед продолжением (поток: компонент → контроллер → API → utils → core).`,
            })}\n`);
        } else if (warnings.length > 0) {
            const lines = warnings.map((f) => `  • ${f.rule} (${f.file}:${f.line}) — ${f.message}`).join('\n');
            process.stdout.write(`${JSON.stringify({
                hookSpecificOutput: {
                    hookEventName: 'PostToolUse',
                    additionalContext: `Архитектурный guard Chatty — замечания (не блокирующие):\n${lines}`,
                },
            })}\n`);
        }
    } catch {
        // Сбой разбора не должен ронять сессию агента.
    }
    process.exit(0);
}

function checkFile(file, findings) {
    if (!isTargetSource(file)) return;
    const text = fs.readFileSync(file, 'utf8');
    const sourceLayer = fileLayer(file);
    for (const { clause, specifier, line } of scanImports(text)) {
        if (!specifier.startsWith('.')) continue; // пакетные импорты не проверяем
        const target = resolveRelative(file, specifier);
        if (!target) continue;
        const targetLayer = fileLayer(target);
        if (!sourceLayer || !targetLayer) continue;

        checkLayerDirection(file, line, sourceLayer, targetLayer, findings);
        checkUiApiImport(file, line, clause, sourceLayer, targetLayer, findings);
    }
}

// Импорт из нижнего слоя в верхний — нарушение стрелки зависимостей.
function checkLayerDirection(file, line, sourceLayer, targetLayer, findings) {
    if (LAYER_RANK[targetLayer] > LAYER_RANK[sourceLayer]) {
        const level = isDebt(file, RULE_LAYER_DIRECTION) ? 'warning' : 'blocker';
        addFinding(findings, level, file, line, RULE_LAYER_DIRECTION,
            `слой "${sourceLayer}" импортирует из верхнего слоя "${targetLayer}". Зависимости идут только вниз: pages → components → controllers → api → utils → core/helpers.`);
    }
}

// UI (components/pages) не должен тянуть runtime из api — только через контроллеры.
// Named-импорты типов — распространённый техдолг, не блокируем.
function checkUiApiImport(file, line, clause, sourceLayer, targetLayer, findings) {
    if (targetLayer !== 'api') return;
    if (sourceLayer !== 'components' && sourceLayer !== 'pages') return;

    const typeOnly = /^type\b/.test(clause.trim());
    // default-импорт: клауза начинается с идентификатора, а не с "{" (напр. `API` или `API, { T }`).
    const hasDefaultImport = !typeOnly && /^[A-Za-z_$]/.test(clause.trim());

    if (hasDefaultImport) {
        addFinding(findings, 'blocker', file, line, RULE_UI_RUNTIME_API,
            'runtime-импорт из API-слоя в UI. Компоненты работают с бэкендом только через контроллеры (src/controllers/).');
    } else {
        addFinding(findings, 'warning', file, line, RULE_UI_TYPE_API,
            'типы из API-слоя в UI — техдолг; выносите DTO-типы в отдельный модуль (например src/api/types.ts), чтобы UI не зависел от API-файлов.');
    }
}

// --- разбор импортов -------------------------------------------------------

// Возвращает [{ clause, specifier, line }] для статических import ... from '...'.
function scanImports(text) {
    const imports = [];
    const re = /\bimport\s+([^'"]+?)\s+from\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = re.exec(text)) !== null) {
        imports.push({
            clause: match[1],
            specifier: match[2],
            line: text.slice(0, match.index).split('\n').length,
        });
    }
    return imports;
}

function resolveRelative(fromFile, specifier) {
    const baseDir = path.dirname(fromFile);
    const resolved = path.posix.normalize(path.posix.join(baseDir, specifier));
    return resolved.startsWith('src/') ? resolved : null;
}

function fileLayer(file) {
    const match = file.match(/^src\/([a-z]+)\//);
    return match && match[1] in LAYER_RANK ? match[1] : null;
}

function isDebt(file, rule) {
    const rules = TRANSITIONAL_DEBT[file];
    return Array.isArray(rules) && rules.includes(rule);
}

function addFinding(findings, level, file, line, rule, message) {
    const tag = level === 'warning' && isDebt(file, rule) ? ' [transitional debt — подавлено]' : '';
    findings.push({ level, file, line, rule, message: `${message}${tag}` });
}

// --- сбор файлов -----------------------------------------------------------

function isTargetSource(rel) {
    if (!/^src\//.test(rel)) return false;
    if (!/\.(ts|tsx)$/.test(rel)) return false;
    if (/\.(test|spec)\./.test(rel) || rel.endsWith('.d.ts')) return false;
    return true;
}

function collectAllFiles() {
    const out = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.posix.join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (isTargetSource(p)) out.push(p);
        }
    };
    walk('src');
    return out;
}

function collectListedFiles(cliArgs) {
    const idx = cliArgs.indexOf('--files');
    if (idx === -1) return [];
    const files = cliArgs.slice(idx + 1).filter((a) => !a.startsWith('--'));
    return files.filter(isTargetSource);
}
