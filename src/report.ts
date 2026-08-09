/**
 * 报告聚合 —— 检查结果 → 报告 JSON + suggestions 模板 + verdict 判定。
 */

export interface CheckIssue {
  code: string
  detail: string
}

export interface RepoReport {
  repo: string
  path: string
  verdict: 'pass' | 'warn' | 'fail'
  errors: CheckIssue[]
  warnings: CheckIssue[]
  skipped: string[]
  checks: { total: number; passed: number }
  suggestions: string[]
}

/** error 级 issue 码（warning 之外的都算 error）。 */
const ERROR_CODES = new Set([
  'no-manifest', 'invalid-name', 'missing-main-or-types', 'no-patch',
  'malformed-patch', 'patch-name-mismatch', 'duplicate-row-id',
  'no-source-entry', 'no-tsconfig', 'missing-ts-ext-imports', 'lib-layout-mismatch',
  'stale-ts-imports',
])

/** suggestions 模板（按 code；detail 兜底）。 */
const SUGGESTION_TEMPLATES: Record<string, string> = {
  'no-manifest': '创建 package.json（name/main/types/peerDependencies/dsh.bundle.patch）',
  'invalid-name': 'name 使用 @deepseek-ai/dsh-* 或 dsh-* 规范命名',
  'missing-main-or-types': 'main/types 指向实际存在的文件（构建产物在 lib/ 时：lib/index.js + lib/types/index.d.ts）',
  'incomplete-files': 'files 声明 lib、src、cordis.patch.yml',
  'missing-peer': 'peerDependencies 声明 cordis（工具插件加 @deepseek-ai/dsh-tools）',
  'no-bundle-decl': 'package.json 加 dsh.bundle.patch 声明（指向 ./cordis.patch.yml）',
  'no-patch': '创建 cordis.patch.yml：- insert: [{ id, name }]',
  'malformed-patch': 'cordis.patch.yml 使用 - insert: 列表 + 每条目 id/name 字段',
  'patch-name-mismatch': 'patch 条目 name 与 package.json name 保持一致',
  'duplicate-row-id': 'row id 唯一（tool-xxx 每行一个）',
  'unexpected-fields': 'insert 条目只保留 id/name（config 等嵌套字段移出）',
  'no-source-entry': '创建 src/index.ts（name/inject/apply + defineTool）',
  'no-tsconfig': '创建 tsconfig.json（allowImportingTsExtensions + rewriteRelativeImportExtensions + outDir lib）',
  'missing-ts-ext-imports': 'tsconfig 补 "allowImportingTsExtensions": true',
  'missing-rewrite-imports': 'tsconfig 补 "rewriteRelativeImportExtensions": true（产物自动改写 .js）',
  'lib-layout-mismatch': 'tsconfig outDir 与 package.json main 的 lib/ 前缀一致',
  'types-path-mismatch': 'tsconfig declarationDir 与 package.json types 前缀一致',
  'implicit-node-types': 'tsconfig 显式声明 "types": ["node"]（避免隐式 @types 包含的脆弱性）',
  'stale-ts-imports': '重新构建 lib/（产物相对导入必须是 .js）',
  'no-build-script': 'package.json 补 scripts.build / scripts.prepack（clean checkout 可复现构建）',
  'not-in-hub': '在 hub 仓库 catalog.source.json 登记（category: plugin），或等 2 小时自动同步',
  'hub-skipped': 'hub 状态未能检查（离线/无 gh）——非仓库问题',
}

export function isErrorCode(code: string): boolean {
  return ERROR_CODES.has(code)
}

/** 聚合单仓库报告。 */
export function buildRepoReport(
  repo: string,
  path: string,
  issues: CheckIssue[],
  strict: boolean,
): RepoReport {
  const errors = issues.filter(i => isErrorCode(i.code) || (strict && !ERROR_CODES.has(i.code) && i.code !== 'hub-skipped'))
  const warnings = issues.filter(i => !errors.includes(i) && i.code !== 'hub-skipped')
  const skipped = issues.filter(i => i.code === 'hub-skipped').map(i => i.detail)
  const verdict = errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass'
  const suggestions = [...new Set(issues.map(i => SUGGESTION_TEMPLATES[i.code] ?? `处理问题 ${i.code}: ${i.detail}`))]
  return {
    repo, path, verdict,
    errors, warnings, skipped,
    checks: { total: issues.length, passed: issues.length - errors.length },
    suggestions,
  }
}

/** 检测项元数据（schema action 输出，与检测实现同步维护）。 */
export const CHECK_SCHEMA: Array<{ code: string; severity: 'error' | 'warning' | 'info'; description: string }> = [
  { code: 'no-manifest', severity: 'error', description: 'package.json 缺失或非法' },
  { code: 'invalid-name', severity: 'error', description: 'name 非 @deepseek-ai/* 或 dsh-* 规范名' },
  { code: 'missing-main-or-types', severity: 'error', description: 'main/types 未声明或指向不存在文件' },
  { code: 'incomplete-files', severity: 'warning', description: 'files 缺 lib/src/cordis.patch.yml' },
  { code: 'missing-peer', severity: 'warning', description: 'peerDependencies 缺 cordis/dsh-tools' },
  { code: 'no-bundle-decl', severity: 'warning', description: '缺 dsh.bundle.patch 声明（registry 形态跳过）' },
  { code: 'no-patch', severity: 'error', description: 'bundle 形态缺 cordis.patch.yml' },
  { code: 'malformed-patch', severity: 'error', description: 'patch 非 - insert: 结构或条目缺字段' },
  { code: 'patch-name-mismatch', severity: 'error', description: 'patch name 与 package.json name 不一致' },
  { code: 'duplicate-row-id', severity: 'error', description: '重复 row id' },
  { code: 'unexpected-fields', severity: 'warning', description: 'insert 条目含非预期字段' },
  { code: 'no-source-entry', severity: 'error', description: 'src/index.ts 缺失' },
  { code: 'no-tsconfig', severity: 'error', description: 'tsconfig.json 缺失或非法' },
  { code: 'missing-ts-ext-imports', severity: 'error', description: 'src 用 .ts 导入但缺 allowImportingTsExtensions' },
  { code: 'missing-rewrite-imports', severity: 'warning', description: '缺 rewriteRelativeImportExtensions（产物残留 .ts）' },
  { code: 'lib-layout-mismatch', severity: 'error', description: 'tsconfig outDir 与 main 前缀不一致' },
  { code: 'types-path-mismatch', severity: 'warning', description: 'declarationDir 与 types 前缀不一致' },
  { code: 'implicit-node-types', severity: 'warning', description: '用 Buffer/node: 但 tsconfig 未显式 types:["node"]' },
  { code: 'stale-ts-imports', severity: 'error', description: 'lib/ 产物残留 .ts 相对导入（运行时必崩）' },
  { code: 'no-build-script', severity: 'warning', description: '缺 scripts.build/prepack（clean checkout 不可复现）' },
  { code: 'not-in-hub', severity: 'warning', description: '未收录进 hub catalog' },
  { code: 'hub-skipped', severity: 'info', description: 'hub 状态检查被跳过（离线/无 gh）' },
]
