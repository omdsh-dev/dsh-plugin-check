/**
 * §3.4 hub 收录状态检查 —— 优先读本地 hub catalog（离线、快），
 * gh API 作为 fallback；任何失败静默降级为 'skipped'（报告如实标注）。
 *
 * 与实施文档的偏差（审查修正）：不检查 `marisa-plugin` topic——组织内
 * 9 个插件实际都没打 topic（`gh api .../topics` 全空），会误报全部基线插件；
 * hub 收录以 catalog 登记为准。
 */

import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CheckIssue } from './report.ts'

export type HubStatus = 'in-hub' | 'not-in-hub' | 'skipped'

/** 本地 hub catalog 候选路径（环境变量优先，其次常见位置）。 */
function localCatalogCandidates(): string[] {
  const env = process.env['DSH_HUB_SOURCE']
  const out: string[] = []
  if (env) out.push(env)
  out.push(
    join(process.cwd(), 'hub', 'catalog.source.json'),
    join(process.cwd(), 'hub', 'catalog.json'),
    join(homedir(), '.dsh', 'hub', 'catalog.source.json'),
  )
  return out
}

async function readLocalCatalog(): Promise<{ repos: Array<{ name: string }> } | null> {
  for (const p of localCatalogCandidates()) {
    try {
      const parsed = JSON.parse(await fs.readFile(p, 'utf8')) as { repos?: Array<{ name: string }> }
      if (Array.isArray(parsed['repos'])) return parsed as { repos: Array<{ name: string }> }
    } catch {
      // 继续尝试下一个候选
    }
  }
  return null
}

/** 经 gh CLI 读取远端 hub catalog（离线优先失败后调用；失败返回 null）。 */
async function fetchHubCatalogViaGh(): Promise<{ repos: Array<{ name: string }> } | null> {
  return new Promise(resolve => {
    execFile('gh', ['api', 'repos/dsh-external/hub/contents/catalog.json', '-q', '.content'], {
      timeout: 5000,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) { resolve(null); return }
      try {
        const decoded = Buffer.from(stdout.trim(), 'base64').toString('utf8')
        const parsed = JSON.parse(decoded) as { repos?: Array<{ name: string }> }
        if (Array.isArray(parsed['repos'])) resolve(parsed as { repos: Array<{ name: string }> })
        else resolve(null)
      } catch {
        resolve(null)
      }
    })
  })
}

/** 检查仓库是否被 hub catalog 收录；网络/工具不可用时返回 'skipped'。 */
export async function checkHubStatus(repoName: string): Promise<{ status: HubStatus; issues: CheckIssue[] }> {
  const issues: CheckIssue[] = []
  let catalog = await readLocalCatalog()
  if (!catalog) {
    catalog = await fetchHubCatalogViaGh()
    if (!catalog) {
      issues.push({ code: 'hub-skipped', detail: 'hub catalog 不可达（无本地 catalog 且 gh 调用失败）——已跳过' })
      return { status: 'skipped', issues }
    }
  }
  const found = catalog.repos.some(r => r.name === repoName)
  if (!found) {
    issues.push({ code: 'not-in-hub', detail: `仓库 ${repoName} 未收录进 hub catalog（catalog.source.json 登记或等自动同步）` })
    return { status: 'not-in-hub', issues }
  }
  return { status: 'in-hub', issues }
}
