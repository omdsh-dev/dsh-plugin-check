/**
 * 生态合规检查 —— Profile Bundle 安装边界（immediate-adjustments-bundle-profile-plan §4.5）。
 *
 * 新增检查项（只读）：
 * - core-row-id（error）：patch 条目使用了官方核心 row id（tools/session/llm/web/permission 等）；
 * - missing-profile-install-example（warning）：README 没有任何 `dsh plugin --profile ... add` 示例；
 * - manual-install-only（warning）：无法通过标准 Profile Bundle 安装（无 patch，或 README 只有手动流程）；
 * - core-modification-required（warning）：README 默认流程/脚本要求修改 DSH 核心（git apply 到核心、
 *   cp/rsync 进 monorepo、编辑官方 profile 文件）。明确标注"手动安装与旧版本兼容/旧版本兼容"的段落不计入。
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
/** 官方核心 row id 黑名单（plan §5.2）：社区插件不得使用。 */
export const FORBIDDEN_CORE_ROWS = ['tools', 'session', 'llm', 'web', 'permission'];
const PROFILE_ADD_RE = /dsh\s+plugin\s+--profile\s+\S+\s+add\b/;
/** 旧版本兼容/手动安装章节标记（其内容不计入核心修改检查）。 */
const LEGACY_MARKERS = ['手动安装与旧版本兼容', '旧版本兼容', '## 兼容方式', '### 手动安装'];
/** 取 README 默认流程部分（旧版本兼容标记之前的全部内容）。 */
function defaultFlowPart(readme) {
    let cut = readme.length;
    for (const m of LEGACY_MARKERS) {
        const i = readme.indexOf(m);
        if (i !== -1 && i < cut)
            cut = i;
    }
    return readme.slice(0, cut);
}
/** 核心修改信号：git apply 到核心路径、cp/rsync 进 monorepo、编辑官方 profile。 */
const CORE_MODIFICATION_RE = /(git\s+apply|patch\s+-p\d|cp\s+-r|rsync).{0,120}(dsh\/source|dsh\.yml|cordis\.yml|packages\/|apps\/)/i;
/** README 安装边界检查（bundle/tool-bundle/collection 适用）。 */
export async function checkProfileInstallDocs(dir, kind) {
    const issues = [];
    let readme = '';
    try {
        readme = await fs.readFile(join(dir, 'README.md'), 'utf8');
    }
    catch {
        issues.push({ code: 'missing-profile-install-example', detail: 'README.md 缺失——无法确认安装方式（应提供 dsh plugin --profile ... add 示例）' });
        return issues;
    }
    if (!PROFILE_ADD_RE.test(readme)) {
        issues.push({ code: 'missing-profile-install-example', detail: 'README 没有 `dsh plugin --profile <profile> add <plugin>` 示例（官方标准安装路径）' });
    }
    // 默认流程（legacy 标记之前）里的核心修改信号
    const head = defaultFlowPart(readme);
    if (CORE_MODIFICATION_RE.test(head)) {
        issues.push({ code: 'core-modification-required', detail: 'README 默认安装流程要求修改 DSH 核心（git apply / cp 进 monorepo / 编辑官方 profile）——应改为 dsh plugin --profile add' });
    }
    // scripts 里的核心修改信号（git apply 到核心路径）
    let scripts = '';
    try {
        const entries = await fs.readdir(join(dir, 'scripts'));
        for (const e of entries) {
            if (!/\.(sh|ps1|mjs|js)$/.test(e))
                continue;
            try {
                scripts += await fs.readFile(join(dir, 'scripts', e), 'utf8');
            }
            catch { /* 跳过 */ }
        }
    }
    catch { /* 无 scripts 目录 */ }
    if (/git\s+apply/.test(scripts) && /dsh\/source|cordis\.yml|packages\//i.test(scripts)) {
        issues.push({ code: 'core-modification-required', detail: 'scripts 里存在对 DSH 核心路径的 git apply' });
    }
    void kind;
    return issues;
}
/** 标准可安装性信号：有 bundle patch 声明 + README 有 profile add 示例。 */
export function isBundleInstallable(patchDeclared, docsIssues) {
    const hasExample = !docsIssues.some(i => i.code === 'missing-profile-install-example');
    return patchDeclared && hasExample;
}
/** patch 条目 core row id 检查（bundle/tool-bundle 适用）。 */
export function checkCoreRowIds(entries) {
    const issues = [];
    for (const e of entries) {
        if (FORBIDDEN_CORE_ROWS.includes(e.id)) {
            issues.push({ code: 'core-row-id', detail: `patch 条目 id "${e.id}" 与官方核心 row 冲突——使用 tool-<name> / service-<name> / client-<name> 命名` });
        }
    }
    return issues;
}
