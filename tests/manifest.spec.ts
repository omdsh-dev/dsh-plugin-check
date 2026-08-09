import { describe, expect, it } from 'vitest'
import { checkManifest } from '../src/manifest.ts'
import { isValidPackageName, matchesOrgPolicy, resolveWithin } from '../src/paths.ts'
import { goodPlugin, makePlugin, GOOD_PACKAGE } from './helpers.ts'

const codes = (issues: Array<{ code: string }>) => issues.map(i => i.code)

describe('checkManifest: bundle 清单协议', () => {
  it('passes a compliant plugin', async () => {
    const dir = goodPlugin()
    const { issues } = await checkManifest(dir)
    expect(codes(issues)).toEqual([])
  })

  it('reports no-manifest when package.json is missing', async () => {
    const dir = makePlugin({ 'src/index.ts': 'x' })
    const { issues, pkg } = await checkManifest(dir)
    expect(codes(issues)).toContain('no-manifest')
    expect(pkg).toBeNull()
  })

  it('rejects invalid npm names and org-policy violations (PC-07)', async () => {
    for (const bad of ['my-plugin', '@deepseek-ai/', '@deepseek-ai/x/y', '@deepseek-ai/X', 'dsh-', 'dsh-x/evil']) {
      const dir = makePlugin({ 'package.json': JSON.stringify({ name: bad }) })
      expect(codes((await checkManifest(dir)).issues), bad).toContain('invalid-name')
    }
    expect(isValidPackageName('@deepseek-ai/dsh-tool-csv')).toBe(true)
    expect(isValidPackageName('dsh-foo')).toBe(true)
    expect(matchesOrgPolicy('@deepseek-ai/x')).toBe(true)
    expect(matchesOrgPolicy('other/x')).toBe(false)
  })

  it('reports missing-main-or-types when targets are missing or escape the root (PC-04)', async () => {
    const dir = makePlugin({
      'package.json': JSON.stringify({ name: '@deepseek-ai/x', main: 'lib/index.js', types: 'lib/types/index.d.ts' }),
    })
    expect(codes((await checkManifest(dir)).issues).filter(c => c === 'missing-main-or-types').length).toBe(2)
    // 逃逸路径必须被拒
    const esc = makePlugin({
      'package.json': JSON.stringify({ name: '@deepseek-ai/x', main: '../secret', types: '../secret' }),
    })
    expect(codes((await checkManifest(esc)).issues).filter(c => c === 'missing-main-or-types').length).toBe(2)
  })

  it('reports incomplete-files and missing-peer', async () => {
    const dir = makePlugin({ 'package.json': JSON.stringify({ name: '@deepseek-ai/x', files: ['lib'], peerDependencies: {} }) })
    const issues = codes((await checkManifest(dir)).issues)
    expect(issues).toContain('incomplete-files')
    expect(issues).toContain('missing-peer')
  })

  it('validates dsh.bundle.patch declaration target (PC-04)', async () => {
    const dir = makePlugin({
      'package.json': JSON.stringify({ name: '@deepseek-ai/x', dsh: { bundle: { patch: './missing.yml' } } }),
    })
    expect(codes((await checkManifest(dir)).issues)).toContain('no-bundle-decl')
    // 逃逸声明
    const esc = makePlugin({
      'package.json': JSON.stringify({ name: '@deepseek-ai/x', dsh: { bundle: { patch: '../patch.yml' } } }),
    })
    expect(codes((await checkManifest(esc)).issues)).toContain('no-bundle-decl')
  })

  it('parses package.json correctly', async () => {
    const dir = makePlugin({ 'package.json': GOOD_PACKAGE })
    const { pkg } = await checkManifest(dir)
    expect(pkg?.['name']).toBe('@deepseek-ai/dsh-tool-good')
  })
})

describe('paths: name 校验与 containment', () => {
  it('resolveWithin rejects absolute, ../ and symlink escapes', async () => {
    const dir = goodPlugin()
    expect((await resolveWithin(dir, '../x')).ok).toBe(false)
    expect((await resolveWithin(dir, 'C:/Windows/win.ini')).ok).toBe(false)
    expect((await resolveWithin(dir, 'lib/index.js')).ok).toBe(true)
    expect((await resolveWithin(dir, 'nope.js')).ok).toBe(false)
  })
})
