import { describe, expect, it } from 'vitest'
import { checkBuildPitfalls } from '../src/build-check.ts'
import { goodPlugin, makePlugin, GOOD_TSCONFIG, GOOD_TS_SRC } from './helpers.ts'

const pkg = (extra: Record<string, unknown> = {}) => JSON.stringify({
  name: '@deepseek-ai/dsh-tool-x',
  main: 'lib/index.js',
  types: 'lib/types/index.d.ts',
  scripts: { build: 'tsc -p tsconfig.json', prepack: 'npm run build' },
  ...extra,
})
const codes = (issues: Array<{ code: string }>) => issues.map(i => i.code)

describe('checkBuildPitfalls: 构建陷阱（静态）', () => {
  it('passes a compliant plugin', async () => {
    const dir = goodPlugin()
    const parsed = JSON.parse(pkg()) as Record<string, unknown>
    expect(codes(await checkBuildPitfalls(dir, parsed))).toEqual([])
  })

  it('reports no-source-entry', async () => {
    const dir = makePlugin({ 'tsconfig.json': GOOD_TSCONFIG })
    expect(codes(await checkBuildPitfalls(dir, JSON.parse(pkg())))).toContain('no-source-entry')
  })

  it('reports no-tsconfig', async () => {
    const dir = makePlugin({ 'src/index.ts': 'x' })
    expect(codes(await checkBuildPitfalls(dir, JSON.parse(pkg())))).toContain('no-tsconfig')
  })

  it('reports missing-ts-ext-imports when src uses .ts imports without the flag', async () => {
    const dir = makePlugin({
      'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'lib' } }),
      'src/index.ts': `import { x } from './impl.ts'\n`,
      'src/impl.ts': 'export const x = 1\n',
    })
    expect(codes(await checkBuildPitfalls(dir, JSON.parse(pkg())))).toContain('missing-ts-ext-imports')
  })

  it('reports missing-rewrite-imports when the flag pair is incomplete', async () => {
    const dir = makePlugin({
      'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'lib', allowImportingTsExtensions: true } }),
      'src/index.ts': `import { x } from './impl.ts'\n`,
      'src/impl.ts': 'export const x = 1\n',
    })
    expect(codes(await checkBuildPitfalls(dir, JSON.parse(pkg())))).toContain('missing-rewrite-imports')
  })

  it('reports lib-layout-mismatch', async () => {
    const dir = makePlugin({
      'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'dist' } }),
    })
    expect(codes(await checkBuildPitfalls(dir, JSON.parse(pkg())))).toContain('lib-layout-mismatch')
  })

  it('reports types-path-mismatch', async () => {
    const dir = makePlugin({
      'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'lib', declarationDir: 'types' } }),
    })
    expect(codes(await checkBuildPitfalls(dir, JSON.parse(pkg())))).toContain('types-path-mismatch')
  })

  it('reports implicit-node-types when Buffer is used without explicit types', async () => {
    const dir = makePlugin({
      'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'lib' } }),
      'src/index.ts': `const n = Buffer.byteLength('x')\n`,
    })
    expect(codes(await checkBuildPitfalls(dir, JSON.parse(pkg())))).toContain('implicit-node-types')
    // 显式 types:["node"] 后不再命中
    const okDir = makePlugin({
      'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'lib', types: ['node'] } }),
      'src/index.ts': `const n = Buffer.byteLength('x')\n`,
    })
    expect(codes(await checkBuildPitfalls(okDir, JSON.parse(pkg())))).not.toContain('implicit-node-types')
  })

  it('reports stale-ts-imports when lib output keeps .ts imports', async () => {
    const dir = makePlugin({
      'tsconfig.json': GOOD_TSCONFIG,
      'src/index.ts': 'x',
      'lib/index.js': `import { evaluate } from './evaluate.ts'\n`,
      'lib/evaluate.js': '',
    })
    expect(codes(await checkBuildPitfalls(dir, JSON.parse(pkg())))).toContain('stale-ts-imports')
  })

  it('reports no-build-script when scripts are missing', async () => {
    const dir = makePlugin({ 'tsconfig.json': GOOD_TSCONFIG, 'src/index.ts': GOOD_TS_SRC })
    const issues = await checkBuildPitfalls(dir, JSON.parse(pkg({ scripts: {} })))
    const build = issues.filter(i => i.code === 'no-build-script')
    expect(build.length).toBe(2) // build + prepack
  })
})
