import { describe, expect, it } from 'vitest'
import { checkBuildPitfalls, resolveTsconfig } from '../src/build-check.ts'
import { goodPlugin, makePlugin, GOOD_TSCONFIG, GOOD_TS_SRC } from './helpers.ts'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

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
    expect(codes(await checkBuildPitfalls(dir, 'tool-bundle', JSON.parse(pkg())))).toEqual([])
  })

  it('does not run TypeScript source/tsconfig checks for a plain bundle (#5)', async () => {
    const dir = makePlugin({
      'package.json': pkg(),
      'src/index.ts': "import { x } from './x.ts'",
      'lib/index.js': 'export {}',
    })
    const issues = codes(await checkBuildPitfalls(dir, 'bundle', JSON.parse(pkg())))
    expect(issues).not.toContain('no-source-entry')
    expect(issues).not.toContain('no-tsconfig')
    expect(issues).not.toContain('missing-ts-ext-imports')
  })

  it('reports no-source-entry and no-tsconfig', async () => {
    const d1 = makePlugin({ 'tsconfig.json': GOOD_TSCONFIG })
    expect(codes(await checkBuildPitfalls(d1, 'tool-bundle', JSON.parse(pkg())))).toContain('no-source-entry')
    const d2 = makePlugin({ 'src/index.ts': 'x' })
    expect(codes(await checkBuildPitfalls(d2, 'tool-bundle', JSON.parse(pkg())))).toContain('no-tsconfig')
  })

  it('resolves tsconfig extends and stops false positives (PC-05)', async () => {
    const dir = makePlugin({
      'tsconfig.json': JSON.stringify({ extends: './base.json', compilerOptions: {} }),
      'base.json': JSON.stringify({ compilerOptions: { outDir: 'lib', allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, declarationDir: 'lib/types', types: ['node'] } }),
      'src/index.ts': "import { x } from './impl.ts'",
      'src/impl.ts': 'export const x = 1',
    })
    const issues = codes(await checkBuildPitfalls(dir, 'tool-bundle', JSON.parse(pkg())))
    expect(issues).not.toContain('missing-ts-ext-imports')
    expect(issues).not.toContain('tsconfig-extends-unresolved')
  })

  it('reports tsconfig-extends-unresolved instead of deterministic fails (PC-05)', async () => {
    const dir = makePlugin({
      'tsconfig.json': JSON.stringify({ extends: './missing-base.json', compilerOptions: {} }),
      'src/index.ts': "import { x } from './impl.ts'",
      'src/impl.ts': 'x',
    })
    expect(codes(await checkBuildPitfalls(dir, 'tool-bundle', JSON.parse(pkg())))).toContain('tsconfig-extends-unresolved')
  })

  it('reports missing-ts-ext-imports / missing-rewrite-imports as errors (PC-11)', async () => {
    const d1 = makePlugin({
      'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'lib' } }),
      'src/index.ts': "import { x } from './impl.ts'",
      'src/impl.ts': 'x',
    })
    expect(codes(await checkBuildPitfalls(d1, 'tool-bundle', JSON.parse(pkg())))).toContain('missing-ts-ext-imports')
    const d2 = makePlugin({
      'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'lib', allowImportingTsExtensions: true } }),
      'src/index.ts': "import { x } from './impl.ts'",
      'src/impl.ts': 'x',
    })
    expect(codes(await checkBuildPitfalls(d2, 'tool-bundle', JSON.parse(pkg())))).toContain('missing-rewrite-imports')
  })

  it('detects all .ts import forms in lib output (PC-06)', async () => {
    const forms = [
      "import('./x.ts')",
      "require('./x.ts')",
      "import './x.ts'",
      "import z from './z.ts'",
      "import x from './x.tsx'",
      "import m from './m.mts'",
      "import c from './c.cts'",
      "new Worker(new URL('./worker.ts', import.meta.url))",
    ]
    for (const form of forms) {
      const dir = makePlugin({
        'lib/index.js': form,
        'src/index.ts': 'x',
        'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'lib' } }),
      })
      expect(codes(await checkBuildPitfalls(dir, 'tool-bundle', JSON.parse(pkg()))), form).toContain('stale-ts-imports')
    }
  })

  it('reports no-build-entry (error) when lib is missing and no build script (PC-11)', async () => {
    const dir = makePlugin({
      'src/index.ts': 'x',
      'tsconfig.json': GOOD_TSCONFIG,
    })
    const issues = codes(await checkBuildPitfalls(dir, 'tool-bundle', JSON.parse(pkg({ scripts: {} }))))
    expect(issues).toContain('no-build-entry')
    expect(issues).not.toContain('no-build-script')
  })

  it('reports no-build-script (warning) when lib exists but scripts missing', async () => {
    const dir = makePlugin({
      'src/index.ts': 'x',
      'tsconfig.json': GOOD_TSCONFIG,
      'lib/index.js': 'export {}',
    })
    const issues = codes(await checkBuildPitfalls(dir, 'tool-bundle', JSON.parse(pkg({ scripts: {} }))))
    expect(issues).toContain('no-build-script')
    expect(issues).not.toContain('no-build-entry')
  })

  it('reports implicit-node-types for Buffer without explicit types', async () => {
    const dir = makePlugin({
      'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'lib' } }),
      'src/index.ts': `const n = Buffer.byteLength('x')\n`,
    })
    expect(codes(await checkBuildPitfalls(dir, 'tool-bundle', JSON.parse(pkg())))).toContain('implicit-node-types')
  })

  it('accepts declaration-separated bundle layouts (Issue #1: tsc + tsdown)', async () => {
    const dir = makePlugin({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          outDir: 'lib/types',
          declarationDir: 'lib/types',
        },
      }),
      'src/index.ts': 'export const apply = () => {}',
      'lib/index.js': 'export const apply = () => {}',
      'lib/types/index.d.ts': 'export declare const apply: () => void',
    })
    const issues = codes(await checkBuildPitfalls(dir, 'tool-bundle', JSON.parse(pkg())))
    expect(issues).not.toContain('lib-layout-mismatch')
  })

  it('accepts declaration-separated layouts with outDir nested under main dir', async () => {
    const dir = makePlugin({
      'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'lib/types/out' } }),
      'src/index.ts': 'export {}',
      'lib/index.js': 'export {}',
      'lib/types/out/index.d.ts': 'export {}',
    })
    const issues = codes(await checkBuildPitfalls(dir, 'tool-bundle', JSON.parse(pkg({ types: 'lib/types/out/index.d.ts' }))))
    expect(issues).not.toContain('lib-layout-mismatch')
  })

  it('still reports lib-layout-mismatch when types points outside outDir', async () => {
    const dir = makePlugin({
      'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'lib/types/out' } }),
      'src/index.ts': 'export {}',
      'lib/index.js': 'export {}',
      'lib/types/out/index.d.ts': 'export {}',
    })
    // types 指向 outDir 之外（lib/types/index.d.ts 而非 lib/types/out/...）→ 布局不可信
    const issues = codes(await checkBuildPitfalls(dir, 'tool-bundle', JSON.parse(pkg())))
    expect(issues).toContain('lib-layout-mismatch')
  })

  it('still reports lib-layout-mismatch when types is missing in a separated layout', async () => {
    const dir = makePlugin({
      'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'lib/types' } }),
      'src/index.ts': 'export {}',
      'lib/index.js': 'export {}',
      'lib/types/index.d.ts': 'export {}',
    })
    const issues = codes(await checkBuildPitfalls(dir, 'tool-bundle', JSON.parse(pkg({ types: undefined }))))
    expect(issues).toContain('lib-layout-mismatch')
  })

  it('still reports unrelated outDir/main layouts (Issue #1 negative)', async () => {
    const dir = makePlugin({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          outDir: 'dist/types',
        },
      }),
      'src/index.ts': 'export {}',
    })
    const issues = codes(await checkBuildPitfalls(dir, 'tool-bundle', JSON.parse(pkg())))
    expect(issues).toContain('lib-layout-mismatch')
  })
})

describe('resolveTsconfig: extends 解析', () => {
  it('merges base compilerOptions with child overrides', async () => {
    const dir = goodPlugin()
    mkdirSync(join(dir, 'shared'))
    // 用临时文件验证合并语义
    const d2 = makePlugin({
      'tsconfig.json': JSON.stringify({ extends: './base.json', compilerOptions: { outDir: 'dist' } }),
      'base.json': JSON.stringify({ compilerOptions: { allowImportingTsExtensions: true, outDir: 'lib' } }),
    })
    const r = await resolveTsconfig(d2)
    expect(r?.resolved).toBe(true)
    expect(r?.compilerOptions['outDir']).toBe('dist') // 子覆盖
    expect(r?.compilerOptions['allowImportingTsExtensions']).toBe(true) // 继承
  })
})
