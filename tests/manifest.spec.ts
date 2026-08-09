import { describe, expect, it } from 'vitest'
import { checkManifest, isValidPluginName } from '../src/manifest.ts'
import { goodPlugin, makePlugin, GOOD_PACKAGE } from './helpers.ts'

const codes = (issues: Array<{ code: string }>) => issues.map(i => i.code)

describe('checkManifest: 清单协议', () => {
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

  it('reports invalid-name for nonstandard names', async () => {
    const dir = makePlugin({ 'package.json': JSON.stringify({ name: 'my-plugin' }) })
    expect(codes((await checkManifest(dir)).issues)).toContain('invalid-name')
    expect(isValidPluginName('@deepseek-ai/dsh-tool-csv')).toBe(true)
    expect(isValidPluginName('dsh-foo')).toBe(true)
    expect(isValidPluginName('my-plugin')).toBe(false)
  })

  it('reports missing-main-or-types when targets do not exist', async () => {
    const dir = makePlugin({
      'package.json': JSON.stringify({ name: '@deepseek-ai/x', main: 'lib/index.js', types: 'lib/types/index.d.ts' }),
    })
    const issues = codes((await checkManifest(dir)).issues)
    expect(issues.filter(c => c === 'missing-main-or-types').length).toBe(2)
  })

  it('reports incomplete-files', async () => {
    const dir = makePlugin({ 'package.json': JSON.stringify({ name: '@deepseek-ai/x', files: ['lib'] }) })
    expect(codes((await checkManifest(dir)).issues)).toContain('incomplete-files')
  })

  it('reports missing-peer (cordis + dsh-tools for tool plugins)', async () => {
    const dir = makePlugin({
      'package.json': JSON.stringify({ name: '@deepseek-ai/x', peerDependencies: {} }),
      'src/index.ts': `import { defineTool } from '@deepseek-ai/dsh-tools'\n`,
    })
    const issues = codes((await checkManifest(dir)).issues)
    expect(issues.filter(c => c === 'missing-peer').length).toBe(2)
  })

  it('reports no-bundle-decl when dsh.bundle is absent (non-registry form)', async () => {
    const dir = makePlugin({ 'package.json': JSON.stringify({ name: '@deepseek-ai/x' }) })
    expect(codes((await checkManifest(dir)).issues)).toContain('no-bundle-decl')
  })

  it('skips bundle checks for registry-form plugins (dsh.plugin.json)', async () => {
    const dir = makePlugin({
      'package.json': JSON.stringify({ name: '@deepseek-ai/x' }),
      'dsh.plugin.json': '{}',
    })
    const issues = codes((await checkManifest(dir)).issues)
    expect(issues).not.toContain('no-bundle-decl')
    expect(issues).not.toContain('no-patch')
  })

  it('parses package.json correctly', async () => {
    const dir = makePlugin({ 'package.json': GOOD_PACKAGE })
    const { pkg } = await checkManifest(dir)
    expect(pkg?.['name']).toBe('@deepseek-ai/dsh-tool-good')
  })
})
