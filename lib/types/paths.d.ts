/**
 * 路径围栏与资源预算工具 —— 审查 PC-04/PC-08 修复。
 * 所有声明路径（main/types/dsh.bundle.patch/registry main/client.main）都必须
 * 落在仓库根内：拒绝绝对路径、词法 `..` 逃逸、symlink 指向根外、非普通文件。
 */
export type ContainmentResult = {
    ok: true;
    path: string;
} | {
    ok: false;
    reason: string;
};
/**
 * 声明路径 containment：词法 + 真实路径（realpath）双重校验。
 * 目标必须是仓库根内的普通文件（lstat 拒绝 symlink；realpath 兜底防 junction 逃逸）。
 */
export declare function resolveWithin(root: string, target: string): Promise<ContainmentResult>;
/** npm 包名校验（PC-07）：近似 validate-npm-package-name 的零依赖子集。 */
export declare function isValidPackageName(name: string): boolean;
/** 组织命名政策：当前生态组织 scopes 与 dsh-* 前缀（前缀后必须有实际名称）。 */
export declare function matchesOrgPolicy(name: string): boolean;
/** 最小 semver 版本格式校验。 */
export declare function isValidSemver(version: unknown): version is string;
/** 最小 semver range 校验（^ ~ >= <= > < 或裸版本或 *）。 */
export declare function isValidSemverRange(range: unknown): range is string;
/** 资源预算：lstat 收集文件（跳过 symlink），带文件数与总字节上限。 */
export interface ScanBudget {
    maxFiles: number;
    maxBytes: number;
}
export declare const DEFAULT_SCAN_BUDGET: ScanBudget;
export declare function collectTextsBounded(dir: string, exts: string[], budget?: ScanBudget, maxDepth?: number): Promise<{
    texts: string[];
    truncated: boolean;
}>;
