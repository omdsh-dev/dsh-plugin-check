import { describe, expect, it } from 'vitest'
import { detectKind, looksLikeToolPlugin } from '../src/form.ts'
import { checkRegistry } from '../src/registry.ts'
import { checkRepo } from '../src/index.ts'
import { makePlugin } from './helpers.ts'

describe('detectKind: 形态识别（PC-02）', () => {
  it('detects registry from dsh.plugin.json', async () => {
    const dir = makePlugin({ 'dsh.plugin.json': '{}', 'index.mjs': 'x' })
    expect(await detectKind(dir)).toBe('registry')
  })

  it('detects skill from SKILL.md without package.json', async () => {
    const dir = makePlugin({ 'SKILL.md': '---\nname: x\ndescription: y\n---\n' })
    expect(await detectKind(dir)).toBe('skill')
  })

  it('validates a single nested skill and does not report malformed-skill', async () => {
    const dir = makePlugin({ 'skills/one/SKILL.md': '---\nname: one\ndescription: first\n---\n' })
    expect(await detectKind(dir)).toBe('skill')
    const report = await checkRepo(dir, false, async () => ({ status: 'in-hub', issues: [] }))
    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual([])
  })

  it('validates every nested skill in a multi-skill repository', async () => {
    const dir = makePlugin({
      'skills/one/SKILL.md': '---\nname: one\ndescription: first\n---\n',
      'skills/two/SKILL.md': '---\nname: two\ndescription: second\n---\n',
    })
    const report = await checkRepo(dir, false, async () => ({ status: 'in-hub', issues: [] }))
    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual([])
  })

  it('reports malformed frontmatter in any nested skill', async () => {
    const dir = makePlugin({
      'skills/good/SKILL.md': '---\nname: good\ndescription: valid\n---\n',
      'skills/bad/SKILL.md': '---\nname: bad\n---\n',
    })
    const report = await checkRepo(dir, false, async () => ({ status: 'in-hub', issues: [] }))
    expect(report.errors).toEqual([])
    expect(report.warnings.map(i => i.code)).toContain('malformed-skill')
    expect(report.warnings.some(i => i.detail.includes('skills/bad/SKILL.md'))).toBe(true)
  })

  it('detects collection from catalog.json', async () => {
    const dir = makePlugin({ 'catalog.json': JSON.stringify({ collection: 'x', plugins: [] }) })
    expect(await detectKind(dir)).toBe('collection')
  })

  it('prefers a valid non-empty dsh.bundle.patch declaration over registry marker (#4)', async () => {
    const dir = makePlugin({
      'package.json': JSON.stringify({ name: 'dsh-x', main: 'lib/index.js', dsh: { bundle: { patch: './not-created-yet.yml' } } }),
      'dsh.plugin.json': '{}',
      'src/index.ts': 'export const a = 1',
    })
    expect(await detectKind(dir)).toBe('bundle')
    const collection = makePlugin({
      'package.json': JSON.stringify({ name: 'dsh-toolkit', main: 'lib/index.js', dsh: { bundle: { patch: './patch.yml' } } }),
      'catalog.json': JSON.stringify({ collection: 'dsh-toolkit', plugins: [] }),
    })
    expect(await detectKind(collection)).toBe('collection')
    const blank = makePlugin({
      'package.json': JSON.stringify({ name: 'dsh-x', main: 'lib/index.js', dsh: { bundle: { patch: '  ' } } }),
      'dsh.plugin.json': '{}',
    })
    expect(await detectKind(blank)).toBe('registry')
    const both = makePlugin({
      'package.json': JSON.stringify({ name: 'dsh-x', main: 'lib/index.js', dsh: { bundle: { patch: './patch.yml' } } }),
      'dsh.plugin.json': '{}',
    })
    expect(await detectKind(both)).toBe('bundle')
  })

  it('detects tool-bundle vs bundle by dsh-tools import', async () => {
    const tool = makePlugin({ 'package.json': JSON.stringify({ name: '@deepseek-ai/x', main: 'lib/index.js' }), 'src/index.ts': "import { defineTool } from '@deepseek-ai/dsh-tools'\n" })
    expect(await detectKind(tool)).toBe('tool-bundle')
    const plain = makePlugin({ 'package.json': JSON.stringify({ name: '@deepseek-ai/x', main: 'lib/index.js' }), 'src/index.ts': 'export const a = 1\n' })
    expect(await detectKind(plain)).toBe('bundle')
  })

  it('detects infra for packages without a main entry (PC-02)', async () => {
    const dir = makePlugin({ 'package.json': JSON.stringify({ name: 'dsh-my-rsi', private: true }) })
    expect(await detectKind(dir)).toBe('infra')
    const declared = makePlugin({
      'package.json': JSON.stringify({ name: 'dsh-broken', dsh: { bundle: { patch: './missing.yml' } } }),
      'dsh.plugin.json': '{}',
      'src/index.ts': "import { defineTool } from '@deepseek-ai/dsh-tools'",
    })
    expect(await detectKind(declared)).toBe('tool-bundle')
  })

  it('returns unknown for unrecognizable directories', async () => {
    const dir = makePlugin({ 'readme.txt': 'hello' })
    expect(await detectKind(dir)).toBe('unknown')
  })

  it('looksLikeToolPlugin catches subpath/dynamic/require forms (PC-12)', () => {
    for (const t of [
      "import { defineTool } from '@deepseek-ai/dsh-tools'",
      "import('@deepseek-ai/dsh-tools')",
      "require('@deepseek-ai/dsh-tools')",
      "export { x } from '@deepseek-ai/dsh-tools/invariant'",
    ]) {
      expect(looksLikeToolPlugin([t]), t).toBe(true)
    }
  })
})

