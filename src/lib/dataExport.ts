/**
 * #13 统一数据管理 -- 导出模块
 *
 * 按时间范围 / 数据类型 / 格式（Markdown / JSON）导出白描笔记数据。
 * 聊天记录（copilot_conversations）可单独导出。
 *
 * 不修改 db.ts schema，仅通过现有 Dexie API 读取。
 */
import { db } from '../db/db';

export type DataType = 'raw_logs' | 'daily_reviews' | 'thoughts' | 'insights' | 'copilot_conversations' | 'tags' | 'tag_aliases' | 'attachments';

export interface ExportOptions {
  dateStart?: number; // timestamp (ms)，可选
  dateEnd?: number; // timestamp (ms)，可选
  types: DataType[];
  format: 'markdown' | 'json';
}

// 各类型在 Markdown 中的分节标题
const TYPE_LABELS: Record<DataType, string> = {
  raw_logs: '记录',
  daily_reviews: '回顾',
  thoughts: '沉淀',
  insights: '洞察',
  copilot_conversations: '聊天记录',
  tags: '标签定义',
  tag_aliases: '标签别名',
  attachments: '附件原文件',
};

/** 时间戳 -> YYYY-MM-DD 字符串（用于 daily_reviews.review_date 字符串比较） */
function tsToDateStr(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 时间戳 -> YYYY-MM-DD HH:mm 展示 */
function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

/** 剥离不可序列化 / 大体积字段（audioBlob、embedding 向量、attachment 向量） */
function cleanRecord(record: any): any {
  if (!record || typeof record !== 'object') return record;
  const {
    audioBlob,
    embedding,
    embedding_version,
    attachment_embedding,
    attachment_embedding_version,
    ...rest
  } = record;
  void audioBlob;
  void embedding;
  void embedding_version;
  void attachment_embedding;
  void attachment_embedding_version;
  return rest;
}

/** Blob -> base64 字符串（用于导出附件原始文件到 JSON；导入时还原为 Blob） */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** 按类型 + 时间范围读取记录，返回已清理的纯数据 */
async function fetchRecords(
  type: DataType,
  dateStart?: number,
  dateEnd?: number
): Promise<any[]> {
  const hasFilter = dateStart !== undefined || dateEnd !== undefined;

  switch (type) {
    case 'raw_logs': {
      let records = await db.raw_logs.toArray();
      if (hasFilter) {
        records = records.filter((r) => {
          if (dateStart !== undefined && r.created_at < dateStart) return false;
          if (dateEnd !== undefined && r.created_at > dateEnd) return false;
          return true;
        });
      }
      return records.map(cleanRecord);
    }
    case 'daily_reviews': {
      let records = await db.daily_reviews.toArray();
      if (hasFilter) {
        const startStr = dateStart !== undefined ? tsToDateStr(dateStart) : '0000-00-00';
        const endStr = dateEnd !== undefined ? tsToDateStr(dateEnd) : '9999-99-99';
        records = records.filter((r) => r.review_date >= startStr && r.review_date <= endStr);
      }
      return records.map(cleanRecord);
    }
    case 'thoughts': {
      let records = await db.thoughts.toArray();
      if (hasFilter) {
        records = records.filter((r) => {
          if (dateStart !== undefined && r.created_at < dateStart) return false;
          if (dateEnd !== undefined && r.created_at > dateEnd) return false;
          return true;
        });
      }
      return records.map(cleanRecord);
    }
    case 'insights': {
      let records = await db.insights.toArray();
      if (hasFilter) {
        records = records.filter((r) => {
          if (dateStart !== undefined && r.created_at < dateStart) return false;
          if (dateEnd !== undefined && r.created_at > dateEnd) return false;
          return true;
        });
      }
      return records.map(cleanRecord);
    }
    case 'copilot_conversations': {
      let records = await db.copilot_conversations.toArray();
      if (hasFilter) {
        records = records.filter((r) => {
          if (dateStart !== undefined && r.updated_at < dateStart) return false;
          if (dateEnd !== undefined && r.updated_at > dateEnd) return false;
          return true;
        });
      }
      return records; // 无 Blob / embedding 需剥离
    }
    case 'tags': {
      // 标签定义体积小，全量导出（不受时间范围过滤，无 created_at 语义）
      return await db.tags.toArray();
    }
    case 'tag_aliases': {
      return await db.tag_aliases.toArray();
    }
    case 'attachments': {
      // 附件原始 Blob 以 base64 编码导出，导入时还原为 Blob（避免悬空引用）
      const records = await db.attachments.toArray();
      const encoded: any[] = [];
      for (const a of records) {
        if (a.blob instanceof Blob) {
          encoded.push({
            ...a,
            blob: undefined,
            blob_base64: await blobToBase64(a.blob),
            blob_type: a.blob.type,
          });
        } else {
          encoded.push(a);
        }
      }
      return encoded;
    }
  }
}

/** 单类型记录转 Markdown 区块 */
function recordsToMarkdown(type: DataType, records: any[]): string {
  if (records.length === 0) return '';

  const lines: string[] = [`## ${TYPE_LABELS[type]}`, ''];

  for (const record of records) {
    switch (type) {
      case 'raw_logs':
        lines.push(`### ${formatDateTime(record.created_at)}`);
        lines.push('');
        lines.push(record.content || '');
        lines.push('');
        break;
      case 'daily_reviews':
        lines.push(
          `### ${record.review_date} ${record.entry_type === 'diary' ? '日记' : '回顾'}`
        );
        if (record.prompt_name) lines.push(`*${record.prompt_name}*`);
        lines.push('');
        if (record.entry_type === 'diary' && record.ai_editorial) {
          lines.push(record.ai_editorial);
        } else if (record.ai_review) {
          lines.push(record.ai_review);
        }
        if (record.ai_summary) {
          lines.push('');
          lines.push(`> ${record.ai_summary}`);
        }
        lines.push('');
        break;
      case 'thoughts':
        lines.push(`### ${formatDateTime(record.created_at)}`);
        if (record.tags && record.tags.length > 0) {
          lines.push(record.tags.map((t: string) => `#${t}`).join(' '));
        }
        lines.push('');
        lines.push(record.content || '');
        lines.push('');
        break;
      case 'insights':
        lines.push(
          `### ${record.range_label || record.range_type} (${record.insight_type === 'mingwu' ? '明悟' : '洞察'})`
        );
        if (record.start_date && record.end_date) {
          lines.push(`*${record.start_date} ~ ${record.end_date}*`);
        }
        lines.push('');
        lines.push(record.content || '');
        if (record.ai_summary) {
          lines.push('');
          lines.push(`> ${record.ai_summary}`);
        }
        lines.push('');
        break;
      case 'copilot_conversations':
        lines.push(
          `### ${record.title || '未命名对话'} (${record.mode === 'rag' ? 'RAG 问答' : '通用对话'})`
        );
        lines.push(`*更新于 ${formatDateTime(record.updated_at)}*`);
        lines.push('');
        if (record.messages && Array.isArray(record.messages)) {
          for (const msg of record.messages) {
            const speaker = msg.role === 'user' ? '**我**' : '**AI**';
            lines.push(`${speaker}: ${msg.content}`);
            lines.push('');
          }
        }
        break;
      case 'tags':
        lines.push(`### ${record.path}`);
        lines.push('');
        break;
      case 'tag_aliases':
        lines.push(`### ${record.alias} -> ${record.target}`);
        lines.push('');
        break;
      case 'attachments':
        // 附件原文件（Blob）不导出 Markdown，仅 JSON 导出含 base64
        break;
    }
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 导出数据，返回文件内容字符串。
 *
 * JSON 格式：`{ meta: { exportedAt, types, dateStart, dateEnd }, raw_logs: [...], ... }`
 * Markdown 格式：按类型分节，每条记录一个区块。
 */
export async function exportData(opts: ExportOptions): Promise<string> {
  const { dateStart, dateEnd, types, format } = opts;

  const data: Record<string, any[]> = {};
  for (const type of types) {
    data[type] = await fetchRecords(type, dateStart, dateEnd);
  }

  if (format === 'json') {
    const payload = {
      meta: {
        exportedAt: new Date().toISOString(),
        types,
        dateStart: dateStart ?? null,
        dateEnd: dateEnd ?? null,
      },
      ...data,
    };
    return JSON.stringify(payload, null, 2);
  }

  // Markdown
  const sections: string[] = [
    '# 白描笔记数据导出',
    '',
    `> 导出时间：${new Date().toISOString()}`,
    `> 数据类型：${types.map((t) => TYPE_LABELS[t]).join('、')}`,
    dateStart !== undefined || dateEnd !== undefined
      ? `> 时间范围：${dateStart ? tsToDateStr(dateStart) : '不限'} ~ ${dateEnd ? tsToDateStr(dateEnd) : '不限'}`
      : '> 时间范围：全部',
    '',
  ];
  for (const type of types) {
    const md = recordsToMarkdown(type, data[type] || []);
    if (md) sections.push(md);
  }
  return sections.join('\n');
}

/** 单独导出聊天记录 */
export async function exportConversations(format: 'markdown' | 'json'): Promise<string> {
  return exportData({ types: ['copilot_conversations'], format });
}

/** 触发浏览器下载（Blob + URL.createObjectURL） */
export function downloadContent(
  content: string,
  filename: string,
  mimeType: string = 'application/json'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 生成带时间戳的文件名：baimiao-export-YYYYMMDD.json / .md */
export function getExportFilename(
  format: 'markdown' | 'json',
  prefix: string = 'baimiao-export'
): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const ext = format === 'json' ? 'json' : 'md';
  return `${prefix}-${y}${m}${day}.${ext}`;
}
