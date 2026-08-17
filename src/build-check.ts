/**
 * §3.3 构建陷阱检查 v2 —— 审查 PC-05/PC-06/PC-08/PC-11 修复。
 *
 * - tsconfig `extends` 递归解析（共享 base 模式不再误报；解析失败标 skipped）；
 * - 导入扫描覆盖 from / import() / require() / 副作用 import / .tsx/.mts/.cts；
 *   lib 额外扫描 `new URL('./x.ts')`（worker 入口残留）；
 * - 文件收集带资源预算（文件数/总字节）且 lstat 拒绝 symlink；
 * - 动态严重度：src 用 .ts 导入 + 缺 rewrite → error（确定性运行时崩溃）；
 *   lib 缺失 + 无 build 脚本 → error（clean checkout 无入口）。
 */

import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { collectTextsBounded } from './paths.ts'
import type { RepoKind } from './form.ts'
import type { CheckIssue } from './report.ts'

/** 相对 .ts 系导入：from / import() / require() / 副作用 import。 */
const TS_IMPORT_RE = /(?:(?:from|import)\s+|import\s*\(|require\s*\()['"]((?:\.\.?\/)[^'"]+\.(?:ts|tsx|mts|cts))['"]/g
/** lib 产物额外检查：worker URL 等 new URL('.ts') 残留。 */
const TS_URL_RE = /new URL\s*\(\s*['"]((?:\.\.?\/)[^'"]+\.(?:ts|tsx|mts|cts))['"]/g

export interface ResolvedTsconfig {
  compilerOptions: Record<string, unknown>
  /** extends 链是否全部解析成功。 */
  resolved: boolean
  /** 解析失败原因（resolved=false 时）。 */
  skipReason?: string
}

const EXTENDS_MAX_DEPTH = 5

/** 递归解析 tsconfig（extends 相对文件路径；深度上限；失败返回 resolved:false）。 */
export async function resolveTsconfig(dir: string): Promise<ResolvedTsconfig | null> {
  const read = async (filePath: string, depth: number): Promise<{ opts: Record<string, unknown>; ok: boolean; reason?: string }> => {
    if (depth > EXTENDS_MAX_DEPTH) return { opts: {}, ok: false, reason: `extends 深度超过 ${EXTENDS_MAX_DEPTH}` }
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch {
      return { opts: {}, ok: false, reason: `extends 目标不可读: ${filePath}` }
    }
    let cfg: Record<string, unknown>
    try {
      cfg = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return { opts: {}, ok: false, reason: `extends 目标非法 JSON: ${filePath}` }
    }
    const opts: Record<string, unknown> = {}
    const ext = cfg['extends']
    if (typeof ext === 'string') {
      // 仅支持相对路径 extends（npm 包形式的 extends 无法离线解析 → skipped）
      if (ext.startsWith('.')) {
        const parent = resolve(filePath, '..', ext)
        const r = await read(parent, depth + 1)
        if (!r.ok) return r
        Object.assign(opts, r.opts)
      } else {
        return { opts: {}, ok: false, reason: `无法离线解析包形式 extends: ${ext}` }
      }
    }
    Object.assign(opts, (cfg['compilerOptions'] ?? {}) as Record<string, unknown>)
    return { opts, ok: true }
  }

  try {
    await fs.access(join(dir, 'tsconfig.json'))
  } catch {
    return null // 无 tsconfig：调用方报 no-tsconfig
  }
  const r = await read(join(dir, 'tsconfig.json'), 0)
  if (!r.ok) return { compilerOptions: {}, resolved: false, skipReason: r.reason }
  return { compilerOptions: r.opts, resolved: true }
}

function hasTsImport(texts: string[]): boolean {
  return codeLines(texts).some(t => {
    TS_IMPORT_RE.lastIndex = 0
    return TS_IMPORT_RE.test(t)
  })
}

function hasWorkerTsUrl(texts: string[]): boolean {
  return codeLines(texts).some(t => {
    TS_URL_RE.lastIndex = 0
    return TS_URL_RE.test(t)
  })
}

/** 抽取非注释行（`//`、`/*`、`*` 开头），避免注释里的模式串误报。 */
function codeLines(texts: string[]): string[] {
  const out: string[] = []
  for (const text of texts) {
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue
      out.push(line)
    }
  }
  return out
}

function usesBufferOrNode(texts: string[]): boolean {
  return texts.some(t => /Buffer\./.test(t) || /\bfrom ['"]node:/.test(t))
}

/** `child` 是否位于 `parent` 目录内部（含相等；规范化路径判断，非字符串前缀）。 */
function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (
    rel !== '..' &&
    !rel.startsWith('..' + sep) &&
    !rel.startsWith(sep)
  )
}

/** 静态构建陷阱检查。tool-bundle 检查 TypeScript 源码与 tsconfig；
 * 普通 bundle 只检查已发布 lib 产物和 build/prepack/prepare 信号。 */
export async function checkBuildPitfalls(
  dir: string,
  kind: RepoKind,
  pkg: Record<string, unknown> | null,
): Promise<CheckIssue[]> {
  const issues: CheckIssue[] = []
  const isToolBundle = kind === 'tool-bundle'

  if (isToolBundle) {
    const srcDir = join(dir, 'src')
    let srcEntry = false
    try {
      await fs.access(join(srcDir, 'index.ts'))
      srcEntry = true
    } catch { /* 缺失 */ }
    if (!srcEntry) issues.push({ code: 'no-source-entry', detail: 'src/index.ts 缺失' })

    const tsconfig = await resolveTsconfig(dir)
    if (tsconfig === null) issues.push({ code: 'no-tsconfig', detail: 'tsconfig.json 缺失或非法 JSON' })
    else if (!tsconfig.resolved) issues.push({ code: 'tsconfig-extends-unresolved', detail: `tsconfig extends 无法解析：${tsconfig.skipReason}——相关检查跳过` })

    const { texts: srcTexts, truncated: srcTruncated } = await collectTextsBounded(srcDir, ['.ts', '.tsx'])
    const srcUsesTsImports = hasTsImport(srcTexts)
    if (tsconfig !== null && tsconfig.resolved) {
      const opts = tsconfig.compilerOptions
      const allowTsExt = opts['allowImportingTsExtensions'] === true
      const rewriteTsExt = opts['rewriteRelativeImportExtensions'] === true
      const outDir = opts['outDir']
      const declarationDir = opts['declarationDir']
      const hasExplicitNodeTypes = Array.isArray(opts['types']) && (opts['types'] as unknown[]).includes('node')
      if (srcUsesTsImports && !allowTsExt) issues.push({ code: 'missing-ts-ext-imports', detail: 'src 用了 .ts 相对导入但最终 tsconfig 缺 allowImportingTsExtensions（TS5097）' })
      if (srcUsesTsImports && allowTsExt && !rewriteTsExt) issues.push({ code: 'missing-rewrite-imports', detail: '缺 rewriteRelativeImportExtensions——产物会残留 .ts 导入，运行时 ESM 崩溃' })
      if (pkg && typeof outDir === 'string' && typeof pkg['main'] === 'string') {
        const mainPath = resolve(dir, pkg['main'])
        const mainDir = dirname(mainPath)
        const outDirPath = resolve(dir, outDir)
        const sameLayout = mainDir === outDirPath
        let declarationSeparated = false
        if (typeof pkg['types'] === 'string') {
          const typesPath = resolve(dir, pkg['types'])
          declarationSeparated = mainDir !== outDirPath && isPathInside(mainDir, outDirPath) && isPathInside(outDirPath, typesPath)
        }
        if (!sameLayout && !declarationSeparated) issues.push({ code: 'lib-layout-mismatch', detail: `最终 tsconfig outDir "${outDir}" 与 main "${pkg['main']}" 布局不一致` })
      }
      if (pkg && typeof declarationDir === 'string' && typeof pkg['types'] === 'string') {
        const typesDir = pkg['types'].split('/')[0]
        if (typesDir !== declarationDir.split('/')[0]) issues.push({ code: 'types-path-mismatch', detail: `最终 tsconfig declarationDir "${declarationDir}" 与 types "${pkg['types']}" 前缀不一致` })
      }
      if (usesBufferOrNode(srcTexts) && !hasExplicitNodeTypes) issues.push({ code: 'implicit-node-types', detail: 'src 用 Buffer/node: 但最终 tsconfig 未显式声明 types: ["node"]' })
    }
    if (srcTruncated) issues.push({ code: 'scan-truncated', detail: 'src 扫描超过资源预算被截断——检查可能不完整' })
  }

  // lib 产物残留和脚本是普通 bundle 与 tool-bundle 的共同发布检查。
  const { texts: libTexts } = await collectTextsBounded(join(dir, 'lib'), ['.js', '.mjs', '.cjs'])
  const staleTs = hasTsImport(libTexts) || hasWorkerTsUrl(libTexts)
  const libEntryExists = libTexts.length > 0
  const scripts = (pkg?.['scripts'] ?? {}) as Record<string, unknown>
  const hasBuild = typeof scripts['build'] === 'string'
  const hasPrepack = typeof scripts['prepack'] === 'string'
  const hasPrepare = typeof scripts['prepare'] === 'string'
  const hasBuildPath = hasBuild || hasPrepare
  if (!hasBuildPath || !hasPrepack) {
    if (!libEntryExists && !hasBuildPath) issues.push({ code: 'no-build-entry', detail: 'lib/ 不存在且无 scripts.build/prepare——clean checkout 无法生成运行入口' })
    else {
      if (!hasBuild && !hasPrepare) issues.push({ code: 'no-build-script', detail: 'package.json 缺 scripts.build（或 Git 安装型补 scripts.prepare）' })
      if (!hasPrepack) issues.push({ code: 'no-build-script', detail: 'package.json 缺 scripts.prepack（发布 tarball 可能缺 lib）' })
    }
  }
  if (staleTs) issues.push({ code: 'stale-ts-imports', detail: 'lib/ 产物存在 .ts 相对导入/worker URL 残留——运行时 ESM 必崩（重新构建）' })
  return issues
}
