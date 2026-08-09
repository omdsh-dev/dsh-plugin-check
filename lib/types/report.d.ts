/**
 * 报告聚合 v2 —— 审查 PC-10 修复：checks 统计改为"固定检查项的执行结果"
 * （pass/fail/warn/skipped 按形态适用矩阵），不再把 issue 数伪装成 coverage。
 */
import type { RepoKind } from './form.ts';
export interface CheckIssue {
    code: string;
    detail: string;
}
export interface CheckItemResult {
    code: string;
    status: 'pass' | 'fail' | 'warn' | 'skipped';
}
export interface RepoReport {
    repo: string;
    path: string;
    kind: RepoKind;
    verdict: 'pass' | 'warn' | 'fail';
    errors: CheckIssue[];
    warnings: CheckIssue[];
    skipped: string[];
    checks: {
        total: number;
        passed: number;
        failed: number;
        warned: number;
        skipped: number;
    };
    suggestions: string[];
}
export declare function isErrorCode(code: string): boolean;
/** 检测项元数据 + 形态适用矩阵（X-01：checker 与 plugin-dev 共享的规则来源）。 */
export interface CheckItemDef {
    code: string;
    severity: 'error' | 'warning' | 'info';
    description: string;
    appliesTo: RepoKind[];
}
export declare const CHECK_SCHEMA: CheckItemDef[];
/** 按形态计算固定检查项结果。 */
export declare function computeCheckResults(issues: CheckIssue[], kind: RepoKind): CheckItemResult[];
/** 聚合单仓库报告。 */
export declare function buildRepoReport(repo: string, path: string, kind: RepoKind, issues: CheckIssue[], strict: boolean): RepoReport;
