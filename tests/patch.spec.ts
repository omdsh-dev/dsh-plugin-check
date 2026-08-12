import { describe, expect, it } from 'vitest'
import { parsePatchSections, parsePatchInsert, checkPatch } from '../src/patch.ts'
import { goodPlugin, makePlugin } from './helpers.ts'

describe('parsePatchSections: 行级解析 v2（审查 PC-03）', () => {
  it('parses a valid insert list with inline ids', () => {
    const { entries, errors } = parsePatchInsert(`# comment
- insert:
    - id: tool-a
      name: '@deepseek-ai/a'
    - id: tool-b
      name: '@deepseek-ai/b'
`)
    expect(errors).toEqual([])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ id: 'tool-a', name: '@deepseek-ai/a' })
    expect(entries[1]).toMatchObject({ id: 'tool-b', name: '@deepseek-ai/b' })
  })

  it('strips inline comments (PC-03)', () => {
    const { entries } = parsePatchInsert('- insert:\n    - id: tool-a # comment\n      name: x\n')
    expect(entries[0]?.id).toBe('tool-a')
  })

  it('keeps config as a legal field and absorbs nested lines (X-02)', () => {
    const sections = parsePatchSections(`- insert:
    - id: tool-x
      name: '@deepseek-ai/x'
      config:
        key: value
        nested:
          deep: 1
`)
    expect(sections).toHaveLength(1)
    expect(sections[0]?.op).toBe('insert')
    expect(sections[0]?.entries[0]?.fields).toContain('config')
    expect(sections[0]?.errors).toEqual([])
  })

  it('absorbs first-level config children and deeper nesting (Issue #1)', () => {
    const sections = parsePatchSections(`- insert:
    - id: tool-example
      name: '@deepseek-ai/tool-example'
      config:
        maxItems: 100
        fetchTimeoutMs: 5000
        nested:
          enabled: true
`)
    expect(sections[0]?.errors).toEqual([])
    expect(sections[0]?.entries[0]?.fields).toEqual(['config'])
  })

  it('accepts lists inside config without parsing their items (Issue #1)', () => {
    const sections = parsePatchSections(`- insert:
    - id: tool-x
      config:
        items:
          - one
          - two
`)
    expect(sections[0]?.errors).toEqual([])
    expect(sections[0]?.entries[0]?.fields).toEqual(['config'])
  })

  it('does not report nested config fields as unexpected-fields via checkPatch (Issue #1)', async () => {
    const dir = makePlugin({
      'cordis.patch.yml': `- insert:
    - id: tool-x
      name: '@deepseek-ai/x'
      config:
        maxItems: 10
        fetchTimeoutMs: 1000
        cacheTtlMs: 5000
        nested:
          enabled: true
`,
    })
    const issues = await checkPatch(dir, 'bundle', undefined)
    expect(issues.map(i => i.code)).not.toContain('unexpected-fields')
    expect(issues.map(i => i.code)).not.toContain('malformed-patch')
  })

  it('still reports unknown top-level fields (Issue #1 regression guard)', async () => {
    const dir = makePlugin({
      'cordis.patch.yml': `- insert:
    - id: tool-x
      metadata:
        internal: true
`,
    })
    const issues = await checkPatch(dir, 'bundle', undefined)
    expect(issues.map(i => i.code)).toContain('unexpected-fields')
  })

  it('supports update/disable sections without treating them as malformed (PC-03)', () => {
    const sections = parsePatchSections(`- insert:
    - id: a
      name: '@deepseek-ai/a'
- update:
    - id: a
      config:
        key: v
- disable:
    - id: b
`)
    expect(sections.map(s => s.op)).toEqual(['insert', 'update', 'disable'])
    expect(sections.every(s => s.errors.length === 0)).toBe(true)
  })

  it('reports entries missing id', () => {
    const { errors } = parsePatchInsert('- insert:\n    - name: only-name\n')
    expect(errors.join('; ')).toContain('missing id')
  })

  it('reports unknown top-level entries', () => {
    const sections = parsePatchSections('- foo:\n    - id: x\n')
    expect(sections[0]?.op).toBe('unknown')
    expect(sections[0]?.errors.join('; ')).toContain('unknown top-level entry')
  })
})

describe('checkPatch: 仓库级检查（kind 感知）', () => {
  it('passes a compliant tool-bundle patch', async () => {
    const dir = goodPlugin()
    expect(await checkPatch(dir, 'tool-bundle', '@deepseek-ai/dsh-tool-good')).toEqual([])
  })

  it('reports patch-name-mismatch only for tool-bundle (PC-02: bundle 多包合法)', async () => {
    const dir = makePlugin({
      'cordis.patch.yml': "- insert:\n    - id: tool-x\n      name: '@deepseek-ai/other'\n",
    })
    const toolIssues = await checkPatch(dir, 'tool-bundle', '@deepseek-ai/real')
    expect(toolIssues.map(i => i.code)).toContain('patch-name-mismatch')
    const bundleIssues = await checkPatch(dir, 'bundle', '@deepseek-ai/real')
    expect(bundleIssues.map(i => i.code)).not.toContain('patch-name-mismatch')
  })

  it('reports duplicate-row-id', async () => {
    const dir = makePlugin({
      'cordis.patch.yml': `- insert:
    - id: tool-x
      name: '@deepseek-ai/a'
    - id: tool-x
      name: '@deepseek-ai/b'
`,
    })
    const issues = await checkPatch(dir, 'bundle', '@deepseek-ai/a')
    expect(issues.map(i => i.code)).toContain('duplicate-row-id')
  })

  it('reports malformed-patch for structural errors', async () => {
    const dir = makePlugin({ 'cordis.patch.yml': '- insert:\n    - id: x\n' }) // 缺 name 不报错（name 可选）；缺 id 才报
    const issues = await checkPatch(dir, 'tool-bundle', '@deepseek-ai/a')
    expect(issues.map(i => i.code)).not.toContain('malformed-patch')
    const bad = makePlugin({ 'cordis.patch.yml': 'garbage line\n' })
    expect((await checkPatch(bad, 'bundle', undefined)).map(i => i.code)).toContain('malformed-patch')
  })

  it('returns no issues when cordis.patch.yml is absent (reported by manifest)', async () => {
    const dir = makePlugin({ 'package.json': '{}' })
    expect(await checkPatch(dir, 'bundle', undefined)).toEqual([])
  })
})

describe('生态：multi-row patch 与 override config（plan §4.5/§7）', () => {
  it('一次 insert 多个 row：全部条目解析，无重复 row id 误报', () => {
    const sections = parsePatchSections(`- insert:
    - id: tool-a
      name: '@deepseek-ai/a'
    - id: tool-b
      name: '@deepseek-ai/b'
      config:
        mode: native
`)
    expect(sections[0]?.entries).toHaveLength(2)
    expect(sections[0]?.errors).toEqual([])
    expect(sections[0]?.entries.map(e => e.id)).toEqual(['tool-a', 'tool-b'])
  })

  it('override config（update + config 整块重述）合法', () => {
    const sections = parsePatchSections(`- id: tools
  config:
    mode: native
`)
    expect(sections[0]?.op).toBe('update')
    expect(sections[0]?.entries[0]?.fields).toContain('config')
  })
})
