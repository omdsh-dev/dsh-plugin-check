import { describe, expect, it } from 'vitest'
import { buildRepoReport, computeCheckResults, CHECK_SCHEMA, isErrorCode, type CheckIssue } from '../src/report.ts'

const issue = (code: string, detail = ''): CheckIssue => ({ code, detail })

describe('buildRepoReport: verdict 与 checks 统计（PC-10）', () => {
  it('passes with no issues and reports fixed check coverage', () => {
    const r = buildRepoReport('dsh-x', '/p/dsh-x', 'tool-bundle', [], false)
    expect(r.verdict).toBe('pass')
    // tool-bundle 适用的固定检查项数
    const applicable = CHECK_SCHEMA.filter(i => i.appliesTo.includes('tool-bundle')).length
    expect(r.checks.total).toBe(applicable)
    expect(r.checks.passed).toBe(applicable)
    expect(r.checks.failed).toBe(0)
  })

  it('fails on error issues; counts them in checks', () => {
    const r = buildRepoReport('dsh-x', '/p/dsh-x', 'tool-bundle', [issue('stale-ts-imports')], false)
    expect(r.verdict).toBe('fail')
    expect(r.checks.failed).toBe(1)
    expect(r.checks.passed).toBe(r.checks.total - 1)
  })

  it('warns on warnings only; hub-skipped is skipped not warned', () => {
    const r = buildRepoReport('dsh-x', '/p/dsh-x', 'tool-bundle', [issue('incomplete-files'), issue('hub-skipped')], false)
    expect(r.verdict).toBe('warn')
    expect(r.skipped).toHaveLength(1)
    expect(r.checks.warned).toBe(1)
    expect(r.checks.skipped).toBe(1) // hub-skipped 是跳过而非失败/警告
  })

  it('strict mode promotes warnings to errors; hub-skipped/scan-truncated never', () => {
    const r = buildRepoReport('dsh-x', '/p/dsh-x', 'tool-bundle', [issue('incomplete-files')], true)
    expect(r.verdict).toBe('fail')
    const r2 = buildRepoReport('dsh-x', '/p/dsh-x', 'tool-bundle', [issue('hub-skipped'), issue('scan-truncated')], true)
    expect(r2.verdict).toBe('pass')
  })

  it('maps suggestions from templates', () => {
    const r = buildRepoReport('dsh-x', '/p/dsh-x', 'tool-bundle', [issue('missing-ts-ext-imports'), issue('stale-ts-imports')], false)
    expect(r.suggestions).toContain('tsconfig 补 "allowImportingTsExtensions": true')
    expect(r.suggestions).toContain('重新构建 lib/（产物相对导入必须是 .js）')
  })

  it('registry-kind reports use registry check items only', () => {
    const r = buildRepoReport('dsh-x', '/p/dsh-x', 'registry', [issue('invalid-registry-id')], false)
    expect(r.checks.total).toBe(CHECK_SCHEMA.filter(i => i.appliesTo.includes('registry')).length)
    expect(r.checks.failed).toBe(1)
    expect(r.verdict).toBe('fail')
  })
})

describe('computeCheckResults / CHECK_SCHEMA（X-01：按形态适用矩阵）', () => {
  it('applies only hub items to skill kind; bundle items are out of scope', () => {
    const results = computeCheckResults([], 'skill')
    // skill 只有 hub 两项适用（not-in-hub / hub-skipped），均为 pass
    expect(results.map(r => r.code).sort()).toEqual(['hub-skipped', 'not-in-hub'])
    expect(results.every(r => r.status === 'pass')).toBe(true)
  })

  it('covers all error codes', () => {
    const codes = new Set(CHECK_SCHEMA.map(c => c.code))
    for (const code of ['no-manifest', 'invalid-name-format', 'missing-main-or-types', 'no-patch',
      'malformed-patch', 'patch-name-mismatch', 'duplicate-row-id', 'no-source-entry',
      'no-tsconfig', 'missing-ts-ext-imports', 'missing-rewrite-imports', 'lib-layout-mismatch',
      'stale-ts-imports', 'no-build-entry', 'malformed-registry-manifest', 'invalid-registry-id',
      'registry-main-missing']) {
      expect(codes.has(code), code).toBe(true)
      expect(isErrorCode(code), code).toBe(true)
    }
  })
})
