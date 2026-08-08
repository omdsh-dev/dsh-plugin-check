# dsh-plugin-check

DSH 插件健康检查工具（占位）—— 扫描插件仓库，诊断**清单协议 / patch 格式 / 构建陷阱 / hub 收录状态**，输出合规报告与修复建议。**只读**，不修改、不构建被检查仓库。

**状态**：🔵 占位中（实施文档已就绪，待实施）

## 计划能力

- 注册 `plugin_check` 工具：`check`（单仓库）/ `scan`（目录批量）/ `schema`（检查项清单）
- 检测项全部来自组织实测踩坑（见 dsh-plugin-dev）：
  - 清单协议：`package.json` 存在性、name 规范、main/types 指向、peer 依赖、bundle 声明
  - patch 格式：`cordis.patch.yml` 的 insert 结构、name 与包名一致性、row id 唯一
  - 构建陷阱：tsconfig 三件套（`allowImportingTsExtensions` / `rewriteRelativeImportExtensions` / node types）、lib 布局一致性、产物 `.ts` 残留（运行时必崩）
  - hub 收录：catalog 登记状态（离线优先，无网络静默降级）

## 关联仓库

| 仓库 | 关系 |
|---|---|
| [dsh-plugin-dev](../dsh-plugin-dev) | 踩坑与做法档案（检测项的事实来源） |
| [dsh-session-health](../dsh-session-health) | 同族模式：扫描诊断 → 报告 → 建议 |
| [dsh-inspect](../dsh-inspect) | 互补：代码质量 checkup→fix→review 工作流 |
| [dsh-external-research](../dsh-external-research) | 互补：mainline 兼容性监控 |

> 正在开发中——若你有相同计划，欢迎联系作者合并，避免重复造轮子。
