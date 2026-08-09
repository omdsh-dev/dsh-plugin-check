/**
 * patch 解析 v2 —— 审查 PC-03/X-02 修复。
 *
 * 目标：对齐官方 bundle patch（PatchOptions）语义，而不是只认工作区
 * 简单工具插件的 id/name 两字段：
 * - 支持 insert / update / disable 三种 section；
 * - 剥离行内注释（`id: a # comment` → id="a"）；
 * - `config` 是合法字段（不再标 unexpected-fields），其嵌套子行按缩进归属；
 * - 只对 insert 形态要求 id（update/disable 也要求 id，但语义不同）；
 * - 未知顶层 section 报错；条目内未知字段仍给 warning。
 *
 * 行级解析（零依赖）：以缩进判断归属层级，注释剥离尊重引号。
 */
export interface PatchSection {
    op: 'insert' | 'update' | 'disable' | 'unknown';
    entries: PatchEntry[];
    /** section 级解析错误（不含条目内字段校验）。 */
    errors: string[];
}
export interface PatchEntry {
    id: string;
    name: string;
    fields: string[];
}
/** 解析 bundle patch 文本为 sections。 */
export declare function parsePatchSections(text: string): PatchSection[];
/** 兼容旧 API：取所有 insert entries。 */
export declare function parsePatchInsert(text: string): {
    entries: PatchEntry[];
    errors: string[];
};
/** 检查插件仓库的 cordis.patch.yml（bundle 形态；审查 X-02：config 等官方字段合法）。 */
export declare function checkPatch(dir: string, kind: 'bundle' | 'tool-bundle', pkgName: string | undefined): Promise<import('./report.ts').CheckIssue[]>;
