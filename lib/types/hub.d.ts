/**
 * §3.4 hub 收录状态检查 v2 —— 审查 PC-09 修复：
 * 仓库身份优先从 git remote 解析（owner/repo），失败再回退目录 basename；
 * not-in-hub 的修复建议按形态推荐分类。
 */
import type { RepoKind } from './form.ts';
import type { CheckIssue } from './report.ts';
export type HubStatus = 'in-hub' | 'not-in-hub' | 'skipped';
/** 从 git remote URL 提取仓库名；失败返回 null。 */
export declare function repoNameFromGitRemote(dir: string): Promise<string | null>;
/** 仓库身份：git remote → basename 回退。 */
export declare function resolveRepoIdentity(dir: string): Promise<string>;
/** 按形态推荐 hub 分类。 */
export declare function recommendedCategory(kind: RepoKind): string;
/** 检查仓库是否被 hub catalog 收录；网络/工具不可用时返回 'skipped'。 */
export declare function checkHubStatus(repoName: string, kind: RepoKind): Promise<{
    status: HubStatus;
    issues: CheckIssue[];
}>;
