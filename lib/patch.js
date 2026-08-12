import { join } from 'node:path';
/** 剥离行内注释（# 前有空白且不在引号内）。 */
function stripInlineComment(line) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === "'" && !inDouble)
            inSingle = !inSingle;
        else if (c === '"' && !inSingle)
            inDouble = !inDouble;
        else if (c === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
            return line.slice(0, i).trimEnd();
        }
    }
    return line.trimEnd();
}
function stripQuotes(value) {
    const m = /^(['"])(.*)\1$/.exec(value);
    return m ? m[2] : value;
}
/** 解析 bundle patch 文本为 sections。 */
export function parsePatchSections(text) {
    const sections = [];
    let current;
    let currentEntry;
    // 跟踪 config 等嵌套字段的开始缩进，其更深子行全部归属该字段
    let nestedFieldIndent = -1;
    const ensureEntry = () => {
        if (!currentEntry) {
            currentEntry = { id: '', name: '', fields: [] };
            current?.entries.push(currentEntry);
        }
        return currentEntry;
    };
    for (const raw of text.split('\n')) {
        const line = stripInlineComment(raw);
        if (line.trim() === '')
            continue;
        const indent = line.length - line.trimStart().length;
        const content = line.trim();
        // 顶层 section：`- insert:` / `- update:` / `- disable:`
        const sectionRe = /^- (insert|update|disable):$/.exec(content);
        if (sectionRe) {
            current = { op: sectionRe[1], entries: [], errors: [] };
            sections.push(current);
            currentEntry = undefined;
            nestedFieldIndent = -1;
            continue;
        }
        // 顶层裸 `- id: x` → id-targeted update（plan §4.3 "覆盖已有 row" 形态，
        // config 整块重述；与官方 PatchOptions 的 id-targeted 语义一致）
        if (indent === 0) {
            const topIdRe = /^- id:\s*(.+)$/.exec(content);
            if (topIdRe) {
                current = { op: 'update', entries: [], errors: [] };
                sections.push(current);
                currentEntry = { id: stripQuotes(topIdRe[1]), name: '', fields: [] };
                current.entries.push(currentEntry);
                nestedFieldIndent = -1;
                continue;
            }
            // 未知顶层条目（如 `- foo:`）→ 记入 unknown section
            if (content.startsWith('- ')) {
                current = { op: 'unknown', entries: [], errors: [`unknown top-level entry: ${content.slice(0, 40)}`] };
                sections.push(current);
                currentEntry = undefined;
                continue;
            }
        }
        if (!current) {
            sections.push({ op: 'unknown', entries: [], errors: [`content before any section: ${content.slice(0, 40)}`] });
            current = sections[sections.length - 1];
            continue;
        }
        // 嵌套吸收（Issue #1）：config 吸收线（含列表项、任意缩进内容）内的行整体跳过，
        // 必须位于 entryRe/fieldRe 解析之前，否则 `- item` 等列表行会被当作 unparseable。
        if (nestedFieldIndent >= 0 && indent >= nestedFieldIndent) {
            continue;
        }
        // 条目开始：`- id: x` / `- name: x` / `- config:`
        const entryRe = /^- ([a-zA-Z][\w-]*):\s*(.*)$/.exec(content);
        if (entryRe) {
            currentEntry = { id: '', name: '', fields: [] };
            current.entries.push(currentEntry);
            const key = entryRe[1];
            const value = stripQuotes(entryRe[2]);
            if (key === 'id')
                currentEntry.id = value;
            else if (key === 'name')
                currentEntry.name = value;
            else
                currentEntry.fields.push(key);
            // Issue #1：仅 config 开启嵌套吸收（插件自定义配置，内容不透明）
            nestedFieldIndent = key === 'config' && value === '' ? indent + 2 : -1;
            continue;
        }
        // 字段行
        const fieldRe = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(content);
        if (!fieldRe) {
            current.errors.push(`unparseable line: ${content.slice(0, 40)}`);
            continue;
        }
        const entry = ensureEntry();
        const key = fieldRe[1];
        if (key === 'id')
            entry.id = stripQuotes(fieldRe[2]);
        else if (key === 'name')
            entry.name = stripQuotes(fieldRe[2]);
        else
            entry.fields.push(key);
        nestedFieldIndent = key === 'config' && fieldRe[2].trim() === '' ? indent + 2 : -1;
    }
    for (const s of sections) {
        for (const e of s.entries) {
            if (e.id === '')
                s.errors.push('entry missing id');
        }
    }
    return sections;
}
/** 兼容旧 API：取所有 insert entries。 */
export function parsePatchInsert(text) {
    const sections = parsePatchSections(text);
    const insert = sections.find(s => s.op === 'insert');
    return {
        entries: insert?.entries ?? [],
        errors: [...(insert?.errors ?? []), ...sections.filter(s => s.op !== 'insert').flatMap(s => s.errors)],
    };
}
/** 检查插件仓库的 cordis.patch.yml（bundle 形态；审查 X-02：config 等官方字段合法）。 */
export async function checkPatch(dir, kind, pkgName) {
    const issues = [];
    let text;
    try {
        text = await import('node:fs/promises').then(fs => fs.readFile(join(dir, 'cordis.patch.yml'), 'utf8'));
    }
    catch {
        return issues; // no-patch 已在 manifest 检查中报告
    }
    const sections = parsePatchSections(text);
    const insert = sections.find(s => s.op === 'insert');
    if (!insert) {
        issues.push({ code: 'malformed-patch', detail: '没有解析到 insert section（bundle patch 需要至少一个 - insert:）' });
    }
    else {
        if (insert.errors.length > 0) {
            issues.push({ code: 'malformed-patch', detail: insert.errors.slice(0, 3).join('; ') });
        }
        // row id 唯一
        const seen = new Set();
        for (const e of insert.entries) {
            if (e.id !== '') {
                if (seen.has(e.id))
                    issues.push({ code: 'duplicate-row-id', detail: `重复 row id: ${e.id}` });
                seen.add(e.id);
            }
        }
        // tool-bundle：patch name 与包名一致（PC-02：bundle 可插入多个包，不强制一致）
        if (kind === 'tool-bundle' && pkgName) {
            for (const e of insert.entries) {
                if (e.name !== '' && e.name !== pkgName) {
                    issues.push({ code: 'patch-name-mismatch', detail: `patch name "${e.name}" 与 package.json name "${pkgName}" 不一致` });
                }
            }
        }
        // 未知字段（config/name/id 之外）→ warning；config 合法不再报警（X-02）
        for (const e of insert.entries) {
            for (const f of e.fields) {
                if (f !== 'config') {
                    issues.push({ code: 'unexpected-fields', detail: `条目 ${e.id || '(unnamed)'} 含非预期字段: ${f}` });
                }
            }
        }
    }
    // update/disable section 结构错误
    for (const s of sections) {
        if ((s.op === 'update' || s.op === 'disable') && s.errors.length > 0) {
            issues.push({ code: 'malformed-patch', detail: `${s.op} section: ${s.errors.slice(0, 2).join('; ')}` });
        }
        if (s.op === 'unknown' && s.errors.length > 0) {
            issues.push({ code: 'malformed-patch', detail: s.errors.slice(0, 2).join('; ') });
        }
    }
    return issues;
}
