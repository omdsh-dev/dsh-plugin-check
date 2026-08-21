/**
 * DSH 插件健康检查插件 v2 —— 审查 PC-02/X-01 修复。
 *
 * 按项目形态（registry / skill / collection / bundle / tool-bundle / unknown）
 * 分流检查规则，不再把 TypeScript 工具 bundle 模板当作唯一合规协议：
 * - registry → dsh.plugin.json 契约校验；
 * - skill → SKILL.md frontmatter 基本校验；
 * - collection → catalog.json 结构校验；
 * - bundle / tool-bundle → 清单 + patch + 构建陷阱；
 * - unknown → 明确标注 unsupported，不强行 fail。
 *
 * 安全边界：只读；路径 containment（防逃逸/symlink）；资源预算；
 * hub 检查离线优先、失败静默降级。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { detectKind } from './form.js';
import { checkManifest } from './manifest.js';
import { checkPatch } from './patch.js';
import { checkBuildPitfalls } from './build-check.js';
import { checkRegistry } from './registry.js';
import { checkHubStatus, resolveRepoIdentity } from './hub.js';
import { checkProfileInstallDocs, checkCoreRowIds, isBundleInstallable } from './ecosystem.js';
import { parsePatchSections } from './patch.js';
import { buildRepoReport, CHECK_SCHEMA } from './report.js';
export const name = '@omdsh-dev/dsh-plugin-check';
export const inject = ['tools'];
/** 读取 patch 全部条目 id 做 core row 冲突检查。 */
async function checkCoreRowIdsOf(dir) {
    try {
        const text = await fs.readFile(join(dir, 'cordis.patch.yml'), 'utf8');
        const entries = parsePatchSections(text).flatMap(s => s.entries);
        return checkCoreRowIds(entries);
    }
    catch {
        return []; // 无 patch 文件：由 no-patch/no-bundle-decl 检查覆盖
    }
}
/**
 * 找出仓库内的 skill 文档：根 SKILL.md，以及 skills/<name>/SKILL.md 的全部直接子目录。
 * 不只取第一个 nested skill，避免多 skill 仓库被部分校验；排序保证报告稳定。
 */
