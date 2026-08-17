/**
 * registry 形态校验 —— 审查 PC-01 修复：dsh.plugin.json 核心契约的
 * 零依赖子集（与 plugin-registry 官方 ManifestSchema 对齐方向一致）：
 * id 格式 / version / main 与 client.main containment / engines.dsh semver / contributes 结构。
 * 完整 schema 复用列为后续项（避免复制一份漂移 schema）。
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { isValidPackageName, isValidSemver, isValidSemverRange, resolveWithin } from './paths.js';
const REGISTRY_ID_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/;
export async function checkRegistry(dir) {
    const issues = [];
    const manifestPath = join(dir, 'dsh.plugin.json');
    let manifest;
    try {
        manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    }
    catch {
        issues.push({ code: 'malformed-registry-manifest', detail: 'dsh.plugin.json 缺失或非法 JSON' });
        return issues;
    }
    // id
    const id = manifest['id'];
    if (typeof id !== 'string' || !REGISTRY_ID_RE.test(id)) {
        issues.push({ code: 'invalid-registry-id', detail: `id 应为小写字母数字与连字符（可含一段 /），实际: ${String(id)}` });
    }
    // version
    const version = manifest['version'];
    if (!isValidSemver(version)) {
        issues.push({ code: 'invalid-registry-version', detail: `version 应为 semver，实际: ${String(version)}` });
    }
    // main：必须存在且在插件根内
    const main = manifest['main'];
    if (typeof main !== 'string' || main === '') {
        issues.push({ code: 'registry-main-missing', detail: 'main 未声明' });
    }
    else {
        const r = await resolveWithin(dir, main);
        if (!r.ok)
            issues.push({ code: 'registry-main-missing', detail: `main 无效: ${r.reason}` });
    }
    // client.main：同 containment（若声明 client）
    const client = manifest['client'];
    if (client !== undefined && typeof client === 'object') {
        if (typeof client['main'] === 'string' && client['main'] !== '') {
            const r = await resolveWithin(dir, client['main']);
            if (!r.ok)
                issues.push({ code: 'registry-client-main', detail: `client.main 无效: ${r.reason}` });
        }
        if (client['inject'] !== undefined && !Array.isArray(client['inject'])) {
            issues.push({ code: 'registry-client-contract', detail: 'client.inject 应为字符串数组' });
        }
    }
    // engines.dsh：semver range
    const engines = manifest['engines'];
    if (engines !== undefined && typeof engines === 'object' && engines['dsh'] !== undefined) {
        if (!isValidSemverRange(engines['dsh'])) {
            issues.push({ code: 'invalid-engines-dsh', detail: `engines.dsh 不是合法 semver range: ${String(engines['dsh'])}` });
        }
    }
    // contributes：结构检查
    const contributes = manifest['contributes'];
    if (contributes !== undefined && typeof contributes === 'object') {
        for (const key of ['tools', 'skills']) {
            const v = contributes[key];
            if (v !== undefined && !Array.isArray(v)) {
                issues.push({ code: 'malformed-contributes', detail: `contributes.${key} 应为数组` });
            }
        }
    }
    // 可选：package.json name 与 id 的关系（存在时）
    try {
        const pkg = JSON.parse(await fs.readFile(join(dir, 'package.json'), 'utf8'));
        if (typeof pkg['name'] === 'string' && !isValidPackageName(pkg['name'])) {
            issues.push({ code: 'invalid-name-format', detail: `package name 非法: ${pkg['name']}` });
        }
    }
    catch {
        // registry 原生插件允许无 package.json
    }
    return issues;
}
