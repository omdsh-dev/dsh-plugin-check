/**
 * registry 形态校验 —— 审查 PC-01 修复：dsh.plugin.json 核心契约的
 * 零依赖子集（与 plugin-registry 官方 ManifestSchema 对齐方向一致）：
 * id 格式 / version / main 与 client.main containment / engines.dsh semver / contributes 结构。
 * 完整 schema 复用列为后续项（避免复制一份漂移 schema）。
 */
import type { CheckIssue } from './report.ts';
export declare function checkRegistry(dir: string): Promise<CheckIssue[]>;
