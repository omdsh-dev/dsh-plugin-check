import { describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (opts: unknown) => opts }))
import { name, inject, apply } from '../src/index.ts'

describe('plugin_check: plugin registration contract (AUDIT-CROSS-02)', () => {
  it('exports the cordis plugin contract', () => {
    expect(typeof name).toBe('string')
    expect(name).toBe('@omdsh-dev/dsh-plugin-check')
    expect(inject).toContain('tools')
    expect(typeof apply).toBe('function')
  })

  it('registers the plugin_check tool with schema + render', () => {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    const def = captured as any
    expect(def.name).toBe('plugin_check')
    expect(def.parameters.action.required).toBe(true)
    expect(def.parameters.action.enum).toEqual(['check', 'scan', 'schema'])
    expect(def.parameters.strict.type).toBe('boolean')
    expect(typeof def.output.render).toBe('function')
    expect(def.timeoutMs).toBeGreaterThan(0)
  })
})
