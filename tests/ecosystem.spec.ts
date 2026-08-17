import { describe, expect, it } from 'vitest'
import { checkProfileInstallDocs, checkCoreRowIds, isBundleInstallable, FORBIDDEN_CORE_ROWS } from '../src/ecosystem.ts'
import { checkRepo } from '../src/index.ts'
import { goodPlugin, makePlugin } from './helpers.ts'

const codes = (issues: Array<{ code: string }>) => issues.map(i => i.code)
const noHub = async () => ({ status: 'in-hub' as const, issues: [] })

const GOOD_README = `# demo

## 安装

### Profile Bundle（推荐）

\`\`\`sh
dsh plugin --profile web add "C:/path/to/demo"
\`\`\`

### 手动安装与旧版本兼容

仅旧快照：cp -r demo ~/.dsh/source/master/packages/tools/demo
`

describe('checkCoreRowIds: 官方核心 row id 冲突（plan §5.2）', () => {
  it('拒绝官方核心 row id', () => {
    const issues = checkCoreRowIds([{ id: 'tools' }, { id: 'tool-good' }])
    expect(codes(issues)).toEqual(['core-row-id'])
  })

  it('tool-<name> 命名通过', () => {
    expect(checkCoreRowIds([{ id: 'tool-time' }, { id: 'service-x' }, { id: 'client-y' }])).toEqual([])
  })

  it('黑名单与 plan §5.2 一致', () => {
    expect(FORBIDDEN_CORE_ROWS).toEqual(['tools', 'session', 'llm', 'web', 'permission'])
  })
})

describe('checkProfileInstallDocs: 安装边界文档', () => {
  it('标准示例 + legacy 标注 → 无问题', async () => {
    const dir = makePlugin({ 'README.md': GOOD_README })
    const issues = await checkProfileInstallDocs(dir, 'tool-bundle')
    expect(issues).toEqual([])
  })

  it('缺 dsh plugin --profile 示例 → missing-profile-install-example', async () => {
    const dir = makePlugin({ 'README.md': '# demo\n\n手动安装：cp -r demo ~/.dsh/source/master/packages/tools/demo' })
    const issues = await checkProfileInstallDocs(dir, 'tool-bundle')
    expect(codes(issues)).toContain('missing-profile-install-example')
    expect(codes(issues)).toContain('core-modification-required')
  })

  it('默认流程里的核心修改被标记；legacy 标注段落不计入', async () => {
    const d1 = makePlugin({ 'README.md': '# demo\n\n## 安装\n\ngit apply patch-to-core.diff 到 ~/.dsh/source\n\ndsh plugin --profile web add x' })
    const issues1 = await checkProfileInstallDocs(d1, 'tool-bundle')
    expect(codes(issues1)).toContain('core-modification-required')
    // legacy 标记后出现 cp 不计入
    const d2 = makePlugin({ 'README.md': GOOD_README })
    expect(await checkProfileInstallDocs(d2, 'tool-bundle')).toEqual([])
  })

  it('scripts 里 git apply 核心路径 → core-modification-required', async () => {
    const dir = makePlugin({
      'README.md': GOOD_README,
      'scripts/install.sh': '#!/bin/sh\ngit apply ~/.dsh/source/packages/core.patch\n',
    })
    const issues = await checkProfileInstallDocs(dir, 'tool-bundle')
    expect(codes(issues)).toContain('core-modification-required')
  })

  it('README 缺失 → missing-profile-install-example', async () => {
    const dir = makePlugin({ 'package.json': '{}' })
    const issues = await checkProfileInstallDocs(dir, 'bundle')
    expect(codes(issues)).toContain('missing-profile-install-example')
  })
})

describe('isBundleInstallable / checkRepo 集成（plan §4.5）', () => {
  it('合规 bundle（含 README 示例）→ manual-install-only 不触发', async () => {
    const dir = goodPlugin()
    const fs = await import('node:fs')
    const path = await import('node:path')
    fs.writeFileSync(path.join(dir, 'README.md'), GOOD_README)
    const r = await checkRepo(dir, false, noHub)
    expect(codes(r.errors).includes('manual-install-only')).toBe(false)
    expect(codes(r.warnings).includes('manual-install-only')).toBe(false)
    expect(codes(r.errors)).not.toContain('core-row-id')
    expect(codes(r.warnings)).not.toContain('missing-profile-install-example')
  })

  it('无 README 示例 → manual-install-only + missing-profile-install-example', async () => {
    const dir = goodPlugin()
    // goodPlugin 无 README → docs 检查触发 missing 与 manual
    const r = await checkRepo(dir, false, noHub)
    expect(codes(r.warnings)).toContain('missing-profile-install-example')
    expect(codes(r.warnings)).toContain('manual-install-only')
  })

  it('core row id patch → error', async () => {
    const dir = goodPlugin()
    const fs = await import('node:fs')
    fs.writeFileSync(require('node:path').join(dir, 'cordis.patch.yml'), '- insert:\n    - id: tools\n      name: "@deepseek-ai/dsh-tool-good"\n')
    const r = await checkRepo(dir, false, noHub)
    expect(codes(r.errors)).toContain('core-row-id')
  })

  it('官方规范示例通过新检查（无 core 冲突、无 manual-only）', async () => {
    const dir = makePlugin({
      'package.json': JSON.stringify({
        name: '@deepseek-ai/dsh-tool-ok',
        main: 'lib/index.js',
        types: 'lib/types/index.d.ts',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }),
      'cordis.patch.yml': '- insert:\n    - id: tool-ok\n      name: "@deepseek-ai/dsh-tool-ok"\n',
      'lib/index.js': 'export {}\n',
      'lib/types/index.d.ts': 'export {}\n',
      'README.md': GOOD_README,
    })
    const r = await checkRepo(dir, false, noHub)
    expect(codes(r.errors)).not.toContain('core-row-id')
    expect(codes(r.warnings)).not.toContain('manual-install-only')
    expect(codes(r.warnings)).not.toContain('missing-profile-install-example')
  })
})
