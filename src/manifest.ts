/**
 * bundle 形态清单协议检查（审查 PC-02/PC-04/PC-07 修复）：
 * 只适用于 bundle / tool-bundle；main/types 与 dsh.bundle.patch 走真实路径 containment；
 * name 用完整 npm 规则 + 组织政策校验。registry/skill/collection 由各自模块处理。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { isValidPackageName, matchesOrgPolicy, resolveWithin } from './paths.ts'
import type { CheckIssue } from './report.ts'

export interface ManifestResult {
  issues: CheckIssue[]
  pkg: Record<string, unknown> | null
}

/** 检查 bundle 仓库的 package.json 清单协议。 */
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

  // name：完整 npm 规则 + 组织政策（PC-07）
  const name = pkg['name']
  if (typeof name !== 'string' || !isValidPackageName(name)) {
    issues.push({ code: 'invalid-name-format', detail: `name 不符合 npm 包名规则: ${String(name)}` })
  } else if (!matchesOrgPolicy(name)) {
    issues.push({ code: 'non-org-recommended-name', detail: `name 虽符合 npm 规则但不在推荐组织范围（@deepseek-ai/*、@dsh-external/*、@omdsh/* 或 dsh-*）：${name}` })
  }

  // main/types：containment（PC-04）
  for (const field of ['main', 'types'] as const) {
    const target = pkg[field]
    if (typeof target !== 'string' || target === '') {
      issues.push({ code: 'missing-main-or-types', detail: `${field} 未声明` })
      continue
    }
    const r = await resolveWithin(dir, target)
    if (!r.ok) {
      issues.push({ code: 'missing-main-or-types', detail: `${field} 无效: ${r.reason}` })
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

  // peer 依赖（工具插件需 dsh-tools + cordis；npm rc.1 为 scoped @deepseek-ai/cordis）
  const peers = pkg['peerDependencies']
  if (!peers || typeof peers !== 'object') {
    issues.push({ code: 'missing-peer', detail: 'peerDependencies 未声明' })
  } else {
    const peerKeys = Object.keys(peers as Record<string, unknown>)
    if (!peerKeys.includes('@deepseek-ai/cordis') && !peerKeys.includes('cordis')) {
      issues.push({ code: 'missing-peer', detail: 'peerDependencies 缺少 cordis（npm rc.1 为 @deepseek-ai/cordis）' })
    }
  }

  // dsh.bundle.patch：必须声明且目标存在、在根内（PC-04）
  const bundle = pkg['dsh'] as Record<string, unknown> | undefined
  const patchDecl = bundle && typeof bundle === 'object'
    ? (bundle['bundle'] as Record<string, unknown> | undefined)?.['patch']
    : undefined
  if (typeof patchDecl !== 'string' || patchDecl === '') {
    issues.push({ code: 'no-bundle-decl', detail: '缺少 dsh.bundle.patch 声明（registry 形态走 dsh.plugin.json）' })
  } else {
    const r = await resolveWithin(dir, patchDecl)
    if (!r.ok) {
      issues.push({ code: 'no-bundle-decl', detail: `dsh.bundle.patch 无效: ${r.reason}` })
    }
  }

  return { issues, pkg }
}
