/**
 * §3.3 构建陷阱检查 —— 静态扫描，不执行 tsc：
 * tsconfig 三件套、lib 布局一致性、src/lib 的 `.ts` 相对导入残留、
 * node types 显式性、build/prepack 脚本（发布门禁）。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { CheckIssue } from './report.ts'

const TS_RELATIVE_IMPORT_RE = /from\s+['"]\.\.?\/[^'"]+\.ts['"]/

/** 收集目录下全部 .ts/.js 文件内容（深度 ≤3，跳过 node_modules）。 */
async function collectTexts(dir: string, depth: number, maxDepth: number, ext: 'ts' | 'js'): Promise<string[]> {
  const out: string[] = []
  if (depth > maxDepth) return out
  let entries: string[] = []
  try {
    entries = await fs.readdir(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const full = join(dir, e)
    let stat
    try { stat = await fs.stat(full) } catch { continue }
    if (stat.isDirectory()) {
      out.push(...await collectTexts(full, depth + 1, maxDepth, ext))
    } else if (e.endsWith(`.${ext}`)) {
      try { out.push(await fs.readFile(full, 'utf8')) } catch { /* 跳过 */ }
    }
  }
  return out
}

function hasTsRelativeImport(texts: string[]): boolean {
  return texts.some(t => TS_RELATIVE_IMPORT_RE.test(t))
}

function usesBufferOrNode(texts: string[]): boolean {
  return texts.some(t => /Buffer\./.test(t) || /\bfrom ['"]node:/.test(t))
}

/** 静态构建陷阱检查。 */
export async function checkBuildPitfalls(dir: string, pkg: Record<string, unknown> | null): Promise<CheckIssue[]> {
  const issues: CheckIssue[] = []
  const srcDir = join(dir, 'src')

  // src 入口
  let srcEntry = false
  try {
    await fs.access(join(srcDir, 'index.ts'))
    srcEntry = true
  } catch { /* 缺失 */ }
  if (!srcEntry) {
    issues.push({ code: 'no-source-entry', detail: 'src/index.ts 缺失' })
  }

  // tsconfig
  let tsconfig: Record<string, unknown> | null = null
  try {
    tsconfig = JSON.parse(await fs.readFile(join(dir, 'tsconfig.json'), 'utf8')) as Record<string, unknown>
  } catch {
    issues.push({ code: 'no-tsconfig', detail: 'tsconfig.json 缺失或非法 JSON' })
  }

  const srcTexts = await collectTexts(srcDir, 0, 3, 'ts')
  const srcUsesTsImports = hasTsRelativeImport(srcTexts)

  if (tsconfig) {
    const opts = (tsconfig['compilerOptions'] ?? {}) as Record<string, unknown>
    const allowTsExt = opts['allowImportingTsExtensions'] === true
    const rewriteTsExt = opts['rewriteRelativeImportExtensions'] === true
    const outDir = opts['outDir']
    const declarationDir = opts['declarationDir']
    const hasExplicitNodeTypes = Array.isArray(opts['types']) && (opts['types'] as unknown[]).includes('node')

    // 三件套
    if (srcUsesTsImports && !allowTsExt) {
      issues.push({ code: 'missing-ts-ext-imports', detail: 'src 用了 .ts 相对导入但 tsconfig 缺 allowImportingTsExtensions（TS5097）' })
    }
    if (srcUsesTsImports && allowTsExt && !rewriteTsExt) {
      issues.push({ code: 'missing-rewrite-imports', detail: '缺 rewriteRelativeImportExtensions——产物会残留 .ts 导入，运行时 ESM 崩溃' })
    }
    // lib 布局一致性
    if (pkg && typeof outDir === 'string' && typeof pkg['main'] === 'string') {
      const mainDir = pkg['main'].split('/')[0]
      if (mainDir !== outDir) {
        issues.push({ code: 'lib-layout-mismatch', detail: `tsconfig outDir "${outDir}" 与 main "${pkg['main']}" 前缀不一致` })
      }
    }
    // types 路径一致性（比较首段）
    if (pkg && typeof declarationDir === 'string' && typeof pkg['types'] === 'string') {
      const typesDir = pkg['types'].split('/')[0]
      if (typesDir !== declarationDir.split('/')[0]) {
        issues.push({ code: 'types-path-mismatch', detail: `tsconfig declarationDir "${declarationDir}" 与 types "${pkg['types']}" 前缀不一致` })
      }
    }
    // node types 显式性（坑 3：Buffer 用户靠隐式包含是脆弱的）
    if (usesBufferOrNode(srcTexts) && !hasExplicitNodeTypes) {
      issues.push({ code: 'implicit-node-types', detail: 'src 用 Buffer/node: 但 tsconfig 未显式声明 types: ["node"]（靠隐式 @types 包含，建议显式）' })
    }
  }

  // lib 产物残留 .ts 导入（运行时必崩）
  const libTexts = await collectTexts(join(dir, 'lib'), 0, 2, 'js')
  if (hasTsRelativeImport(libTexts)) {
    issues.push({ code: 'stale-ts-imports', detail: 'lib/ 产物存在 .ts 相对导入残留——运行时 ESM 必崩（重新构建）' })
  }

  // build/prepack 脚本（TK-01 发布门禁：lib 不入库时 clean checkout 无入口）
  if (pkg) {
    const scripts = (pkg['scripts'] ?? {}) as Record<string, unknown>
    if (typeof scripts['build'] !== 'string') {
      issues.push({ code: 'no-build-script', detail: 'package.json 缺 scripts.build（clean checkout 无法构建入口）' })
    }
    if (typeof scripts['prepack'] !== 'string') {
      issues.push({ code: 'no-build-script', detail: 'package.json 缺 scripts.prepack（发布 tarball 可能缺 lib）' })
    }
  }

  return issues
}
