# dsh-plugin-check

[中文](README.md)

DSH plugin health-check tool — scans plugin repositories and diagnoses **manifest protocol / patch format / build pitfalls / hub inclusion status**, outputting compliance reports with fix suggestions. **Read-only** — it does not modify or build the checked repository.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Motivation

Plugin repositories within the organization keep growing, and the pitfalls authors have stepped into (dual cordis copies, the tsconfig trio, inconsistent patch names, residual `.ts` artifacts in build output — guaranteed runtime crashes) could have been blocked automatically. This tool turns every pitfall actually encountered into an **automatically checkable gate**: a model or CI runs `plugin_check` once against the repository directory and receives a compliance report with fix suggestions.

## Security Model

- **Read-only**: only `readdir/stat/readFile`; never modifies or builds the checked repository
- **Zero business dependencies**: only node built-in modules (fs/path/child_process)
- **Hub check is offline-first**: first reads the local hub catalog (`DSH_HUB_SOURCE` or under cwd/hub/), with the public `omdsh-dev/dsh-hub-workshop/catalog.json` fetched by `gh` as fallback; if all attempts fail, it silently degrades to `skipped` (reported truthfully, not counted as a warning)
- **Does not run tsc**: all build pitfalls are detected by static text scanning (fast, side-effect free)

## Tool Declaration

Registers the `plugin_check` tool (`@omdsh-dev/dsh-plugin-check`, row id `tool-plugin-check`), uniformly emitting JSON text.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string | ✅ | `check` / `scan` / `schema` |
| `path` | string | | Plugin repository directory (check) or parent directory (scan); defaults to the current working directory |
| `strict` | boolean | | Strict mode: warnings escalate to errors and affect the verdict; default false |

## Actions

| action | Function |
|---|---|
| `check` | Check a single plugin repository directory → compliance report (verdict/errors/warnings/suggestions) |
| `scan` | Scan all `dsh-*` plugin repositories under a parent directory (those with a package.json) → summary report |
| `schema` | Output the full list of check items and judging criteria (the check-item matrix applicable per form, for models/humans to verify) |

## Form Recognition & Check Items (Applicable Per Form, 33 Items)

| Category | error | warning |
|---|---|---|
| Manifest protocol | no-manifest / invalid-name-format / missing-main-or-types / no-patch | incomplete-files / missing-peer / no-bundle-decl |
| Patch format | malformed-patch / patch-name-mismatch / duplicate-row-id | unexpected-fields |
| Build pitfalls | no-source-entry / no-tsconfig / missing-ts-ext-imports / lib-layout-mismatch / stale-ts-imports | missing-rewrite-imports / types-path-mismatch / implicit-node-types / no-build-script |
| Ecosystem compliance (Profile Bundle) | core-row-id | missing-profile-install-example / manual-install-only / core-modification-required |
| Hub inclusion | — | not-in-hub (hub-skipped is info) |

The four ecosystem-compliance items (immediate-adjustments-bundle-profile-plan §4.5):
- `core-row-id`: the patch entry uses an official core row (tools/session/llm/web/permission);
- `missing-profile-install-example`: the README lacks a `dsh plugin --profile ... add` example;
- `manual-install-only`: cannot be installed through the standard Profile Bundle (no patch or no example in the README);
- `core-modification-required`: the default installation flow requires modifying the DSH core (git apply / cp into the monorepo; sections explicitly marked "manual installation and legacy compatibility" are not counted).

Name policy: `invalid-name-format` is an npm-format error; a legal scoped or unscoped personal name is only `non-org-recommended-name` (warning). Recommended ranges are `@deepseek-ai/*`, `@dsh-external/*`, `@omdsh/*`, and `dsh-*`.

`verdict`: 0 errors → pass; any error → fail; warnings only → warn.
`kind`: registry / skill / collection / tool-bundle / bundle / infra / unknown — different check sets apply per form (X-01 shared matrix).
`checks`: execution results of the fixed check items (total/passed/failed/warned/skipped), no longer an issue count.

## Example

