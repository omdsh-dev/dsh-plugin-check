/**
 * DSH 插件健康检查插件 v2 —— 审查 PC-02/X-01 修复。
 *
 * 按项目形态（registry / skill / collection / bundle / tool-bundle / unknown）
 * 分流检查规则，不再把 TypeScript 工具 bundle 模板当作唯一合规协议：
 * - registry → dsh.plugin.json 契约校验；
 * - skill → SKILL.md frontmatter 基本校验；
 * - collection → catalog.json 结构校验；
 * - bundle / tool-bundle → 清单 + patch + 构建陷阱；
 * - unknown → 明确标注 unsupported，不强行 fail。
 *
 * 安全边界：只读；路径 containment（防逃逸/symlink）；资源预算；
 * hub 检查离线优先、失败静默降级。
 */
import type { Context } from '@deepseek-ai/cordis';
import { checkHubStatus } from './hub.ts';
import { type RepoReport } from './report.ts';
export declare const name = "@omdsh-dev/dsh-plugin-check";
export declare const inject: string[];
export type HubStatusChecker = typeof checkHubStatus;
/** 检查单个仓库（按形态分流）。hub checker 可注入，便于离线测试/批量调用复用 catalog。 */
export declare function checkRepo(dir: string, strict: boolean, hubChecker?: HubStatusChecker): Promise<RepoReport>;
/** 扫描目录下所有 dsh-* 插件仓库并逐个检查（lstat 跳过 symlink，仓库数预算）。 */
export declare function scanDir(parent: string, strict: boolean): Promise<{
    root: string;
    scanned: number;
    reports: RepoReport[];
}>;
export declare function apply(ctx: Context): void;
