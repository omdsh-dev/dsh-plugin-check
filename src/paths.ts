/**
 * 路径围栏与资源预算工具 —— 审查 PC-04/PC-08 修复。
 * 所有声明路径（main/types/dsh.bundle.patch/registry main/client.main）都必须
 * 落在仓库根内：拒绝绝对路径、词法 `..` 逃逸、symlink 指向根外、非普通文件。
 */

import { promises as fs } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'

export type ContainmentResult =
  | { ok: true; path: string }
  | { ok: false; reason: string }

/** 词法校验：拒绝绝对路径与 `..` 段（统一 resolve 后的分隔符形态）。 */
function lexicalSafe(root: string, target: string): boolean {
  if (isAbsolute(target)) return false
  const rootResolved = resolve(root)
  const resolved = resolve(root, target)
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) return false
  return true
}

/**
 * 声明路径 containment：词法 + 真实路径（realpath）双重校验。
 * 目标必须是仓库根内的普通文件（lstat 拒绝 symlink；realpath 兜底防 junction 逃逸）。
 */
export async function resolveWithin(root: string, target: string): Promise<ContainmentResult> {
  if (target === '') return { ok: false, reason: '空路径' }
  if (!lexicalSafe(root, target)) {
    return { ok: false, reason: `路径逃逸仓库根（绝对路径或 ../）: ${target}` }
  }
  const full = join(root, target)
  let st
  try {
    st = await fs.lstat(full)
  } catch {
    return { ok: false, reason: `文件不存在: ${target}` }
  }
  if (st.isSymbolicLink()) return { ok: false, reason: `符号链接不允许: ${target}` }
  if (!st.isFile()) return { ok: false, reason: `不是普通文件: ${target}` }
  // realpath 兜底：junction 指向根外
  const rootReal = await fs.realpath(root)
  const targetReal = await fs.realpath(full)
  if (targetReal !== rootReal && !targetReal.startsWith(rootReal + sep)) {
    return { ok: false, reason: `真实路径逃逸仓库根: ${target}` }
  }
  return { ok: true, path: full }
}

/** npm 包名校验（PC-07）：近似 validate-npm-package-name 的零依赖子集。 */
export function isValidPackageName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 214) return false
  if (name.startsWith('.') || name.startsWith('_') || /[A-Z\s~'!()*]/.test(name)) return false
  const segments = name.startsWith('@') ? name.slice(1).split('/') : [name]
  if (segments.length === 2 && segments[0] === '') return false
  if (segments.length > 2 || segments.some(segment =>
    segment.length === 0 ||
    !/^[a-z0-9][a-z0-9._~-]*$/.test(segment) ||
    /^[-.]/.test(segment),
  )) return false
  return name.startsWith('@') ? segments.length === 2 : segments.length === 1
}

/** 组织命名政策：当前生态组织 scopes 与 dsh-* 前缀（前缀后必须有实际名称）。 */
export function matchesOrgPolicy(name: string): boolean {
  return (name.startsWith('@deepseek-ai/') && name.length > '@deepseek-ai/'.length)
    || (name.startsWith('@dsh-external/') && name.length > '@dsh-external/'.length)
    || (name.startsWith('@omdsh/') && name.length > '@omdsh/'.length)
    || (name.startsWith('dsh-') && name.length > 'dsh-'.length)
}

/** 最小 semver 版本格式校验。 */
export function isValidSemver(version: unknown): version is string {
  return typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
}

/** 最小 semver range 校验（^ ~ >= <= > < 或裸版本或 *）。 */
export function isValidSemverRange(range: unknown): range is string {
  if (typeof range !== 'string') return false
  const trimmed = range.trim()
  if (trimmed === '*' || trimmed === '') return true
  const parts = trimmed.split(/\s*\|\|\s*/)
  return parts.every(p =>
    /^(?:\^|~|>=|<=|>|<)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(p.trim()),
  )
}

/** 资源预算：lstat 收集文件（跳过 symlink），带文件数与总字节上限。 */
export interface ScanBudget {
  maxFiles: number
  maxBytes: number
}

export const DEFAULT_SCAN_BUDGET: ScanBudget = { maxFiles: 400, maxBytes: 4 * 1024 * 1024 }

export async function collectTextsBounded(
  dir: string,
  exts: string[],
  budget: ScanBudget = DEFAULT_SCAN_BUDGET,
  maxDepth = 8,
): Promise<{ texts: string[]; truncated: boolean }> {
  const texts: string[] = []
  let files = 0
  let bytes = 0
  let truncated = false
  const walk = async (p: string, depth: number): Promise<void> => {
    if (depth > maxDepth || truncated) return
    let entries: string[] = []
    try { entries = await fs.readdir(p) } catch { return }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.git' || e.startsWith('.')) continue
      const full = join(p, e)
      let st
      try { st = await fs.lstat(full) } catch { continue }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) { await walk(full, depth + 1); continue }
      if (!exts.some(x => e.endsWith(x))) continue
      if (files >= budget.maxFiles || bytes >= budget.maxBytes) { truncated = true; return }
      try {
        const text = await fs.readFile(full, 'utf8')
        files++
        bytes += Buffer.byteLength(text)
        texts.push(text)
      } catch { /* 跳过 */ }
    }
  }
  await walk(dir, 0)
  return { texts, truncated }
}
