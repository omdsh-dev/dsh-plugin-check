/**
 * §3.3 构建陷阱检查 v2 —— 审查 PC-05/PC-06/PC-08/PC-11 修复。
 *
 * - tsconfig `extends` 递归解析（共享 base 模式不再误报；解析失败标 skipped）；
 * - 导入扫描覆盖 from / import() / require() / 副作用 import / .tsx/.mts/.cts；
 *   lib 额外扫描 `new URL('./x.ts')`（worker 入口残留）；
 * - 文件收集带资源预算（文件数/总字节）且 lstat 拒绝 symlink；
 * - 动态严重度：src 用 .ts 导入 + 缺 rewrite → error（确定性运行时崩溃）；
 *   lib 缺失 + 无 build 脚本 → error（clean checkout 无入口）。
 */
import type { RepoKind } from './form.ts';
import type { CheckIssue } from './report.ts';
export interface ResolvedTsconfig {
    compilerOptions: Record<string, unknown>;
    /** extends 链是否全部解析成功。 */
    resolved: boolean;
    /** 解析失败原因（resolved=false 时）。 */
    skipReason?: string;
}
/** 递归解析 tsconfig（extends 相对文件路径；深度上限；失败返回 resolved:false）。 */
export declare function resolveTsconfig(dir: string): Promise<ResolvedTsconfig | null>;
/** 静态构建陷阱检查。tool-bundle 检查 TypeScript 源码与 tsconfig；
 * 普通 bundle 只检查已发布 lib 产物和 build/prepack/prepare 信号。 */
export declare function checkBuildPitfalls(dir: string, kind: RepoKind, pkg: Record<string, unknown> | null): Promise<CheckIssue[]>;
