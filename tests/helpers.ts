/** 测试辅助：在临时目录生成插件仓库 fixtures。 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function makePlugin(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-fixture-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

export const GOOD_TS_SRC = `import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { impl } from './impl.ts'

export const name = '@deepseek-ai/dsh-tool-good'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({ name: 'good', parameters: {}, output: { schema: { type: 'string' }, render: () => [] }, execute: () => Promise.resolve(impl()) }))
}
`

export const GOOD_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022', lib: ['ES2024'], module: 'esnext', moduleResolution: 'bundler',
    outDir: 'lib', rootDir: 'src', declaration: true, declarationDir: 'lib/types',
    allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
    types: ['node'], strict: true, skipLibCheck: true,
  },
  include: ['src'],
})

export const GOOD_PACKAGE = JSON.stringify({
  name: '@deepseek-ai/dsh-tool-good',
  main: 'lib/index.js',
  types: 'lib/types/index.d.ts',
  scripts: { build: 'tsc -p tsconfig.json', prepack: 'npm run build' },
  peerDependencies: { '@deepseek-ai/dsh-tools': '*', '@deepseek-ai/cordis': '*' },
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  files: ['lib', 'src', 'cordis.patch.yml'],
}, null, 2)

export const GOOD_PATCH = `# bundle patch
- insert:
    - id: tool-good
      name: '@deepseek-ai/dsh-tool-good'
`

/** 合规基线插件。 */
export function goodPlugin(): string {
  return makePlugin({
    'package.json': GOOD_PACKAGE,
    'tsconfig.json': GOOD_TSCONFIG,
    'cordis.patch.yml': GOOD_PATCH,
    'src/index.ts': GOOD_TS_SRC,
    'src/impl.ts': 'export function impl(): string { return "ok" }\n',
    'lib/index.js': 'export {}\n',
    'lib/types/index.d.ts': 'export {}\n',
  })
}
