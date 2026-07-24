/**
 * #6 多媒体附件处理模块。
 *
 * 职责：
 * - 将附件原始文件以 Blob 存入 IndexedDB attachments store（不压缩）。
 * - 对图片/视频附件调用多模态模型生成文本摘要（存入 raw_logs.attachment_summary）。
 * - 音频附件不在此处理，继续走现有 STT 端点（/api/transcribe）。
 * - 链接附件仅存 URL，不做摘要。
 *
 * 摘要文本后续由 embedding.ts 的 multimedia 钩子做向量索引（attachment_embedding 字段），
 * 供语义检索使用。submitMultimedia 设置控制生成回顾/洞察时是否向模型提交这些摘要。
 */
import { db, type AttachmentMeta } from '../db/db';
import { useSettingsStore } from '../store/settings.store';
import { generateUUID } from './utils';

/**
 * 调用 /api/multimedia-summarize 端点，用 Gemini 多模态模型生成图片/视频的文本摘要。
 */
export async function requestMultimediaSummary(
  base64data: string,
  mimeType: string,
  kind: 'image' | 'video'
): Promise<string> {
  const settings = useSettingsStore.getState();
  const res = await fetch('/api/multimedia-summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_base64: base64data,
      mime_type: mimeType,
      kind,
      settings: {
        provider: settings.provider,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || `Multimedia summarize failed: ${res.status}`);
  }
  const data = await res.json();
  return data.summary || '';
}

/**
 * DocumentEditor 上传 helper（公开 seam）：
 *   - 接受一个 File（用户在文件选择器中挑选的本地文件）
 *   - 把它以 Blob 形式存入 IndexedDB attachments store（**永不**生成 data URL）
 *   - 返回 { attachmentId, name, mimeType }，供 DocumentEditor 写入 media block attrs
 *
 * 设计动机：旧 RichEditor 把图片读成 data URL 存入 AttachmentMeta.ref，
 * 当 content 同时保存 Markdown 字符串时，data URL 会被双重持久化。
 * 本 helper 强制走 attachments store，让 attachmentId 成为唯一引用。
 *
 * 行为约束：
 *   - 成功：返回 attachmentId，调用方应把它插入到 content_doc 的 media 节点
 *   - 失败/抛错：调用方应放弃插入（DocumentEditor 不会持久化任何 data URL）
 */
export async function saveFileAsAttachment(
  file: File,
  kindOverride?: 'image' | 'audio' | 'video' | 'file',
): Promise<{ attachmentId: string; name: string; mimeType: string }> {
  const kind =
    kindOverride ||
    (file.type?.startsWith('image/')
      ? 'image'
      : file.type?.startsWith('audio/')
        ? 'audio'
        : file.type?.startsWith('video/')
          ? 'video'
          : 'file');
  const meta = await saveAttachmentBlob(file, kind);
  return {
    attachmentId: meta.ref as string,
    name: meta.name || file.name || '',
    mimeType: file.type || '',
  };
}

/**
 * 将附件原始文件以 Blob 存入 IndexedDB attachments store，返回 AttachmentMeta。
 * 原始文件不压缩。
 */
export async function saveAttachmentBlob(
  file: File | Blob,
  kind: 'image' | 'audio' | 'video' | 'file'
): Promise<AttachmentMeta> {
  const id = generateUUID();
  await db.attachments.add({
    id,
    blob: file,
    type: kind,
    created_at: Date.now(),
  });
  return {
    kind,
    name: file instanceof File ? file.name : undefined,
    ref: id,
  };
}

/**
 * 读取 Blob 并转为 base64（不含 data: 前缀），用于发送给多模态 API。
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      const result = reader.result as string;
      // split(',') 取 data URL 中 base64 部分
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = reject;
  });
}

/**
 * 对图片/视频附件生成多模态摘要，返回更新后的 AttachmentMeta[] 与合并摘要文本。
 *
 * - 图片/视频：调多模态模型生成摘要，写入 AttachmentMeta.summary。
 * - 音频：跳过（走 STT，由调用方处理）。
 * - 链接：将 URL 拼入摘要文本（不做模型调用）。
 *
 * @returns { attachments: 更新后的元数据数组, summary: 合并摘要文本（用于 raw_logs.attachment_summary） }
 */
export async function generateAttachmentSummary(
  attachments: AttachmentMeta[]
): Promise<{ attachments: AttachmentMeta[]; summary: string }> {
  const summaryParts: string[] = [];
  const updatedAttachments = await Promise.all(
    attachments.map(async (att): Promise<AttachmentMeta> => {
      if (att.kind === 'link') {
        if (att.ref) summaryParts.push(`链接：${att.ref}`);
        return att;
      }
      if (att.kind === 'audio') {
        // 音频走 STT，不在此处理
        return att;
      }
      if (att.kind === 'file') {
        // 通用文件不做多模态摘要
        return att;
      }
      // image / video：生成多模态摘要
      if (!att.ref) return att;
      try {
        const attachmentBlob = await db.attachments.get(att.ref);
        if (!attachmentBlob) return att;
        const base64 = await blobToBase64(attachmentBlob.blob);
        const mimeType =
          attachmentBlob.blob.type || (att.kind === 'image' ? 'image/jpeg' : 'video/mp4');
        const summary = await requestMultimediaSummary(base64, mimeType, att.kind);
        if (summary && summary.trim()) {
          summaryParts.push(summary.trim());
          return { ...att, summary: summary.trim() };
        }
      } catch (err) {
        console.error('[Multimedia] Failed to generate summary for attachment:', att.ref, err);
      }
      return att;
    })
  );
  return {
    attachments: updatedAttachments,
    summary: summaryParts.join('\n'),
  };
}
