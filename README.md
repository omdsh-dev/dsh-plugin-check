# dsh-plugin-check

DSH 插件健康检查工具 —— 扫描插件仓库，诊断**清单协议 / patch 格式 / 构建陷阱 / hub 收录状态**，输出合规报告与修复建议。**只读**，不修改、不构建被检查仓库。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 动机

组织内插件仓库持续增长，作者踩过的坑（cordis 双副本、tsconfig 三件套、patch name 不一致、产物 `.ts` 残留——运行时必崩）本可以自动化拦截。本工具把全部实测踩坑变成**可自动检查的门禁**：模型或 CI 直接对仓库目录跑一次 `plugin_check`，拿合规报告与修复建议。

## 安全模型

- **只读**：仅 `readdir/stat/readFile`，绝不修改或构建被检查仓库
- **零业务依赖**：仅 node 内置模块（fs/path/child_process）
- **hub 检查离线优先**：先读本地 hub catalog（`DSH_HUB_SOURCE` 或 cwd/hub/ 下），gh 调用作 fallback；全部失败静默降级 `skipped`（报告如实标注，不算警告）
- **不执行 tsc**：构建陷阱全部静态文本扫描（快、无副作用）

## 工具声明

注册 `plugin_check` 工具（`@deepseek-ai/dsh-plugin-check`，row id `tool-plugin-check`），统一输出 JSON 文本。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `action` | string | ✅ | `check` / `scan` / `schema` |
| `path` | string | | 插件仓库目录（check）或父目录（scan）；默认当前工作目录 |
| `strict` | boolean | | strict 模式：warning 升级为 error 影响 verdict，默认 false |

## Actions

| action | 功能 |
|---|---|
| `check` | 检查单个插件仓库目录 → 合规报告（verdict/errors/warnings/suggestions） |
| `scan` | 扫描父目录下所有 `dsh-*` 插件仓库（有 package.json 者）→ 汇总报告 |
| `schema` | 输出全部检测项清单与判定标准（按形态适用的检测项矩阵，供模型/人核对） |

## 形态识别与检测项（按形态适用，29 项）

| 类别 | error | warning |
|---|---|---|
| 清单协议 | no-manifest / invalid-name / missing-main-or-types / no-patch | incomplete-files / missing-peer / no-bundle-decl |
| patch 格式 | malformed-patch / patch-name-mismatch / duplicate-row-id | unexpected-fields |
| 构建陷阱 | no-source-entry / no-tsconfig / missing-ts-ext-imports / lib-layout-mismatch / stale-ts-imports | missing-rewrite-imports / types-path-mismatch / implicit-node-types / no-build-script |
| hub 收录 | — | not-in-hub（hub-skipped 为 info） |

`verdict`：0 error → pass；有 error → fail；仅 warning → warn。
`kind`：registry / skill / collection / tool-bundle / bundle / infra / unknown——按形态套用不同检查集（X-01 共享矩阵）。
`checks`：固定检查项的执行结果（total/passed/failed/warned/skipped），不再是 issue 数。

## 示例

```
plugin_check { action: "check", path: "C:/Users/admin/Desktop/dshext/dsh-tool-csv" }
  → {"repo":"dsh-tool-csv","kind":"tool-bundle","verdict":"pass","checks":{"total":24,"passed":24,...}}

plugin_check { action: "scan", path: "C:/Users/admin/Desktop/dshext" }
  → {"root":"...","scanned":11,"reports":[...]}   # dsh-my-rsi 等不合规仓库会带 error+suggestions
```

## 接入方式

```bash
dsh plugin --profile web add "C:/path/to/dsh-plugin-check"
dsh plugin --profile headless add "C:/path/to/dsh-plugin-check"
dsh --profile web --dump-config | grep plugin-check
dsh run "用 plugin_check 检查 dsh-tool-csv 仓库"     # 端到端
```

## 测试

```bash
node <monorepo>/node_modules/vitest/vitest.mjs run tests   # 38 用例
```

- `manifest.spec.ts` / `patch.spec.ts` / `build-check.spec.ts`：每项检测的命中与不误报（fixtures 临时目录生成）
- `report.spec.ts`：verdict 判定（含 strict 升级）、suggestions 模板、hub-skipped 不升级
- `register.spec.ts`：注册契约（AUDIT-CROSS-02 风格）

## 自检基线（2026-08-08 实测）

组织内 8 个插件（time/encoding/json/calculator/csv/regex/markdown/session-health）**全部 pass、零 error、零 warning**。检查过程发现并修复了 4 个旧插件的真实合规缺陷（tsconfig 缺三件套——重建会产生坏产物；缺 build/prepack scripts）。

## 许可

MIT
