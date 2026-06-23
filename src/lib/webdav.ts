import { arrayBufferToBase64, base64ToArrayBuffer } from './crypto';

export class WebDAVClient {
  private endpoint: string;
  private authHeader: string;

  constructor(endpoint: string, username: string, secret: string) {
    this.endpoint = endpoint;
    const rawCreds = `${username}:${secret}`;
    // Use encodeURIComponent to handle non-ASCII characters gracefully
    this.authHeader = 'Basic ' + btoa(unescape(encodeURIComponent(rawCreds)));
  }

  private async callProxy(method: string, path: string, body?: string, headers?: Record<string, string>) {
    const response = await fetch('/api/webdav-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        endpoint: this.endpoint,
        method,
        path,
        auth: this.authHeader,
        body,
        headers
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      let errData = { error: errText };
      try { errData = JSON.parse(errText); } catch(e){}
      throw new Error(errData.error || `Proxy failed: ${response.statusText}`);
    }

    return response.json();
  }

  async checkDir(path: string): Promise<boolean> {
    try {
      const res = await this.callProxy('PROPFIND', path, undefined, { 'Depth': '0' });
      return res.status === 207 || res.status === 200;
    } catch (err: any) {
      if (err.message && (err.message.includes('FILE_NOT_FOUND') || err.message.includes('404'))) {
        return false;
      }
      return false;
    }
  }

  async createDir(path: string): Promise<void> {
    const res = await this.callProxy('MKCOL', path);
    if (res.status !== 201 && res.status !== 405) { 
      throw new Error(`创建云端目录失败，状态码: ${res.status}`);
    }
  }

  async putFile(path: string, content: ArrayBuffer): Promise<void> {
    const base64Body = arrayBufferToBase64(content);
    const res = await this.callProxy('PUT', path, base64Body);
    if (res.status !== 201 && res.status !== 204 && res.status !== 200) {
      throw new Error(`上传文件失败，状态码: ${res.status}`);
    }
  }

  async getFile(path: string): Promise<ArrayBuffer> {
    const res = await this.callProxy('GET', path);
    if (res.error === 'FILE_NOT_FOUND' || res.status === 404) {
      throw new Error("FILE_NOT_FOUND");
    }
    if (!res.data) {
      throw new Error("未获取到云端数据内容");
    }
    return base64ToArrayBuffer(res.data);
  }
}
