/**
 * DSH 插件健康检查插件。
 *
 * 注册 `plugin_check` 工具：扫描插件仓库，诊断清单协议 / patch 格式 /
 * 构建陷阱 / hub 收录状态，输出合规报告与修复建议。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-plugin-check
 *     name: '@deepseek-ai/dsh-plugin-check'
 *
 * 安全边界：**只读**（不修改、不构建被检查仓库）；path 需为本地目录；
 * hub 检查离线优先、失败静默降级（skipped）；零业务依赖（仅 node 内置模块）。
 */

import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { checkManifest } from './manifest.ts'
import { checkPatch } from './patch.ts'
import { checkBuildPitfalls } from './build-check.ts'
import { checkHubStatus } from './hub.ts'
import { buildRepoReport, CHECK_SCHEMA, type CheckIssue, type RepoReport } from './report.ts'

export const name = '@deepseek-ai/dsh-plugin-check'
export const inject = ['tools']

interface PluginCheckArgs {
  action: string
  path?: unknown
  strict?: unknown
}

/** 检查单个插件仓库目录。 */
export async function checkRepo(dir: string, strict: boolean): Promise<RepoReport> {
  const repo = basename(dir)
  const issues: CheckIssue[] = []

  const { issues: manifestIssues, pkg } = await checkManifest(dir)
  issues.push(...manifestIssues)

  const pkgName = (pkg?.['name'] as string | undefined) ?? null

  if (pkgName === null) {
    // 无 package.json：无法继续 patch/构建检查，直接出报告
    return buildRepoReport(repo, dir, issues, strict)
  }

  issues.push(...await checkPatch(dir, pkgName))
  issues.push(...await checkBuildPitfalls(dir, pkg))

  // hub 状态（离线/失败降级）
  const hub = await checkHubStatus(repo)
  issues.push(...hub.issues)

  return buildRepoReport(repo, dir, issues, strict)
}

/** 扫描目录下所有 dsh-* 插件仓库并逐个检查。 */
export async function scanDir(parent: string, strict: boolean): Promise<{ root: string; scanned: number; reports: RepoReport[] }> {
  const reports: RepoReport[] = []
  let entries: string[] = []
  try {
    entries = await fs.readdir(parent)
  } catch {
    throw new Error(`plugin_check: cannot read directory: ${parent}`)
  }
  for (const e of entries) {
    if (!e.startsWith('dsh-')) continue
    const full = join(parent, e)
    let stat
    try { stat = await fs.stat(full) } catch { continue }
    if (!stat.isDirectory()) continue
    try {
      await fs.access(join(full, 'package.json'))
    } catch {
      continue // 无 package.json 的不算插件仓库
    }
    reports.push(await checkRepo(full, strict))
  }
  return { root: parent, scanned: reports.length, reports }
}

function runAction(args: PluginCheckArgs): Promise<string> {
  const strict = args.strict === true
  const target = typeof args.path === 'string' && args.path !== '' ? args.path : process.cwd()

  switch (args.action) {
    case 'check':
      return checkRepo(target, strict).then(r => JSON.stringify(r))
    case 'scan':
      return scanDir(target, strict).then(r => JSON.stringify(r))
    case 'schema':
      return Promise.resolve(JSON.stringify(CHECK_SCHEMA))
    default:
      return Promise.reject(new Error(`plugin_check: unknown action "${args.action}"`))
  }
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'plugin_check',
    description:
      'Diagnose a dsh plugin repository (manifest protocol, cordis.patch.yml format, ' +
      'build pitfalls, hub registration) and produce a compliance report with fixes. ' +
      'Actions: check (single repo directory), scan (all dsh-* repos under a parent ' +
      'directory), schema (list of check items). Read-only: never modifies or builds ' +
      'the checked repository. path defaults to the current working directory; ' +
      'strict=true promotes warnings to errors in the verdict.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['check', 'scan', 'schema'],
        description: 'Operation to perform.',
      },
      path: {
        type: 'string',
        description: 'Plugin repository directory (check) or parent directory (scan). Default: current working directory.',
      },
      strict: {
        type: 'boolean',
        description: 'Strict mode: treat warnings as errors in the verdict. Default false.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: args => runAction(args as PluginCheckArgs),
    timeoutMs: 5000,
  }))
}
