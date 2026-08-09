import { describe, expect, it } from 'vitest'
import { buildRepoReport, CHECK_SCHEMA, isErrorCode, type CheckIssue } from '../src/report.ts'

const issue = (code: string, detail = ''): CheckIssue => ({ code, detail })

describe('buildRepoReport: verdict 判定', () => {
  it('passes with no issues', () => {
    const r = buildRepoReport('dsh-x', '/p/dsh-x', [], false)
    expect(r.verdict).toBe('pass')
    expect(r.checks).toEqual({ total: 0, passed: 0 })
  })

  it('fails on any error-level issue', () => {
    const r = buildRepoReport('dsh-x', '/p/dsh-x', [issue('stale-ts-imports')], false)
    expect(r.verdict).toBe('fail')
    expect(r.errors).toHaveLength(1)
  })

  it('warns on warnings only', () => {
    const r = buildRepoReport('dsh-x', '/p/dsh-x', [issue('incomplete-files'), issue('hub-skipped')], false)
    expect(r.verdict).toBe('warn')
    expect(r.skipped).toHaveLength(1)
  })

  it('strict mode promotes warnings to errors', () => {
    const r = buildRepoReport('dsh-x', '/p/dsh-x', [issue('incomplete-files')], true)
    expect(r.verdict).toBe('fail')
    expect(r.errors).toHaveLength(1)
    // hub-skipped 永不升级
    const r2 = buildRepoReport('dsh-x', '/p/dsh-x', [issue('hub-skipped')], true)
    expect(r2.verdict).toBe('pass')
  })

  it('maps suggestions from templates', () => {
    const r = buildRepoReport('dsh-x', '/p/dsh-x', [issue('missing-ts-ext-imports'), issue('stale-ts-imports')], false)
    expect(r.suggestions).toContain('tsconfig 补 "allowImportingTsExtensions": true')
    expect(r.suggestions).toContain('重新构建 lib/（产物相对导入必须是 .js）')
  })
})

describe('CHECK_SCHEMA: 检测项清单（schema action 输出）', () => {
  it('covers all error codes used by isErrorCode', () => {
    const codes = new Set(CHECK_SCHEMA.map(c => c.code))
    for (const code of ['no-manifest', 'invalid-name', 'missing-main-or-types', 'no-patch',
      'malformed-patch', 'patch-name-mismatch', 'duplicate-row-id', 'no-source-entry',
      'no-tsconfig', 'missing-ts-ext-imports', 'lib-layout-mismatch', 'stale-ts-imports']) {
      expect(codes.has(code), code).toBe(true)
      expect(isErrorCode(code)).toBe(true)
    }
  })

  it('keeps warnings out of the error set', () => {
    expect(isErrorCode('incomplete-files')).toBe(false)
    expect(isErrorCode('no-build-script')).toBe(false)
    expect(isErrorCode('hub-skipped')).toBe(false)
  })
})
