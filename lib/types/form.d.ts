/**
 * 项目形态检测 —— 审查 PC-01/PC-02 修复：先识别仓库形态，
 * 按 registry / skill / collection / bundle / tool-bundle / unknown 分流，
 * 不再把 "TypeScript 工具 bundle 模板" 当成唯一合规协议。
 */
export type RepoKind = 'registry' | 'skill' | 'collection' | 'tool-bundle' | 'bundle' | 'infra' | 'unknown';
export declare const KIND_LABELS: Record<RepoKind, string>;
/** 判定工具插件：src 文本中出现 @deepseek-ai/dsh-tools 的任意引入形式（含子路径）。 */
export declare function looksLikeToolPlugin(srcTexts: string[]): boolean;
/** 检测目录的项目形态。 */
export declare function detectKind(dir: string): Promise<RepoKind>;
/** 收集 src/ 下全部 .ts 内容（有预算，lstat 不跟 symlink）。 */
export declare function collectSrcTexts(dir: string, limitBytes?: number): Promise<string[]>;
