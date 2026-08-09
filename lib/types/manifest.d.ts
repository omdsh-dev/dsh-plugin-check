/**
 * bundle 形态清单协议检查（审查 PC-02/PC-04/PC-07 修复）：
 * 只适用于 bundle / tool-bundle；main/types 与 dsh.bundle.patch 走真实路径 containment；
 * name 用完整 npm 规则 + 组织政策校验。registry/skill/collection 由各自模块处理。
 */
import type { CheckIssue } from './report.ts';
export interface ManifestResult {
    issues: CheckIssue[];
    pkg: Record<string, unknown> | null;
}
/** 检查 bundle 仓库的 package.json 清单协议。 */
export declare function checkManifest(dir: string): Promise<ManifestResult>;