describe('checkRegistry: dsh.plugin.json 契约（PC-01）', () => {
  const GOOD = JSON.stringify({
    id: 'dsh-hello',
    version: '0.1.0',
    main: 'index.mjs',
    engines: { dsh: '^0.1.0' },
  })

  it('passes a compliant registry manifest', async () => {
    const dir = makePlugin({ 'dsh.plugin.json': GOOD, 'index.mjs': 'x' })
    expect(await checkRegistry(dir)).toEqual([])
  })

  it('reports invalid id / version / engines / missing main', async () => {
    const dir = makePlugin({
      'dsh.plugin.json': JSON.stringify({ id: 'Bad ID', version: 'v1', main: './nope.mjs', engines: { dsh: 'not-a-range' } }),
    })
    const codes = (await checkRegistry(dir)).map(i => i.code)
    expect(codes).toContain('invalid-registry-id')
    expect(codes).toContain('invalid-registry-version')
    expect(codes).toContain('registry-main-missing')
    expect(codes).toContain('invalid-engines-dsh')
  })

  it('rejects escaping client.main (PC-04)', async () => {
    const dir = makePlugin({
      'dsh.plugin.json': JSON.stringify({ id: 'x', version: '0.1.0', main: 'index.mjs', client: { main: '../secret.js' } }),
      'index.mjs': 'x',
    })
    const codes = (await checkRegistry(dir)).map(i => i.code)
    expect(codes).toContain('registry-client-main')
  })

  it('reports malformed contributes', async () => {
    const dir = makePlugin({
      'dsh.plugin.json': JSON.stringify({ id: 'x', version: '0.1.0', main: 'index.mjs', contributes: { tools: 'not-array' } }),
      'index.mjs': 'x',
    })
    expect((await checkRegistry(dir)).map(i => i.code)).toContain('malformed-contributes')
  })

  it('reports invalid package.json name with the shared format code', async () => {
    const dir = makePlugin({
      'dsh.plugin.json': GOOD,
      'index.mjs': 'x',
      'package.json': JSON.stringify({ name: 'Bad_Name' }),
    })
    expect((await checkRegistry(dir)).map(i => i.code)).toContain('invalid-name-format')
  })
})
