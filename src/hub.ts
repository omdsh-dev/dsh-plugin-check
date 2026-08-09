/**
 * §3.4 hub 收录状态检查 v2 —— 审查 PC-09 修复：
 * 仓库身份优先从 git remote 解析（owner/repo），失败再回退目录 basename；
 * not-in-hub 的修复建议按形态推荐分类。
 */

import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { RepoKind } from './form.ts'
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

/** 经 gh CLI 读取远端 hub catalog（失败返回 null）。 */
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

/** 从 git remote URL 提取仓库名；失败返回 null。 */
export async function repoNameFromGitRemote(dir: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile('git', ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error) { resolve(null); return }
      const url = stdout.trim()
      // git@github.com:owner/repo.git | https://github.com/owner/repo.git | owner/repo
      const m = /(?:github\.com[:/])([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(url)
        ?? /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(url)
      resolve(m ? m[2]! : null)
    })
  })
}

/** 仓库身份：git remote → basename 回退。 */
export async function resolveRepoIdentity(dir: string): Promise<string> {
  const fromRemote = await repoNameFromGitRemote(dir)
  return fromRemote ?? basename(dir)
}

/** 按形态推荐 hub 分类。 */
export function recommendedCategory(kind: RepoKind): string {
  switch (kind) {
    case 'collection': return 'collection'
    case 'skill': return 'skill'
    case 'registry': return 'plugin'
    case 'bundle': case 'tool-bundle': return 'plugin'
    default: return '（按仓库实际形态登记正确分类）'
  }
}

/** 检查仓库是否被 hub catalog 收录；网络/工具不可用时返回 'skipped'。 */
export async function checkHubStatus(repoName: string, kind: RepoKind): Promise<{ status: HubStatus; issues: CheckIssue[] }> {
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
    issues.push({
      code: 'not-in-hub',
      detail: `仓库 ${repoName} 未收录进 hub catalog（catalog.source.json 登记为 ${recommendedCategory(kind)}，或等自动同步）`,
    })
    return { status: 'not-in-hub', issues }
  }
  return { status: 'in-hub', issues }
}
