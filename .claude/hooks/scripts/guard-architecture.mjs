#!/usr/bin/env node
// Guard границ слоёв Chatty (компонент → контроллер → API → утилиты → core). Версия 2 (strict).
// Запускается вручную/CI и из PostToolUse hook (.claude/settings.json).
//
// Ранги слоёв (зависимость идёт только вниз по потреблению):
//   helpers/core(0) < utils(1) < api(2) < controllers(3) < components(4) < pages(5) < features(6)
// main.ts — композиционный корень, не проверяется. features/<name>/ — самодостаточная фича:
// импортировать вниз можно, чужие фичи — нельзя (cross-feature).
//
// Правила:
//   blocker  layer-direction       — импорт из верхнего слоя (utils→api, api→controllers, ...)
//   blocker  cross-feature         — runtime-импорт из чужой фичи (features/a → features/b)
//   blocker  ui-runtime-api        — runtime-импорт из api/ в UI (components|pages|feature pages/components)
//   blocker  dynamic-import        — dynamic import() нарушает те же границы (сканер ловит import('...'))
//   warning  cross-feature-type    — type-only импорт из чужой фичи
//   warning  ui-type-api-import    — named-импорт типов из api/ в UI
//
// TRANSITIONAL_DEBT (v2, реконсилирован по handoff stage 2 / EV-KERNEL-2):
//   формат file → { rule: owner }. Задокументированный долг:
//   - не проваливает --strict (exit 0), пока blocker понижен до warning;
//   - владелец обязан снять запись при закрытии долга (stage 4 — migrate-chats-profile).
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
    features: 6,
};

// Реконсилированная карта долга: file → { rule: owner } (правка — только stage 3, снятие — владелец).
// store/utils: handoff stage 2 (EV-KERNEL-2), закрытие — stage 4 (migrate-chats-profile).
const TRANSITIONAL_DEBT = {
    'src/utils/Store.ts': { 'layer-direction': 'stage 4 (migrate-chats-profile)' },
    'src/components/chatListUser/chatListUser.ts': { 'ui-type-api-import': 'stage 4 (migrate-chats-profile)' },
    'src/components/form-container/form-container.ts': { 'ui-type-api-import': 'stage 4 (migrate-chats-profile)' },
    'src/components/messenger/messenger.ts': { 'ui-type-api-import': 'stage 4 (migrate-chats-profile)' },
    'src/pages/chat/chat.ts': { 'ui-type-api-import': 'stage 4 (migrate-chats-profile)' },
    'src/pages/login/login.ts': { 'ui-type-api-import': 'stage 4 (migrate-chats-profile)' },
    'src/pages/profile/profile.ts': { 'ui-type-api-import': 'stage 4 (migrate-chats-profile)' },
    'src/pages/register/register.ts': { 'ui-type-api-import': 'stage 4 (migrate-chats-profile)' },
};

const RULE_LAYER_DIRECTION = 'layer-direction';
const RULE_CROSS_FEATURE = 'cross-feature';
const RULE_CROSS_FEATURE_TYPE = 'cross-feature-type';
const RULE_UI_RUNTIME_API = 'ui-runtime-api';
const RULE_UI_TYPE_API = 'ui-type-api-import';
const RULE_DYNAMIC_IMPORT = 'dynamic-import';

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
    // strict проваливается на blocker и на НЕ задокументированный warning;
    // задокументированный TRANSITIONAL_DEBT (с владельцем) — осознанный долг, не провал.
    const failed = findings.some((f) => f.level === 'blocker'
        || (strict && f.level === 'warning' && !isAcknowledgedDebt(f)));
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
                reason: `Архитектурный guard Chatty обнаружил нарушения:\n${lines}\n\nИсправь эти импорты перед продолжением (поток: компонент → контроллер → API → utils → core; между фичами — только через порты).`,
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
    const sourceFeature = featureName(file);
    const sourceSubLayer = featureSubLayer(file);
    for (const { clause, specifier, line, dynamic } of scanImports(text)) {
        if (!specifier.startsWith('.')) continue; // пакетные импорты не проверяем
        const target = resolveRelative(file, specifier);
        if (!target) continue;
        const targetLayer = fileLayer(target);
        if (!sourceLayer || !targetLayer) continue;

        checkLayerDirection(file, line, sourceLayer, targetLayer, findings, dynamic);
        checkCrossFeature(file, line, clause, sourceFeature, featureName(target), findings, dynamic);
        checkUiApiImport(file, line, clause, sourceLayer, sourceSubLayer, targetLayer, findings, dynamic);
    }
}

