import { getR2OwnerToken } from './r2OwnerToken';
// R2Client — Cloudflare R2 云备份（Issue #009）
//
// 架构：浏览器 → /api/r2-presign 拿 5min TTL 签名 URL → 直接 PUT 到 R2。
// Secret Access Key 只在 Vercel/Express 服务端，永不出服务器。
//
// 加密：每次上传前用 crypto.ts:encryptData 把 backup payload 做 AES-GCM + gzip，
// 与现有 syncPasswordE2EE 兼容（同算法、同密钥派生）。这样如果用户在其他设备
// 装了同一个 app 并配了同样的 E2EE 密码，就能直接拉 + 解密恢复。
//
// Key 命名：{prefix}/{YYYY-MM-DD}/{uuid}.enc（每天一个子目录，便于清理）

import { encryptData, decryptData } from './crypto';

export const R2_DEFAULT_KEY_PREFIX = 'baimiaobiji';

export interface R2ClientOptions {
  /** 用户在 Settings 填的 bucket 名（必须与服务端 R2_BUCKET 相同） */
  bucket: string;
  authToken?: string;
  /** Key 前缀，默认 'baimiaobiji' */
  keyPrefix?: string;
  /** 后端 presign 端点，默认 '/api/r2-presign'（便于测试 override） */
  presignEndpoint?: string;
  /** 后端 list 端点，默认 '/api/r2-list' */
  listEndpoint?: string;
}

export interface EncryptedBackup {
  key: string;
  ciphertext: ArrayBuffer;
  contentType: 'application/octet-stream';
  contentLength: number;
}

export interface R2BackupMeta {
  key: string;
  size: number;
  /** epoch ms */
  lastModified: number;
}

// ─── 纯函数（方便单测）────────────────────────────────────────────────

/**
 * 规范化 key 前缀：去掉首尾斜杠，禁止包含 `..`
 */
export function normalizeKeyPrefix(raw: string | undefined): string {
  const v = (raw ?? R2_DEFAULT_KEY_PREFIX).trim();
  const cleaned = v.replace(/^\/+|\/+$/g, '');
  if (cleaned.length === 0 || cleaned.includes('..')) {
    return R2_DEFAULT_KEY_PREFIX;
  }
  return cleaned;
}

/**
 * 生成单条备份的 canonical key：{prefix}/{YYYY-MM-DD}/{uuid}.enc
 */
export function buildBackupKey(
  keyPrefix: string,
  date: Date = new Date(),
  uuid: string = crypto.randomUUID(),
): { key: string; dateStr: string; uuid: string } {
  const prefix = normalizeKeyPrefix(keyPrefix);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  const key = `${prefix}/${dateStr}/${uuid}.enc`;
  return { key, dateStr, uuid };
}

/**
 * 校验生成的 key 是否合法（白名单字符 + 不含 ..）
 * 注意：服务端会再做一次权威校验，这里只是客户端的早期 fail-fast。
 */
export function validateBackupKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0 || key.length > 1024) return false;
  if (!/^[a-zA-Z0-9/_\-. ]+$/.test(key)) return false;
  if (key.startsWith('/') || key.includes('..')) return false;
  return true;
}

// ─── R2Client 类 ─────────────────────────────────────────────────────

export class R2Client {
  private readonly authToken?: string;
  private readonly bucket: string;
  private readonly keyPrefix: string;
  private readonly presignEndpoint: string;
  private readonly listEndpoint: string;

  constructor(opts: R2ClientOptions) {
    if (!opts.bucket || typeof opts.bucket !== 'string') {
      throw new Error('R2Client: bucket 必填');
    }
    this.authToken = opts.authToken;
    this.bucket = opts.bucket;
    this.keyPrefix = normalizeKeyPrefix(opts.keyPrefix);
    this.presignEndpoint = opts.presignEndpoint ?? '/api/r2-presign';
    this.listEndpoint = opts.listEndpoint ?? '/api/r2-list';
  }

  private ownerHeaders(): Record<string, string> {
    const token = this.authToken ?? getR2OwnerToken();
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  /** 公开给上层读取（Settings UI 显示） */
  getBucket(): string { return this.bucket; }
  getKeyPrefix(): string { return this.keyPrefix; }

  /**
   * 加密 backup payload 并组装成可上传对象。
   * plaintext = BackupRecord.payload (JSON string)
   * password  = syncPasswordE2EE
   */
  async prepareEncryptedBackup(
    plaintext: string,
    password: string,
  ): Promise<EncryptedBackup> {
    if (!password) throw new Error('E2EE 密码未配置，无法加密云备份');
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new Error('待加密内容为空');
    }
    const ciphertext = await encryptData(plaintext, password);
    const { key } = buildBackupKey(this.keyPrefix);
    if (!validateBackupKey(key)) {
      throw new Error(`生成的 key 不合法: ${key}`);
    }
    return {
      key,
      ciphertext,
      contentType: 'application/octet-stream',
      contentLength: ciphertext.byteLength,
    };
  }