async function findSkillFiles(dir) {
    const files = [];
    const root = join(dir, 'SKILL.md');
    try {
        const st = await fs.lstat(root);
        if (st.isFile() && !st.isSymbolicLink())
            files.push(root);
    }
    catch { /* 根 skill 可不存在 */ }
    try {
        const entries = await fs.readdir(join(dir, 'skills'), { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (!entry.isDirectory() || entry.isSymbolicLink())
                continue;
            const nested = join(dir, 'skills', entry.name, 'SKILL.md');
            try {
                const st = await fs.lstat(nested);
                if (st.isFile() && !st.isSymbolicLink())
                    files.push(nested);
            }
            catch { /* missing nested skill is handled by the marker check */ }
        }
    }
    catch { /* no skills directory */ }
    return files;
}
/** skill 形态基本校验：校验根 skill 和全部 skills/<name>/SKILL.md。 */
async function checkSkill(dir) {
    const issues = [];
    const files = await findSkillFiles(dir);
    if (files.length === 0) {
        issues.push({ code: 'malformed-skill', detail: 'SKILL.md 缺失（根目录或 skills/<name>/SKILL.md）' });
        return issues;
    }
    for (const file of files) {
        const label = file.slice(dir.length + 1).replaceAll('\\', '/');
        let text;
        try {
            text = await fs.readFile(file, 'utf8');
        }
        catch {
            issues.push({ code: 'malformed-skill', detail: `${label} 不可读` });
            continue;
        }
        const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
        if (!m) {
            issues.push({ code: 'malformed-skill', detail: `${label} 缺 frontmatter（--- 包裹的 YAML）` });
            continue;
        }
        const fm = m[1];
        if (!/^name:\s*\S+/m.test(fm))
            issues.push({ code: 'malformed-skill', detail: `${label} frontmatter 缺 name` });
        if (!/^description:\s*\S+/m.test(fm))
            issues.push({ code: 'malformed-skill', detail: `${label} frontmatter 缺 description` });
    }
    return issues;
}
/** collection 形态基本校验：catalog.json 的 collection/plugins 结构。 */
async function checkCollection(dir) {
    const issues = [];
    try {
        const parsed = JSON.parse(await fs.readFile(join(dir, 'catalog.json'), 'utf8'));
        if (typeof parsed['collection'] !== 'string') {
            issues.push({ code: 'malformed-collection', detail: 'catalog.json 缺 collection 字段' });
        }
        if (!Array.isArray(parsed['plugins'])) {
            issues.push({ code: 'malformed-collection', detail: 'catalog.json 缺 plugins 数组' });
        }
    }
    catch {
        issues.push({ code: 'malformed-collection', detail: 'catalog.json 缺失或非法 JSON' });
    }
    return issues;
}
/** 检查单个仓库（按形态分流）。hub checker 可注入，便于离线测试/批量调用复用 catalog。 */
export async function checkRepo(dir, strict, hubChecker = checkHubStatus) {
    const kind = await detectKind(dir);
    const repo = await resolveRepoIdentity(dir);
    const issues = [];
    switch (kind) {
        case 'registry': {
            issues.push(...await checkRegistry(dir));
            break;
        }
        case 'skill': {
            issues.push(...await checkSkill(dir));
            break;
        }
        case 'collection': {
            issues.push(...await checkCollection(dir));
            issues.push(...await checkProfileInstallDocs(dir, kind));
            break;
        }
        case 'tool-bundle':
        case 'bundle': {
            const { issues: manifestIssues, pkg } = await checkManifest(dir);
            issues.push(...manifestIssues);
            if (pkg !== null) {
                const patchIssues = await checkPatch(dir, kind, pkg['name']);
                issues.push(...patchIssues);
                issues.push(...await checkBuildPitfalls(dir, kind, pkg));
                // 生态合规（plan §4.5）：core row id + 安装边界文档
                issues.push(...await checkCoreRowIdsOf(dir));
                const docs = await checkProfileInstallDocs(dir, kind);
                issues.push(...docs);
                const hasPatchDecl = pkg['dsh']?.bundle?.patch !== undefined;
                if (!isBundleInstallable(hasPatchDecl, docs)) {
                    issues.push({ code: 'manual-install-only', detail: '无法通过标准 Profile Bundle 安装（缺 dsh.bundle.patch 或 README 无 dsh plugin --profile add 示例）——补 patch 并在 README 首位给出标准安装命令' });
                }
            }
            break;
        }
        case 'unknown':
        case 'infra': {
            issues.push({ code: 'unsupported-kind', detail: `仓库形态为 ${kind === 'infra' ? 'infra（多包/基础设施，无 bundle 入口）' : 'unknown（无法识别）'}——已跳过详细检查` });
            break;
        }
    }
    // hub 状态（registry/skill/collection/bundle 都查；unknown/infra 跳过）
    if (kind !== 'unknown' && kind !== 'infra') {
        const hub = await hubChecker(repo, kind);
        issues.push(...hub.issues);
    }
    return buildRepoReport(repo, dir, kind, issues, strict);
}
/** 扫描目录下所有 dsh-* 插件仓库并逐个检查（lstat 跳过 symlink，仓库数预算）。 */
export async function scanDir(parent, strict) {
    const reports = [];
    let entries = [];
    try {
        entries = await fs.readdir(parent);
    }
    catch {
        throw new Error(`plugin_check: cannot read directory: ${parent}`);
    }
    const MAX_REPOS = 50;
    for (const e of entries) {
        if (reports.length >= MAX_REPOS)
            break;
        if (!e.startsWith('dsh-'))
            continue;
        const full = join(parent, e);
        let st;
        try {
            st = await fs.lstat(full);
        }
        catch {
            continue;
        }
        if (!st.isDirectory() || st.isSymbolicLink())
            continue;
        // 有 package.json、dsh.plugin.json、SKILL.md、catalog.json，或 skills/*/SKILL.md 才算项目。
        // skill 仓库（例如 dsh-plugin-dev）通常把 SKILL.md 放在 skills/<name>/ 下。
        let marker = false;
        for (const m of ['package.json', 'dsh.plugin.json', 'SKILL.md', 'catalog.json']) {
            try {
                await fs.access(join(full, m));
                marker = true;
                break;
            }
            catch { /* 继续 */ }
        }
        if (!marker) {
            try {
                const skillEntries = await fs.readdir(join(full, 'skills'), { withFileTypes: true });
                marker = skillEntries.some(entry => entry.isDirectory())
                    && (await Promise.all(skillEntries.filter(entry => entry.isDirectory()).map(async (entry) => {
                        try {
                            await fs.access(join(full, 'skills', entry.name, 'SKILL.md'));
                            return true;
                        }
                        catch {
                            return false;
                        }
                    }))).some(Boolean);
            }
            catch { /* 无 skills 目录 */ }
        }
        if (!marker)
            continue;
        reports.push(await checkRepo(full, strict));
    }
    return { root: parent, scanned: reports.length, reports };
}
function runAction(args) {
    const strict = args.strict === true;
    const target = typeof args.path === 'string' && args.path !== '' ? args.path : process.cwd();
    switch (args.action) {
        case 'check':
            return checkRepo(target, strict).then(r => JSON.stringify(r));
        case 'scan':
            return scanDir(target, strict).then(r => JSON.stringify(r));
        case 'schema':
            return Promise.resolve(JSON.stringify(CHECK_SCHEMA.map(({ code, severity, description, appliesTo }) => ({ code, severity, description, appliesTo }))));
        default:
            return Promise.reject(new Error(`plugin_check: unknown action "${args.action}"`));
    }
}
export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'plugin_check',
        description: 'Diagnose a dsh plugin repository by form (registry / skill / collection / bundle / tool-bundle): ' +
            'manifest protocol, dsh.plugin.json contract, cordis.patch.yml format, build pitfalls, hub registration. ' +
            'Actions: check (single repo directory), scan (all dsh-* projects under a parent directory), ' +
            'schema (check items with per-form applicability). Read-only: never modifies or builds the checked ' +
            'repository. path defaults to the current working directory; strict=true promotes warnings to errors.',
        parameters: {
            action: {
                type: 'string',
                required: true,
                enum: ['check', 'scan', 'schema'],
                description: 'Operation to perform.',
            },
            path: {
                type: 'string',
                description: 'Plugin repository directory (check) or parent directory (scan). Default: current working directory.',
            },
            strict: {
                type: 'boolean',
                description: 'Strict mode: treat warnings as errors in the verdict. Default false.',
            },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        execute: args => runAction(args),
        timeoutMs: 5000,
    }));
}
