/**
 * §3.1 清单协议检查 —— package.json 存在性、name 规范、main/types 指向、
 * files 完整性、peer 依赖、bundle 声明。只读。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { CheckIssue } from './report.ts'

export interface ManifestResult {
  issues: CheckIssue[]
  /** 解析出的 package.json（不存在时为 null）。 */
  pkg: Record<string, unknown> | null
}

const NAME_RE = /^@deepseek-ai\/|^dsh-/

/** 规范工具插件名（`@deepseek-ai/dsh-tool-*` 等）。 */
export function isValidPluginName(name: unknown): name is string {
  return typeof name === 'string' && NAME_RE.test(name)
}

/** 是否为工具插件（src 里 import @deepseek-ai/dsh-tools）。 */
export function looksLikeToolPlugin(srcFiles: string[]): boolean {
  return srcFiles.some(f => /import .*['"]@deepseek-ai\/dsh-tools['"]/.test(f))
}

/** 检查单个插件仓库目录的清单协议。 */
export async function checkManifest(dir: string): Promise<ManifestResult> {
  const issues: CheckIssue[] = []
  const manifestPath = join(dir, 'package.json')
  let pkg: Record<string, unknown> | null = null
  try {
    pkg = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>
  } catch {
    issues.push({ code: 'no-manifest', detail: 'package.json 缺失或非法 JSON' })
    return { issues, pkg: null }
  }

  // name 规范
  if (!isValidPluginName(pkg['name'])) {
    issues.push({ code: 'invalid-name', detail: `name 应为 @deepseek-ai/* 或 dsh-* 规范名，实际: ${String(pkg['name'])}` })
  }

  // main/types 指向存在文件
  for (const field of ['main', 'types'] as const) {
    const target = pkg[field]
    if (typeof target !== 'string' || target === '') {
      issues.push({ code: 'missing-main-or-types', detail: `${field} 未声明` })
      continue
    }
    try {
      await fs.access(join(dir, target))
    } catch {
      issues.push({ code: 'missing-main-or-types', detail: `${field} 指向不存在的文件: ${target}` })
    }
  }

  // files 完整性
  const files = pkg['files']
  if (!Array.isArray(files)) {
    issues.push({ code: 'incomplete-files', detail: 'files 未声明（发布 tarball 可能缺入口）' })
  } else {
    for (const required of ['lib', 'src', 'cordis.patch.yml']) {
      if (!files.includes(required)) {
        issues.push({ code: 'incomplete-files', detail: `files 缺少 ${required}` })
      }
    }
  }

  // peer 依赖（工具插件需 dsh-tools + cordis）
  const peers = pkg['peerDependencies']
  const isTool = looksLikeToolPlugin(await srcFilesOf(dir))
  if (!peers || typeof peers !== 'object') {
    issues.push({ code: 'missing-peer', detail: 'peerDependencies 未声明' })
  } else {
    const peerKeys = Object.keys(peers as Record<string, unknown>)
    if (!peerKeys.includes('cordis')) {
      issues.push({ code: 'missing-peer', detail: 'peerDependencies 缺少 cordis' })
    }
    if (isTool && !peerKeys.includes('@deepseek-ai/dsh-tools')) {
      issues.push({ code: 'missing-peer', detail: '工具插件 peerDependencies 缺少 @deepseek-ai/dsh-tools' })
    }
  }

  // bundle 声明（registry 形态跳过）
  const bundle = pkg['dsh'] as Record<string, unknown> | undefined
  const hasPatch = await fileExists(join(dir, 'cordis.patch.yml'))
  const hasRegistryManifest = await fileExists(join(dir, 'dsh.plugin.json'))
  if (!hasRegistryManifest && (!bundle || typeof bundle['bundle'] !== 'object')) {
    issues.push({ code: 'no-bundle-decl', detail: '缺少 dsh.bundle.patch 声明（registry 形态需 dsh.plugin.json）' })
  }
  if (!hasPatch && !hasRegistryManifest) {
    issues.push({ code: 'no-patch', detail: '缺少 cordis.patch.yml（bundle 形态必需）' })
  }

  return { issues, pkg }
}

/** 收集 src/*.ts 内容（供工具形态判断与构建检查共用）。 */
export async function srcFilesOf(dir: string): Promise<string[]> {
  const out: string[] = []
  try {
    const entries = await fs.readdir(join(dir, 'src'))
    for (const e of entries) {
      if (e.endsWith('.ts')) {
        out.push(await fs.readFile(join(dir, 'src', e), 'utf8'))
      }
    }
  } catch {
    // src 不存在：调用方按 no-source-entry 处理
  }
  return out
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
