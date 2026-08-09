import { describe, expect, it } from 'vitest'
import { parsePatchInsert, checkPatch } from '../src/patch.ts'
import { goodPlugin, makePlugin } from './helpers.ts'

describe('parsePatchInsert: 极简 YAML 行解析', () => {
  it('parses a valid insert list', () => {
    const { entries, errors } = parsePatchInsert(`# comment
- insert:
    - id: tool-a
      name: '@deepseek-ai/a'
    - id: tool-b
      name: '@deepseek-ai/b'
`)
    expect(errors).toEqual([])
    expect(entries).toEqual([
      { id: 'tool-a', name: '@deepseek-ai/a', extraFields: [] },
      { id: 'tool-b', name: '@deepseek-ai/b', extraFields: [] },
    ])
  })

  it('tolerates comments and blank lines', () => {
    const { entries, errors } = parsePatchInsert('# head\n\n- insert:\n  # inner\n    - id: x\n      name: y\n')
    expect(errors).toEqual([])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({ id: 'x', name: 'y', extraFields: [] })
  })

  it('reports entries missing id or name', () => {
    const { errors } = parsePatchInsert('- insert:\n    - name: only-name\n    - id: only-id\n')
    expect(errors.join('; ')).toContain('missing id')
    expect(errors.join('; ')).toContain('missing name')
  })

  it('rejects unexpected top-level content and non-insert entries', () => {
    const { errors } = parsePatchInsert('- update:\n    - id: x\n')
    expect(errors.join('; ')).toContain('unexpected content outside insert')
  })

  it('routes complex fields (config:) to extraFields', () => {
    const { entries, errors } = parsePatchInsert('- insert:\n    - id: x\n      name: y\n      config:\n        k: v\n')
    expect(errors).toEqual([])
    expect(entries[0]?.extraFields).toContain('config')
  })
})

describe('checkPatch: 仓库级检查', () => {
  it('passes a compliant patch', async () => {
    const dir = goodPlugin()
    expect(await checkPatch(dir, '@deepseek-ai/dsh-tool-good')).toEqual([])
  })

  it('reports patch-name-mismatch', async () => {
    const dir = makePlugin({
      'cordis.patch.yml': '- insert:\n    - id: tool-x\n      name: \'@deepseek-ai/other\'\n',
    })
    const issues = await checkPatch(dir, '@deepseek-ai/real')
    expect(issues.map(i => i.code)).toContain('patch-name-mismatch')
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
    const issues = await checkPatch(dir, '@deepseek-ai/a')
    expect(issues.map(i => i.code)).toContain('duplicate-row-id')
  })

  it('reports malformed-patch for structural errors', async () => {
    const dir = makePlugin({ 'cordis.patch.yml': '- insert:\n    - id: x\n' }) // 缺 name
    const issues = await checkPatch(dir, '@deepseek-ai/a')
    expect(issues.map(i => i.code)).toContain('malformed-patch')
  })

  it('returns no issues when cordis.patch.yml is absent (reported by manifest)', async () => {
    const dir = makePlugin({ 'package.json': '{}' })
    expect(await checkPatch(dir, '@deepseek-ai/a')).toEqual([])
  })
})
