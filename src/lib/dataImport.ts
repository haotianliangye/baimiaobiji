/**
 * #13 统一数据管理 -- 导入模块
 *
 * 解析导出的 JSON，按类型写入对应表。
 * - overwrite（以导入为准）：db.table.put(item) 覆盖同 id。
 * - skip（跳过已存在）：先 get(id) 判断，存在则跳过，否则 add。
 *
 * 不修改 db.ts schema，仅通过现有 Dexie API 写入。
 */
import { db } from '../db/db';
import type { DataType } from './dataExport';

export type ImportStrategy = 'overwrite' | 'skip';

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/** dataExport.ts 导出的类型键 -> Dexie 表名（一致，但显式映射更清晰） */
const TABLE_NAMES: DataType[] = [
  'raw_logs',
  'daily_reviews',
  'thoughts',
  'insights',
  'copilot_conversations',
  'tags',
  'tag_aliases',
  'attachments',
];

/** base64 字符串 -> Blob（导入附件原始文件时还原，与 dataExport.blobToBase64 对应） */
function base64ToBlob(b64: string, type: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * 导入 JSON 数据。
 * 接受 exportData() 产出的 `{ meta, raw_logs, ... }` 结构，
 * 逐类型逐条写入，按 strategy 处理冲突。
 */
export async function importData(
  json: string,
  strategy: ImportStrategy
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    result.errors.push('JSON 解析失败：文件格式不正确');
    return result;
  }

  if (!parsed || typeof parsed !== 'object') {
    result.errors.push('JSON 根节点不是对象');
    return result;
  }

  for (const type of TABLE_NAMES) {
    const records = parsed[type];
    if (!records || !Array.isArray(records)) continue;

    const table = db.table(type);

    for (const record of records) {
      try {
        // attachments：base64 还原为 Blob（导出时编码，导入时还原，避免悬空引用）
        let toWrite: any = record;
        if (type === 'attachments' && record.blob_base64) {
          toWrite = {
            ...record,
            blob: base64ToBlob(record.blob_base64, record.blob_type || ''),
            blob_base64: undefined,
            blob_type: undefined,
          };
        }
        if (strategy === 'overwrite') {
          await table.put(toWrite);
          result.imported++;
        } else {
          // skip：先查 id 是否已存在
          const id = toWrite.id ?? toWrite.key;
          if (id !== undefined && id !== null) {
            const existing = await table.get(id);
            if (existing) {
              result.skipped++;
              continue;
            }
          }
          await table.add(toWrite);
          result.imported++;
        }
      } catch (e: any) {
        result.errors.push(`[${type}] ${e?.message || String(e)}`);
      }
    }
  }

  return result;
}

/**
 * 单独导入聊天记录。
 * 接受 `{ copilot_conversations: [...] }` 或裸 `[...]` 两种格式。
 */
export async function importConversations(
  json: string,
  strategy: ImportStrategy
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    result.errors.push('JSON 解析失败：文件格式不正确');
    return result;
  }

  let records: any[];
  if (Array.isArray(parsed)) {
    records = parsed;
  } else if (parsed.copilot_conversations && Array.isArray(parsed.copilot_conversations)) {
    records = parsed.copilot_conversations;
  } else {
    result.errors.push('文件中未找到聊天记录数据（copilot_conversations）');
    return result;
  }

  const table = db.copilot_conversations;

  for (const record of records) {
    try {
      if (strategy === 'overwrite') {
        await table.put(record);
        result.imported++;
      } else {
        const id = record.id;
        if (id !== undefined && id !== null) {
          const existing = await table.get(id);
          if (existing) {
            result.skipped++;
            continue;
          }
        }
        await table.add(record);
        result.imported++;
      }
    } catch (e: any) {
      result.errors.push(`${e?.message || String(e)}`);
    }
  }

  return result;
}
