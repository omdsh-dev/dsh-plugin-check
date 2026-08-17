/** Hub 收录状态检查。
 * 默认从公开 omdsh-dev/dsh-hub-workshop catalog.json 读取；本地 DSH_HUB_SOURCE
 * 优先，兼容旧 { repos: [{ name }] } catalog 与 dsh-hub-index/v0.4。
 */
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
function localCatalogCandidates() {
    const env = process.env['DSH_HUB_SOURCE'];
    const out = [];
    if (env)
        out.push(env);
    out.push(join(process.cwd(), 'hub', 'catalog.source.json'), join(process.cwd(), 'hub', 'catalog.json'), join(homedir(), '.dsh', 'hub', 'catalog.source.json'));
    return out;
}
/** Parse and validate both the current and legacy catalog formats. */
export function parseHubCatalog(value) {
    if (!value || typeof value !== 'object')
        return null;
    const record = value;
    const packages = record['packages'];
    const format = record['format'] ?? record['schema'] ?? record['$schema'];
    if (Array.isArray(packages) && (format === 'dsh-hub-index/v0.4' || format === undefined)) {
        const valid = packages.every(item => item !== null && typeof item === 'object' && typeof item['id'] === 'string');
        if (valid)
            return { format: 'dsh-hub-index/v0.4', packages: packages };
    }
    const repos = record['repos'];
    if (Array.isArray(repos) && repos.every(item => item !== null && typeof item === 'object' && typeof item['name'] === 'string')) {
        return { repos: repos };
    }
    return null;
}
/** Parse JSON text without throwing, suitable for injected/network responses. */
export function parseHubCatalogText(text) {
    try {
        return parseHubCatalog(JSON.parse(text));
    }
    catch {
        return null;
    }
}
function repositoryIdentity(value) {
    if (typeof value !== 'string')
        return null;
    let text = value.trim().replace(/\.git$/, '');
    text = text.replace(/^github:/, '');
    const github = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(text);
    if (github)
        return `${github[1]}/${github[2]}`;
    if (/^[^/\s]+\/[^/\s]+$/.test(text))
        return text;
    return null;
}
function repositoryName(value) {
    const identity = repositoryIdentity(value);
    return identity ? identity.slice(identity.lastIndexOf('/') + 1) : null;
}
/** Match a repo identity against a parsed catalog. Exported for offline tests. */
export function catalogMatches(catalog, identity) {
    if ('repos' in catalog) {
        const name = basename(identity);
        return catalog.repos.some(repo => repo.name === name);
    }
    const normalized = repositoryIdentity(identity);
    const name = basename(identity);
    return catalog.packages.some(pkg => {
        // Current index is owner/repo-first. A bare name is only accepted when
        // identity itself came from basename fallback, avoiding cross-owner hits.
        for (const value of [pkg.id, pkg.repository, pkg.url]) {
            if (typeof value === 'string' && (value === identity ||
                repositoryIdentity(value) === normalized ||
                (normalized === null && repositoryName(value) === name)))
                return true;
        }
        if (typeof pkg.name === 'string') {
            return pkg.name === identity || (normalized === null && pkg.name === name) || repositoryName(pkg.name) === normalized;
        }
        return false;
    });
}
/** Compatibility alias for callers/tests that prefer a verb-style name. */
export const matchesHubCatalog = catalogMatches;
async function readLocalCatalog() {
    for (const path of localCatalogCandidates()) {
        try {
            const parsed = parseHubCatalogText(await fs.readFile(path, 'utf8'));
            if (parsed)
                return parsed;
        }
        catch { /* try the next candidate */ }
    }
    return null;
}
/** Public catalog endpoint and raw-media gh arguments (kept exported for offline tests). */
export const HUB_CATALOG_GH_ARGS = [
    'api',
    'repos/omdsh-dev/dsh-hub-workshop/contents/catalog.json',
    '-H',
    'Accept: application/vnd.github.raw+json',
];
export function classifyGhFailure(error, stderr) {
    if (error?.code === 'ENOENT')
        return 'command-missing';
    if (error?.code === 'ENOBUFS')
        return 'response-too-large';
    if (error?.code === 'ETIMEDOUT' || error?.killed || error?.signal === 'SIGTERM')
        return 'timeout';
    if (/\b(401|403|404)\b|permission|forbidden|not found|authentication/i.test(stderr))
        return 'permission-or-404';
    return 'json-or-schema';
}
/** Fetch the public catalog through gh, without exposing command output/tokens. */
let remoteCatalogFetch = null;
async function fetchHubCatalogViaGh() {
    // A check/scan can inspect many repositories in one process. Share the
    // single public catalog request so each report does not spawn gh again.
    if (remoteCatalogFetch)
        return remoteCatalogFetch;
    remoteCatalogFetch = new Promise(resolve => {
        execFile('gh', [...HUB_CATALOG_GH_ARGS], {
            timeout: 15000,
            maxBuffer: 8 * 1024 * 1024,
            windowsHide: true,
        }, (error, stdout, stderr) => {
            if (error) {
                resolve({ catalog: null, failure: classifyGhFailure(error, stderr) });
                return;
            }
            try {
                // The raw media Accept header returns catalog JSON directly. Do not
                // base64-decode it: Contents API omits `.content` for large files.
                const catalog = parseHubCatalogText(stdout);
                resolve(catalog ? { catalog } : { catalog: null, failure: 'json-or-schema' });
            }
            catch {
                resolve({ catalog: null, failure: 'json-or-schema' });
            }
        });
    });
    return remoteCatalogFetch;
}
function failureDetail(failure) {
    switch (failure) {
        case 'command-missing': return '公共 hub catalog 不可达：未找到 gh 命令（command missing）';
        case 'timeout': return '公共 hub catalog 不可达：gh 请求超时（timeout）';
        case 'permission-or-404': return '公共 hub catalog 不可达：无权限或资源不存在（permission/404）';
        case 'response-too-large': return '公共 hub catalog 不可达：响应超过读取上限（response too large）';
        case 'json-or-schema': return '公共 hub catalog 不可达：响应不是合法 JSON 或不符合 dsh-hub-index/v0.4/旧 catalog schema';
    }
}
export async function repoNameFromGitRemote(dir) {
    return new Promise(resolve => {
        execFile('git', ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: 1000, windowsHide: true }, (error, stdout) => {
            if (error) {
                resolve(null);
                return;
            }
            const identity = repositoryIdentity(stdout.trim());
            resolve(identity);
        });
    });
}
/** 仓库身份：owner/repo from git remote → basename fallback. */
export async function resolveRepoIdentity(dir) {
    const fromRemote = await repoNameFromGitRemote(dir);
    return fromRemote ?? basename(dir);
}
export function recommendedCategory(kind) {
    switch (kind) {
        case 'collection': return 'collection';
        case 'skill': return 'skill';
        case 'registry': return 'plugin';
        case 'bundle':
        case 'tool-bundle': return 'plugin';
        default: return '（按仓库实际形态登记正确分类）';
    }
}
export async function checkHubStatus(repoIdentity, kind) {
    const local = await readLocalCatalog();
    let catalog = local;
    let skippedDetail;
    if (!catalog) {
        const remote = await fetchHubCatalogViaGh();
        catalog = remote.catalog;
        if (!catalog)
            skippedDetail = failureDetail(remote.failure ?? 'json-or-schema');
    }
    if (!catalog) {
        return {
            status: 'skipped',
            issues: [{ code: 'hub-skipped', detail: `${skippedDetail ?? 'hub catalog 不可达'}——已跳过（未泄露认证信息）` }],
        };
    }
    if (!catalogMatches(catalog, repoIdentity)) {
        return {
            status: 'not-in-hub',
            issues: [{ code: 'not-in-hub', detail: `仓库 ${repoIdentity} 未收录进 hub workshop catalog（按 ${recommendedCategory(kind)} 形态补充 intake 条目，或等待 catalog 同步）` }],
        };
    }
    return { status: 'in-hub', issues: [] };
}
