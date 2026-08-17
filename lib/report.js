/**
 * 报告聚合 v2 —— 审查 PC-10 修复：checks 统计改为"固定检查项的执行结果"
 * （pass/fail/warn/skipped 按形态适用矩阵），不再把 issue 数伪装成 coverage。
 */
/** error 级 issue 码（warning 之外的都算 error；PC-11 动态升级码已并入）。 */
const ERROR_CODES = new Set([
    'no-manifest', 'invalid-name-format', 'missing-main-or-types', 'no-patch',
    'malformed-patch', 'patch-name-mismatch', 'duplicate-row-id',
    'no-source-entry', 'no-tsconfig', 'missing-ts-ext-imports',
    'missing-rewrite-imports', 'lib-layout-mismatch', 'stale-ts-imports',
    'no-build-entry',
    // registry
    'malformed-registry-manifest', 'invalid-registry-id', 'invalid-registry-version',
    'registry-main-missing', 'registry-client-main', 'registry-client-contract',
    'invalid-engines-dsh', 'malformed-contributes',
    // 生态合规（plan §4.5）
    'core-row-id',
]);
/** suggestions 模板。 */
const SUGGESTION_TEMPLATES = {
    'no-manifest': '创建 package.json（name/main/types/peerDependencies/dsh.bundle.patch）',
    'invalid-name-format': 'name 先符合 npm 包名规则（小写 scoped/unscoped、无空格和非法字符）',
    'non-org-recommended-name': '优先使用 @deepseek-ai/*、@dsh-external/*、@omdsh/* 或 dsh-*；其他合法名称仅作生态推荐警告',
    'missing-main-or-types': 'main/types 指向仓库根内实际存在的文件（lib/index.js + lib/types/index.d.ts）',
    'incomplete-files': 'files 声明 lib、src、cordis.patch.yml',
    'missing-peer': 'peerDependencies 声明 cordis（工具插件加 @deepseek-ai/dsh-tools）',
    'no-bundle-decl': 'package.json 加 dsh.bundle.patch 声明（指向仓库根内 ./cordis.patch.yml）',
    'no-patch': '创建 cordis.patch.yml：- insert: [{ id, name }]（config 等官方字段合法）',
    'malformed-patch': 'cordis.patch.yml 使用 - insert:/- update:/- disable: section + 每条目 id',
    'patch-name-mismatch': 'tool-bundle 的 patch 条目 name 与 package.json name 保持一致',
    'duplicate-row-id': 'row id 唯一（tool-xxx 每行一个）',
    'no-source-entry': '创建 src/index.ts（name/inject/apply + defineTool）',
    'no-tsconfig': '创建 tsconfig.json（allowImportingTsExtensions + rewriteRelativeImportExtensions + outDir lib）',
    'tsconfig-extends-unresolved': '修复 tsconfig extends 指向（相对路径或可解析的包）',
    'missing-ts-ext-imports': 'tsconfig 补 "allowImportingTsExtensions": true',
    'missing-rewrite-imports': 'tsconfig 补 "rewriteRelativeImportExtensions": true（产物自动改写 .js）——否则运行时必崩',
    'lib-layout-mismatch': 'tsconfig outDir 与 package.json main 的 lib/ 前缀一致',
    'types-path-mismatch': 'tsconfig declarationDir 与 package.json types 前缀一致',
    'implicit-node-types': 'tsconfig 显式声明 "types": ["node"]（避免隐式 @types 包含的脆弱性）',
    'stale-ts-imports': '重新构建 lib/（产物相对导入必须是 .js）',
    'no-build-script': 'package.json 补 scripts.build / scripts.prepack（clean checkout 可复现构建）',
    'no-build-entry': 'lib/ 缺失且无 scripts.build——补 build 脚本或提交产物',
    'malformed-registry-manifest': 'dsh.plugin.json 需为合法 JSON（id/version/main/engines.dsh/contributes）',
    'invalid-registry-id': 'registry id 使用小写字母数字与连字符（可含一段 /）',
    'invalid-registry-version': 'registry version 使用 semver',
    'registry-main-missing': 'registry main（及 client.main）指向插件根内存在的文件',
    'registry-client-main': 'client.main 指向插件根内存在的文件',
    'registry-client-contract': 'client.inject 应为字符串数组',
    'invalid-engines-dsh': 'engines.dsh 使用合法 semver range',
    'malformed-contributes': 'contributes.tools/skills 应为数组',
    'not-in-hub': '在 hub workshop 的 catalog intake 中登记（分类按仓库形态），或等待 catalog 同步',
    'hub-skipped': 'hub 状态未能检查（离线/无 gh）——非仓库问题',
    'scan-truncated': '扫描超过资源预算被截断——重新检查或清理仓库体积',
    'core-row-id': 'patch row id 改用 tool-<name> / service-<name> / client-<name>，避开官方核心 row（tools/session/llm/web/permission）',
    'missing-profile-install-example': 'README 补 `dsh plugin --profile <profile> add <plugin>` 示例（放在手动安装之前）',
    'manual-install-only': '补 dsh.bundle.patch 并在 README 首位给出标准安装命令；手动复制仅作旧版本兼容标注',
    'core-modification-required': '默认安装流程改为 dsh plugin --profile add；git apply / cp 进 monorepo 仅标注为旧版本兼容或开发调试',
};
export function isErrorCode(code) {
    return ERROR_CODES.has(code);
}
export const CHECK_SCHEMA = [
    // ── 清单协议（bundle 系）──
    { code: 'no-manifest', severity: 'error', description: 'package.json 缺失或非法', appliesTo: ['bundle', 'tool-bundle'] },
    { code: 'invalid-name-format', severity: 'error', description: 'name 不符合 npm 包名格式', appliesTo: ['bundle', 'tool-bundle'] },
    { code: 'non-org-recommended-name', severity: 'warning', description: 'name 合法但不在推荐组织范围', appliesTo: ['bundle', 'tool-bundle'] },
    { code: 'missing-main-or-types', severity: 'error', description: 'main/types 未声明、逃逸或不存在', appliesTo: ['bundle', 'tool-bundle'] },
    { code: 'incomplete-files', severity: 'warning', description: 'files 缺 lib/src/cordis.patch.yml', appliesTo: ['bundle', 'tool-bundle'] },
    { code: 'missing-peer', severity: 'warning', description: 'peerDependencies 缺 cordis/dsh-tools', appliesTo: ['bundle', 'tool-bundle'] },
    { code: 'no-bundle-decl', severity: 'warning', description: '缺 dsh.bundle.patch 声明或目标无效', appliesTo: ['bundle', 'tool-bundle'] },
    // ── patch 格式（bundle 系）──
    { code: 'no-patch', severity: 'error', description: 'bundle 形态缺 cordis.patch.yml', appliesTo: ['bundle', 'tool-bundle'] },
    { code: 'malformed-patch', severity: 'error', description: 'patch 结构非法或条目缺 id', appliesTo: ['bundle', 'tool-bundle'] },
    { code: 'patch-name-mismatch', severity: 'error', description: 'tool-bundle 的 patch name 与包名不一致', appliesTo: ['tool-bundle'] },
    { code: 'duplicate-row-id', severity: 'error', description: '重复 row id', appliesTo: ['bundle', 'tool-bundle'] },
    // ── 构建陷阱（bundle 系）──
    { code: 'no-source-entry', severity: 'error', description: 'src/index.ts 缺失', appliesTo: ['tool-bundle'] },
    { code: 'no-tsconfig', severity: 'error', description: 'tsconfig.json 缺失或非法', appliesTo: ['tool-bundle'] },
    { code: 'tsconfig-extends-unresolved', severity: 'warning', description: 'tsconfig extends 无法解析，相关检查跳过', appliesTo: ['tool-bundle'] },
    { code: 'missing-ts-ext-imports', severity: 'error', description: 'src 用 .ts 导入但缺 allowImportingTsExtensions', appliesTo: ['tool-bundle'] },
    { code: 'missing-rewrite-imports', severity: 'error', description: '缺 rewriteRelativeImportExtensions（产物残留 .ts，运行时必崩）', appliesTo: ['tool-bundle'] },
    { code: 'lib-layout-mismatch', severity: 'error', description: 'tsconfig outDir 与 main 前缀不一致', appliesTo: ['tool-bundle'] },
    { code: 'types-path-mismatch', severity: 'warning', description: 'declarationDir 与 types 前缀不一致', appliesTo: ['tool-bundle'] },
    { code: 'implicit-node-types', severity: 'warning', description: '用 Buffer/node: 但 tsconfig 未显式 types:["node"]', appliesTo: ['tool-bundle'] },
    { code: 'stale-ts-imports', severity: 'error', description: 'lib/ 产物残留 .ts 相对导入/worker URL（运行时必崩）', appliesTo: ['bundle', 'tool-bundle'] },
    { code: 'no-build-script', severity: 'warning', description: '缺 scripts.build/prepack', appliesTo: ['bundle', 'tool-bundle'] },
    { code: 'no-build-entry', severity: 'error', description: 'lib/ 缺失且无 build 脚本（clean checkout 无入口）', appliesTo: ['bundle', 'tool-bundle'] },
    { code: 'scan-truncated', severity: 'info', description: '扫描超过资源预算被截断', appliesTo: ['bundle', 'tool-bundle'] },
    // ── registry 契约 ──
    { code: 'malformed-registry-manifest', severity: 'error', description: 'dsh.plugin.json 缺失或非法', appliesTo: ['registry'] },
    { code: 'invalid-registry-id', severity: 'error', description: 'registry id 格式非法', appliesTo: ['registry'] },
    { code: 'invalid-registry-version', severity: 'warning', description: 'registry version 非 semver', appliesTo: ['registry'] },
    { code: 'registry-main-missing', severity: 'error', description: 'registry main 缺失/逃逸/不存在', appliesTo: ['registry'] },
    { code: 'registry-client-main', severity: 'warning', description: 'client.main 缺失/逃逸/不存在', appliesTo: ['registry'] },
    { code: 'registry-client-contract', severity: 'warning', description: 'client.inject 类型非法', appliesTo: ['registry'] },
    { code: 'invalid-engines-dsh', severity: 'warning', description: 'engines.dsh 非法 semver range', appliesTo: ['registry'] },
    { code: 'malformed-contributes', severity: 'warning', description: 'contributes.tools/skills 结构非法', appliesTo: ['registry'] },
    // ── 生态合规（Profile Bundle 安装边界，plan §4.5）──
    { code: 'core-row-id', severity: 'error', description: 'patch 条目使用了官方核心 row id', appliesTo: ['bundle', 'tool-bundle'] },
    { code: 'missing-profile-install-example', severity: 'warning', description: 'README 缺 dsh plugin --profile add 示例', appliesTo: ['bundle', 'tool-bundle', 'collection'] },
    { code: 'manual-install-only', severity: 'warning', description: '无法通过标准 Profile Bundle 安装', appliesTo: ['bundle', 'tool-bundle'] },
    { code: 'core-modification-required', severity: 'warning', description: '默认流程要求修改 DSH 核心', appliesTo: ['bundle', 'tool-bundle', 'collection'] },
    // ── 通用 ──
    { code: 'not-in-hub', severity: 'warning', description: '未收录进 hub catalog', appliesTo: ['registry', 'bundle', 'tool-bundle', 'collection', 'skill'] },
    { code: 'hub-skipped', severity: 'info', description: 'hub 状态检查被跳过（离线/无 gh）', appliesTo: ['registry', 'bundle', 'tool-bundle', 'collection', 'skill'] },
];
/** 按形态计算固定检查项结果。 */
export function computeCheckResults(issues, kind) {
    const byCode = new Map();
    for (const i of issues) {
        const list = byCode.get(i.code) ?? [];
        list.push(i);
        byCode.set(i.code, list);
    }
    return CHECK_SCHEMA.filter(item => item.appliesTo.includes(kind)).map(item => {
        const hits = byCode.get(item.code);
        if (!hits)
            return { code: item.code, status: 'pass' };
        if (item.code === 'hub-skipped' || item.code === 'scan-truncated')
            return { code: item.code, status: 'skipped' };
        const worst = hits.some(h => isErrorCode(h.code)) ? 'fail' : 'warn';
        return { code: item.code, status: worst };
    });
}
/** 聚合单仓库报告。 */
export function buildRepoReport(repo, path, kind, issues, strict) {
    const errors = issues.filter(i => isErrorCode(i.code) || (strict && !ERROR_CODES.has(i.code) && i.code !== 'hub-skipped' && i.code !== 'scan-truncated'));
    const warnings = issues.filter(i => !errors.includes(i) && i.code !== 'hub-skipped' && i.code !== 'scan-truncated');
    const skipped = issues.filter(i => i.code === 'hub-skipped' || i.code === 'scan-truncated').map(i => i.detail);
    const verdict = errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';
    const results = computeCheckResults(issues, kind);
    const checks = {
        total: results.length,
        passed: results.filter(r => r.status === 'pass').length,
        failed: results.filter(r => r.status === 'fail').length,
        warned: results.filter(r => r.status === 'warn').length,
        skipped: results.filter(r => r.status === 'skipped').length,
    };
    const suggestions = [...new Set(issues.map(i => SUGGESTION_TEMPLATES[i.code] ?? `处理问题 ${i.code}: ${i.detail}`))];
    return { repo, path, kind, verdict, errors, warnings, skipped, checks, suggestions };
}
