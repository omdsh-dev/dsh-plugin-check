/**
 * §3.2 patch 格式检查 —— 极简 YAML 行解析 bundle patch 的 `- insert:` 结构，
 * 校验条目完整性、name 与包名一致性、row id 唯一性。
 *
 * 只支持 insert 形态（组织内 9 个插件全是此形态）；遇到复杂 patch
 * （- update:/- disable: 混合）按非预期字段/结构报 warning。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { CheckIssue } from './report.ts'

export interface PatchEntry {
  id: string
  name: string
  extraFields: string[]
}

/** 剥离 YAML 标量引号（'x' / "x"）。 */
function stripQuotes(value: string): string {
  const m = /^(['"])(.*)\1$/.exec(value)
  return m ? m[2]! : value
}

/** 解析 bundle patch 的 insert 列表（极简 YAML 子集：- insert: 下的 - id:/name: 行）。 */
export function parsePatchInsert(text: string): { entries: PatchEntry[]; errors: string[] } {
  const entries: PatchEntry[] = []
  const errors: string[] = []
  let inInsert = false
  let current: PatchEntry | undefined
  for (const raw of text.split('\n')) {
    const content = raw.trim()
    if (content === '' || content.startsWith('#')) continue
    if (content === '- insert:') { inInsert = true; continue }
    if (content.startsWith('- ')) {
      if (!inInsert) {
        errors.push(`unexpected content outside insert: ${content.slice(0, 40)}`)
        continue
      }
      // 新条目开始；实际格式为 `- id: xxx`（id 与破折号同行）或 `- name: xxx`
      const entryRe = /^- ([a-zA-Z][\w-]*):\s*(.*)$/
      const m = entryRe.exec(content)
      current = { id: '', name: '', extraFields: [] }
      entries.push(current)
      if (m) {
        const value = stripQuotes(m[2])
        if (m[1] === 'id') current.id = value
        else if (m[1] === 'name') current.name = value
        else current.extraFields.push(m[1])
      } else {
        errors.push(`unparseable entry line: ${content.slice(0, 40)}`)
      }
      continue
    }
    if (!inInsert) {
      errors.push(`unexpected content outside insert: ${content.slice(0, 40)}`)
      continue
    }
    const m = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(content)
    if (!m) { errors.push(`unparseable line: ${content.slice(0, 40)}`); continue }
    const [, key, value] = m
    if (current === undefined) { errors.push(`field outside entry: ${key}`); continue }
    if (key === 'id') current.id = stripQuotes(value)
    else if (key === 'name') current.name = stripQuotes(value)
    else current.extraFields.push(key)
  }
  for (const e of entries) {
    if (e.id === '') errors.push('entry missing id')
    if (e.name === '') errors.push(`entry ${e.id || '(unnamed)'} missing name`)
  }
  return { entries, errors }
}

/** 检查插件仓库的 cordis.patch.yml（bundle 形态）。 */
export async function checkPatch(dir: string, pkgName: string | null): Promise<CheckIssue[]> {
  const issues: CheckIssue[] = []
  const patchPath = join(dir, 'cordis.patch.yml')
  let text: string
  try {
    text = await fs.readFile(patchPath, 'utf8')
  } catch {
    return issues // no-patch 已在 manifest 检查中报告
  }
  const { entries, errors } = parsePatchInsert(text)
  if (errors.length > 0) {
    issues.push({ code: 'malformed-patch', detail: errors.slice(0, 3).join('; ') })
  }
  if (entries.length === 0 && errors.length === 0) {
    issues.push({ code: 'malformed-patch', detail: '没有解析到任何 insert 条目' })
  }
  // name 与 package.json 一致
  if (pkgName) {
    for (const e of entries) {
      if (e.name !== '' && e.name !== pkgName) {
        issues.push({ code: 'patch-name-mismatch', detail: `patch name "${e.name}" 与 package.json name "${pkgName}" 不一致` })
      }
    }
  }
  // row id 唯一
  const seen = new Set<string>()
  for (const e of entries) {
    if (e.id !== '') {
      if (seen.has(e.id)) issues.push({ code: 'duplicate-row-id', detail: `重复 row id: ${e.id}` })
      seen.add(e.id)
    }
  }
  // 非预期字段（config 等嵌套）→ warning
  for (const e of entries) {
    for (const f of e.extraFields) {
      issues.push({ code: 'unexpected-fields', detail: `条目 ${e.id || '(unnamed)'} 含非预期字段: ${f}` })
    }
  }
  return issues
}