// Импорт из нижнего слоя в верхний — нарушение стрелки зависимостей.
function checkLayerDirection(file, line, sourceLayer, targetLayer, findings, dynamic) {
    if (LAYER_RANK[targetLayer] > LAYER_RANK[sourceLayer]) {
        const rule = dynamic ? RULE_DYNAMIC_IMPORT : RULE_LAYER_DIRECTION;
        const level = isDebt(file, rule) ? 'warning' : 'blocker';
        const via = dynamic ? ' (dynamic import)' : '';
        addFinding(findings, level, file, line, rule,
            `слой "${sourceLayer}" импортирует из верхнего слоя "${targetLayer}"${via}. Зависимости идут только вниз: pages → components → controllers → api → utils → core/helpers.`);
    }
}

// Фича самодостаточна: runtime-импорт из чужой фичи запрещён, type-only — задокументированный warning.
function checkCrossFeature(file, line, clause, sourceFeature, targetFeature, findings, dynamic) {
    if (!sourceFeature || !targetFeature || sourceFeature === targetFeature) return;

    const typeOnly = /^type\b/.test(clause.trim());
    const rule = typeOnly ? RULE_CROSS_FEATURE_TYPE : RULE_CROSS_FEATURE;
    const level = isDebt(file, rule) ? 'warning' : (typeOnly ? 'warning' : 'blocker');
    const via = dynamic ? ' (dynamic import)' : '';
    addFinding(findings, level, file, line, rule,
        `cross-feature импорт "${sourceFeature}" → "${targetFeature}"${via}. Фичи общаются только через собственные порты (features/<name>/ports.ts).`);
}

// UI (components/pages и UI-подслой фич) не должен тянуть runtime из api — только через контроллеры.
function checkUiApiImport(file, line, clause, sourceLayer, sourceSubLayer, targetLayer, findings, dynamic) {
    if (targetLayer !== 'api') return;

    const isUi = (sourceLayer === 'components' || sourceLayer === 'pages')
        || (sourceLayer === 'features' && (sourceSubLayer === 'pages' || sourceSubLayer === 'components'));
    if (!isUi) return;

    const typeOnly = /^type\b/.test(clause.trim());
    // default-импорт: клауза начинается с идентификатора, а не с "{" (напр. `API` или `API, { T }`).
    const hasDefaultImport = !typeOnly && /^[A-Za-z_$]/.test(clause.trim());

    if (hasDefaultImport || dynamic) {
        const rule = dynamic ? RULE_DYNAMIC_IMPORT : RULE_UI_RUNTIME_API;
        const level = isDebt(file, rule) ? 'warning' : 'blocker';
        const via = dynamic ? ' (dynamic import)' : '';
        addFinding(findings, level, file, line, rule,
            `runtime-импорт из API-слоя в UI${via}. Компоненты работают с бэкендом только через контроллеры (фичи — через свои порты).`);
    } else {
        const level = isDebt(file, RULE_UI_TYPE_API) ? 'warning' : 'warning';
        addFinding(findings, level, file, line, RULE_UI_TYPE_API,
            'типы из API-слоя в UI — техдолг; выносите DTO-типы в отдельный модуль (например src/api/types.ts), чтобы UI не зависел от API-файлов.');
    }
}

// --- разбор импортов -------------------------------------------------------

// Возвращает [{ clause, specifier, line, dynamic }] для статических import ... from '...'
// и динамических import('...') (clause = 'dynamic').
function scanImports(text) {
    const imports = [];
    const re = /\bimport\s+([^'"]+?)\s+from\s*['"]([^'"]+)['"]/g;
    const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = re.exec(text)) !== null) {
        imports.push({
            clause: match[1],
            specifier: match[2],
            line: lineOf(text, match.index),
            dynamic: false,
        });
    }
    while ((match = dynamicRe.exec(text)) !== null) {
        imports.push({
            clause: 'dynamic',
            specifier: match[1],
            line: lineOf(text, match.index),
            dynamic: true,
        });
    }
    return imports;
}

function lineOf(text, index) {
    return text.slice(0, index).split('\n').length;
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

// 'src/features/auth/pages/login/login.ts' → 'auth'
function featureName(file) {
    const match = file.match(/^src\/features\/([^/]+)\//);
    return match ? match[1] : null;
}

// 'src/features/auth/pages/login/login.ts' → 'pages'
function featureSubLayer(file) {
    const match = file.match(/^src\/features\/[^/]+\/([^/]+)\//);
    return match ? match[1] : null;
}

function debtOwner(file, rule) {
    const entry = TRANSITIONAL_DEBT[file];
    return entry && typeof entry === 'object' ? entry[rule] : undefined;
}

function isDebt(file, rule) {
    return debtOwner(file, rule) !== undefined;
}

// Задокументированный долг = запись в карте с владельцем.
function isAcknowledgedDebt(finding) {
    return isDebt(finding.file, finding.rule);
}

function addFinding(findings, level, file, line, rule, message) {
    const owner = debtOwner(file, rule);
    const tag = owner
        ? ` [acknowledged debt → ${owner}]`
        : (level === 'warning' && TRANSITIONAL_DEBT[file] ? ' [transitional debt — подавлено]' : '');
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
