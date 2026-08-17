/** Hub 收录状态检查。
 * 默认从公开 omdsh-dev/dsh-hub-workshop catalog.json 读取；本地 DSH_HUB_SOURCE
 * 优先，兼容旧 { repos: [{ name }] } catalog 与 dsh-hub-index/v0.4。
 */
import type { RepoKind } from './form.ts';
import type { CheckIssue } from './report.ts';
export type HubStatus = 'in-hub' | 'not-in-hub' | 'skipped';
export interface HubPackage {
    id?: unknown;
    name?: unknown;
    repository?: unknown;
    url?: unknown;
    [key: string]: unknown;
}
export interface ModernHubCatalog {
    format: 'dsh-hub-index/v0.4';
    packages: HubPackage[];
}
export interface LegacyHubCatalog {
    repos: Array<{
        name: string;
    }>;
}
export type HubCatalog = ModernHubCatalog | LegacyHubCatalog;
/** Parse and validate both the current and legacy catalog formats. */
export declare function parseHubCatalog(value: unknown): HubCatalog | null;
/** Parse JSON text without throwing, suitable for injected/network responses. */
export declare function parseHubCatalogText(text: string): HubCatalog | null;
/** Match a repo identity against a parsed catalog. Exported for offline tests. */
export declare function catalogMatches(catalog: HubCatalog, identity: string): boolean;
/** Compatibility alias for callers/tests that prefer a verb-style name. */
export declare const matchesHubCatalog: typeof catalogMatches;
export type FetchFailure = 'command-missing' | 'timeout' | 'permission-or-404' | 'response-too-large' | 'json-or-schema';
/** Public catalog endpoint and raw-media gh arguments (kept exported for offline tests). */
export declare const HUB_CATALOG_GH_ARGS: readonly ['api', 'repos/omdsh-dev/dsh-hub-workshop/contents/catalog.json', '-H', 'Accept: application/vnd.github.raw+json'];
export declare function classifyGhFailure(error: {
    code?: string | number;
    killed?: boolean;
    signal?: string;
} | null, stderr: string): FetchFailure;
export declare function repoNameFromGitRemote(dir: string): Promise<string | null>;
/** 仓库身份：owner/repo from git remote → basename fallback. */
export declare function resolveRepoIdentity(dir: string): Promise<string>;
export declare function recommendedCategory(kind: RepoKind): string;
export declare function checkHubStatus(repoIdentity: string, kind: RepoKind): Promise<{
    status: HubStatus;
    issues: CheckIssue[];
}>;
