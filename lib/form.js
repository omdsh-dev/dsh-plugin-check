/**
 * 项目形态检测 —— 审查 PC-01/PC-02 修复：先识别仓库形态，
 * 按 registry / skill / collection / bundle / tool-bundle / unknown 分流，
 * 不再把 "TypeScript 工具 bundle 模板" 当成唯一合规协议。
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
export const KIND_LABELS = {
    registry: 'registry 原生插件（dsh.plugin.json）',
    skill: 'skill（SKILL.md）',
    collection: 'collection（catalog.json）',
    'tool-bundle': 'bundle 工具插件（TypeScript + dsh-tools）',
    bundle: 'bundle（cordis 插件包）',
    infra: '基础设施/多包仓库（无 bundle 入口）',
    unknown: '无法识别',
};
async function exists(p) {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
}
/** skills/ 目录含 SKILL.md 也算 skill 形态（如 dsh-plugin-dev）。 */
async function hasSkillsDir(dir) {
    try {
        const entries = await fs.readdir(join(dir, 'skills'));
        for (const e of entries) {
            if (await exists(join(dir, 'skills', e, 'SKILL.md')))
                return true;
        }
    }
    catch { /* 无 skills 目录 */ }
    return false;
}
/** 判定工具插件：src 文本中出现 @deepseek-ai/dsh-tools 的任意引入形式（含子路径）。 */
export function looksLikeToolPlugin(srcTexts) {
    return srcTexts.some(t => /(?:from\s+|import\s*\(|require\s*\(|import\s+)['"]@deepseek-ai\/dsh-tools(?:\/[a-zA-Z0-9._-]+)?['"]/.test(t));
}
/** 检测目录的项目形态。 */
export async function detectKind(dir) {
    const hasPkg = await exists(join(dir, 'package.json'));
    const hasRegistry = await exists(join(dir, 'dsh.plugin.json'));
    const hasSkill = await exists(join(dir, 'SKILL.md'));
    const hasCatalog = await exists(join(dir, 'catalog.json'));
    // A valid, non-empty bundle declaration is the package protocol marker. It
    // takes precedence over an adjacent dsh.plugin.json (which may be a stale
    // registry artifact). Detection deliberately does not resolve the patch
    // path; checkManifest owns that later filesystem validation.
    let pkg = null;
    let hasValidBundleDecl = false;
    if (hasPkg) {
        try {
            pkg = JSON.parse(await fs.readFile(join(dir, 'package.json'), 'utf8'));
            const dsh = pkg['dsh'];
            const bundle = dsh && typeof dsh === 'object' ? dsh['bundle'] : undefined;
            const patch = bundle && typeof bundle === 'object' ? bundle['patch'] : undefined;
            hasValidBundleDecl = typeof patch === 'string' && patch.trim() !== '';
        }
        catch { /* invalid package.json is handled by manifest checks */ }
    }
    // A valid bundle declaration supersedes only the registry protocol. A
    // collection catalog remains authoritative when both protocols are present
    // (for example dsh-toolkit, which is a distribution rather than a plugin).
    if (hasRegistry && !hasValidBundleDecl)
        return 'registry';
    if (hasSkill && !hasPkg)
        return 'skill';
    if (!hasPkg && await hasSkillsDir(dir))
        return 'skill';
    if (hasCatalog) {
        // collection 判定：catalog.json 含 collection/plugins 结构
        try {
            const parsed = JSON.parse(await fs.readFile(join(dir, 'catalog.json'), 'utf8'));
            if (typeof parsed['collection'] === 'string' || Array.isArray(parsed['plugins']))
                return 'collection';
        }
        catch { /* 非 collection */ }
    }
    if (hasPkg) {
        // 无 main 的包不是可加载 bundle → infra（多包/基础设施，如 dsh-my-rsi）
        if (!hasValidBundleDecl && pkg !== null && (typeof pkg['main'] !== 'string' || pkg['main'] === ''))
            return 'infra';
        const texts = await collectSrcTexts(dir);
        return looksLikeToolPlugin(texts) ? 'tool-bundle' : 'bundle';
    }
    return 'unknown';
}
/** 收集 src/ 下全部 .ts 内容（有预算，lstat 不跟 symlink）。 */
export async function collectSrcTexts(dir, limitBytes = 512 * 1024) {
    const out = [];
    let budget = limitBytes;
    const walk = async (p, depth) => {
        if (depth > 6 || budget <= 0)
            return;
        let entries = [];
        try {
            entries = await fs.readdir(p);
        }
        catch {
            return;
        }
        for (const e of entries) {
            if (e === 'node_modules' || e.startsWith('.'))
                continue;
            const full = join(p, e);
            let st;
            try {
                st = await fs.lstat(full);
            }
            catch {
                continue;
            }
            if (st.isSymbolicLink())
                continue;
            if (st.isDirectory()) {
                await walk(full, depth + 1);
                continue;
            }
            if (!e.endsWith('.ts'))
                continue;
            try {
                const text = await fs.readFile(full, 'utf8');
                budget -= Buffer.byteLength(text);
                out.push(text);
            }
            catch { /* 跳过 */ }
        }
    };
    await walk(join(dir, 'src'), 0);
    return out;
}
