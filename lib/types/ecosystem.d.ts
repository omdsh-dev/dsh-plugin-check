/**
 * 生态合规检查 —— Profile Bundle 安装边界（immediate-adjustments-bundle-profile-plan §4.5）。
 *
 * 新增检查项（只读）：
 * - core-row-id（error）：patch 条目使用了官方核心 row id（tools/session/llm/web/permission 等）；
 * - missing-profile-install-example（warning）：README 没有任何 `dsh plugin --profile ... add` 示例；
 * - manual-install-only（warning）：无法通过标准 Profile Bundle 安装（无 patch，或 README 只有手动流程）；
 * - core-modification-required（warning）：README 默认流程/脚本要求修改 DSH 核心（git apply 到核心、
 *   cp/rsync 进 monorepo、编辑官方 profile 文件）。明确标注"手动安装与旧版本兼容/旧版本兼容"的段落不计入。
 */
import type { CheckIssue } from './report.ts';
import type { RepoKind } from './form.ts';
/** 官方核心 row id 黑名单（plan §5.2）：社区插件不得使用。 */
export declare const FORBIDDEN_CORE_ROWS: string[];
/** README 安装边界检查（bundle/tool-bundle/collection 适用）。 */
export declare function checkProfileInstallDocs(dir: string, kind: RepoKind): Promise<CheckIssue[]>;
/** 标准可安装性信号：有 bundle patch 声明 + README 有 profile add 示例。 */
export declare function isBundleInstallable(patchDeclared: boolean, docsIssues: CheckIssue[]): boolean;
/** patch 条目 core row id 检查（bundle/tool-bundle 适用）。 */
export declare function checkCoreRowIds(entries: Array<{
    id: string;
}>): CheckIssue[];