  /**
   * 上传加密备份：先调 presign 拿 PUT URL，再 fetch 上传。
   * 返回成功与否 + R2 ETag（若有）。
   */
  async upload(encrypted: EncryptedBackup): Promise<{ key: string; etag?: string }> {
    if (!validateBackupKey(encrypted.key)) {
      throw new Error(`非法 key: ${encrypted.key}`);
    }
    if (encrypted.contentType !== 'application/octet-stream') {
      throw new Error(`非法 contentType: ${encrypted.contentType}`);
    }

    const presignRes = await fetch(this.presignEndpoint, {
      method: 'POST',
      headers: this.ownerHeaders(),
      body: JSON.stringify({
        kind: 'put',
        bucket: this.bucket,
        key: encrypted.key,
        contentType: encrypted.contentType,
        contentLength: encrypted.contentLength,
      }),
    });
    if (!presignRes.ok) {
      const errText = await presignRes.text().catch(() => '');
      throw new Error(`R2 presign PUT 失败 (${presignRes.status}): ${errText.slice(0, 200)}`);
    }
    const { url } = await presignRes.json();
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('R2 presign 返回的 url 为空');
    }

    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': encrypted.contentType },
      body: encrypted.ciphertext,
    });
    if (!putRes.ok) {
      const errText = await putRes.text().catch(() => '');
      throw new Error(`R2 PUT 失败 (${putRes.status}): ${errText.slice(0, 200)}`);
    }
    const etag = putRes.headers.get('ETag') ?? undefined;
    return { key: encrypted.key, etag };
  }

  /**
   * 一次性：加密 + 上传。autoBackup.pushBackupToR2() 直接调这个。
   */
  async encryptAndUpload(
    plaintext: string,
    password: string,
  ): Promise<{ key: string; etag?: string }> {
    const encrypted = await this.prepareEncryptedBackup(plaintext, password);
    return await this.upload(encrypted);
  }

  /**
   * 拉取签名 GET URL（5 分钟有效）。UI 调试用，restore 走 downloadAndDecrypt。
   */
  async getDownloadUrl(key: string): Promise<string> {
    if (!validateBackupKey(key)) throw new Error(`非法 key: ${key}`);
    const res = await fetch(this.presignEndpoint, {
      method: 'POST',
      headers: this.ownerHeaders(),
      body: JSON.stringify({ kind: 'get', bucket: this.bucket, key }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`R2 presign GET 失败 (${res.status}): ${errText.slice(0, 200)}`);
    }
    const { url } = await res.json();
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('R2 presign GET 返回的 url 为空');
    }
    return url;
  }

  /**
   * 下载 + 解密：restore 流程直接拿到 plaintext payload。
   */
  async downloadAndDecrypt(key: string, password: string): Promise<string> {
    if (!password) throw new Error('E2EE 密码未配置，无法解密');
    const url = await this.getDownloadUrl(key);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`R2 GET 失败 (${res.status})`);
    }
    const buf = await res.arrayBuffer();
    return await decryptData(buf, password);
  }

  /**
   * 列出本 prefix 下的所有 .enc 备份（按 key 倒序——新的在前）。
   */
  async listBackups(): Promise<R2BackupMeta[]> {
    const prefix = `${this.keyPrefix}/`;
    const res = await fetch(this.listEndpoint, {
      method: 'POST',
      headers: this.ownerHeaders(),
      body: JSON.stringify({ bucket: this.bucket, prefix }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`R2 list 失败 (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const raw = Array.isArray(data.objects) ? data.objects : [];
    return raw
      .filter((o: any) => o && typeof o.key === 'string' && o.key.endsWith('.enc'))
      .map((o: any) => ({
        key: o.key,
        size: typeof o.size === 'number' ? o.size : 0,
        lastModified: typeof o.lastModified === 'number' ? o.lastModified : 0,
      }))
      .sort((a: R2BackupMeta, b: R2BackupMeta) => b.key.localeCompare(a.key));
  }

  /**
   * 测试连通性：只调一次 presign GET（不真下载），验证服务端 R2 凭证是否配齐。
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const { key } = buildBackupKey(this.keyPrefix);
      const url = await this.getDownloadUrl(key);
      return {
        ok: typeof url === 'string' && url.length > 0,
        message: typeof url === 'string' && url.length > 0
          ? 'R2 连接正常（签名成功）'
          : 'presign 返回空 URL',
      };
    } catch (err: any) {
      return { ok: false, message: err.message || 'R2 连接失败' };
    }
  }
}