```
plugin_check { action: "check", path: "C:/Users/admin/Desktop/dshext/dsh-tool-csv" }
  → {"repo":"dsh-tool-csv","kind":"tool-bundle","verdict":"pass","checks":{"total":24,"passed":24,...}}

plugin_check { action: "scan", path: "C:/Users/admin/Desktop/dshext" }
  → {"root":"...","scanned":11,"reports":[...]}   # dsh-my-rsi 等不合规仓库会带 error+suggestions
```

## npm 0.1.1-rc.1 Compatibility (Verified)

This plugin has been migrated to the npm 0.1.1-rc.1 dependency line and fully validated end-to-end in an isolated consumer of `@deepseek-ai/dsh@0.1.1-rc.1`:

- **Type/runtime**: `@deepseek-ai/cordis@^4.0.1` + `@deepseek-ai/dsh-tools@>=0.0.1-rc.1 <0.2.0` + `@deepseek-ai/dsh-invariants@>=0.0.1-rc.1 <0.2.0` (peer); no longer depends on unscoped `cordis`
- **Standalone build**: `npm install` (devDependencies self-contained: typescript/vitest/@types/node) → `npm run typecheck` → `npm test` → `npm run build` → `npm pack`
- **Consumption validation**: the tarball is installed into a 0.1.1-rc.1 consumer → `dsh --profile compat --dump-config` shows this plugin's row → the tool actually registers and executes successfully
- **Launch method**: `npx -p @deepseek-ai/dsh@0.1.1-rc.1 dsh web` (lib production mode; do not `install -g` globally)

## Installation

### Profile Bundle (Recommended)

The repository lives at [omdsh-dev/dsh-plugin-check](https://github.com/omdsh-dev/dsh-plugin-check) (public). Install this plugin as a standalone bundle into a profile (DSH 0.1.1-rc.1 (npm)):

```sh
# 交互式（web）profile
dsh plugin --profile web add github:omdsh-dev/dsh-plugin-check
# 一次性任务（headless）profile —— dsh run 默认使用 headless
dsh plugin --profile headless add github:omdsh-dev/dsh-plugin-check
```

The `dsh.bundle.patch` inside the package automatically adds the plugin to the profile's layer stack after installation (row id: `tool-plugin-check`). Missing peer dependencies of the plugin (`cordis`, `@deepseek-ai/dsh-tools`) are provided by the profile's healed `profiles/node_modules` fallback install.

> ⚠️ web and headless are **different profiles**: installing to web does not automatically cover headless; `dsh run` uses the headless profile by default. Windows paths use forward slashes (`C:/...`).

### Installing from an npm pack Tarball

Build locally and install from the tarball path (no GitHub dependency):

```sh
# tarball method (web shown; headless same)
npm pack
dsh plugin --profile web add <path to the npm pack tarball>
```

### Verify Installation

```sh
dsh --profile web --dump-config | grep tool-plugin-check
```

### Runtime Verification

```sh
dsh run "使用 plugin_check 工具检查一个插件仓库"
```

### Manual Installation & Legacy Compatibility

Legacy scenarios: monorepo integration, legacy snapshots that do not support Profile Bundle, or plugin development/debugging environments (local junction/symlink, manually editing profile layers).
## Testing

```bash
node <monorepo>/node_modules/vitest/vitest.mjs run tests   # 38 用例
```

- `manifest.spec.ts` / `patch.spec.ts` / `build-check.spec.ts`: hit and no-false-positive for every check item (fixtures generated in temporary directories)
- `report.spec.ts`: verdict determination (including strict escalation), suggestions templates, hub-skipped does not escalate
- `register.spec.ts`: registration contract (AUDIT-CROSS-02 style)

## Self-Check Baseline (Measured 2026-08-08)

All 8 plugins in the organization (time/encoding/json/calculator/csv/regex/markdown/session-health) **pass with zero errors and zero warnings**. During checking, real compliance defects in 4 legacy plugins were found and fixed (tsconfig missing the trio — rebuilding would produce bad artifacts; missing build/prepack scripts).

## License

MIT
