// Browser Native Cloud Drive Clients for E2EE Sync (OneDrive, Google Drive, Dropbox)

export class OneDriveClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private getCleanPath(path: string): string {
    const clean = path.startsWith('/') ? path : '/' + path;
    return clean.endsWith('/') ? clean : clean + '/';
  }

  async checkDir(path: string): Promise<boolean> {
    return true; // OneDrive automatically creates directories during file write
  }

  async createDir(path: string): Promise<void> {
    // Automatically handled
  }

  async putFile(path: string, content: ArrayBuffer): Promise<void> {
    const cleanDir = this.getCleanPath(path);
    const url = `https://graph.microsoft.com/v1.0/me/drive/root:${cleanDir}data.enc:/content`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/octet-stream'
      },
      body: content
    });
    if (!res.ok) {
      throw new Error(`OneDrive 上传失败: ${res.status} ${res.statusText}`);
    }
  }

  async getFile(path: string): Promise<ArrayBuffer> {
    const cleanDir = this.getCleanPath(path);
    const url = `https://graph.microsoft.com/v1.0/me/drive/root:${cleanDir}data.enc:/content`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });
    if (res.status === 404) {
      throw new Error("FILE_NOT_FOUND");
    }
    if (!res.ok) {
      throw new Error(`OneDrive 下载失败: ${res.status} ${res.statusText}`);
    }
    return res.arrayBuffer();
  }
}

export class DropboxClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private getCleanPath(path: string): string {
    const clean = path.startsWith('/') ? path : '/' + path;
    return clean.endsWith('/') ? clean : clean + '/';
  }

  async checkDir(path: string): Promise<boolean> {
    return true; 
  }

  async createDir(path: string): Promise<void> {
  }

  async putFile(path: string, content: ArrayBuffer): Promise<void> {
    const cleanDir = this.getCleanPath(path);
    const url = 'https://content.dropboxapi.com/2/files/upload';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Dropbox-API-Arg': JSON.stringify({
          path: `${cleanDir}data.enc`,
          mode: 'overwrite',
          autorename: false,
          mute: false
        }),
        'Content-Type': 'application/octet-stream'
      },
      body: content
    });
    if (!res.ok) {
      throw new Error(`Dropbox 上传失败: ${res.status} ${res.statusText}`);
    }
  }

  async getFile(path: string): Promise<ArrayBuffer> {
    const cleanDir = this.getCleanPath(path);
    const url = 'https://content.dropboxapi.com/2/files/download';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Dropbox-API-Arg': JSON.stringify({
          path: `${cleanDir}data.enc`
        })
      }
    });
    if (res.status === 409 || res.status === 404) {
      throw new Error("FILE_NOT_FOUND");
    }
    if (!res.ok) {
      throw new Error(`Dropbox 下载失败: ${res.status} ${res.statusText}`);
    }
    return res.arrayBuffer();
  }
}

export class GDriveClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private getDirectoryFromPath(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash === -1) return 'root';
    return path.substring(0, lastSlash);
  }

  private async getOrCreateFolderId(pathStr: string): Promise<string> {
    const cleanDir = this.getDirectoryFromPath(pathStr);
    const clean = cleanDir.replace(/^\/+|\/+$/g, '');
    if (!clean) return 'root';
    const parts = clean.split('/');
    
    let parentId = 'root';
    for (const part of parts) {
      if (!part) continue;
      const query = encodeURIComponent(`name = '${part}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (!res.ok) {
        throw new Error(`Google Drive 检索文件夹失败: ${res.statusText}`);
      }
      const data = await res.json();
      if (data.files && data.files.length > 0) {
        parentId = data.files[0].id;
      } else {
        const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: part,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
          })
        });
        if (!createRes.ok) {
          throw new Error(`Google Drive 创建文件夹失败: ${createRes.statusText}`);
        }
        const newFolder = await createRes.json();
        parentId = newFolder.id;
      }
    }
    return parentId;
  }

  private async getFileId(name: string, parentId: string): Promise<string | null> {
    const query = encodeURIComponent(`name = '${name}' and '${parentId}' in parents and trashed = false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });
    if (!res.ok) {
      throw new Error(`Google Drive 检索文件失败: ${res.statusText}`);
    }
    const data = await res.json();
    return data.files && data.files.length > 0 ? data.files[0].id : null;
  }

  async checkDir(path: string): Promise<boolean> {
    return true; 
  }

  async createDir(path: string): Promise<void> {
  }

  async putFile(path: string, content: ArrayBuffer): Promise<void> {
    const filename = 'baimiao_data.enc';
    const parentId = await this.getOrCreateFolderId(path);
    const fileId = await this.getFileId(filename, parentId);
    
    if (fileId) {
      const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/octet-stream'
        },
        body: content
      });
      if (!res.ok) {
        throw new Error(`Google Drive 上传更新失败: ${res.statusText}`);
      }
    } else {
      const boundary = '314159265358979323846';
      const delimiter = `--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--\r\n`;
      
      const metadata = {
        name: filename,
        parents: parentId === 'root' ? [] : [parentId]
      };
      
      const part1 = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n${delimiter}Content-Type: application/octet-stream\r\n\r\n`;
      
      const encoder = new TextEncoder();
      const part1Buffer = encoder.encode(part1);
      const part2Buffer = new Uint8Array(content);
      const part3Buffer = encoder.encode(closeDelimiter);
      
      const multipartBlob = new Blob([part1Buffer, part2Buffer, part3Buffer], {
        type: `multipart/related; boundary=${boundary}`
      });
      
      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`
        },
        body: multipartBlob
      });
      
      if (!res.ok) {
        throw new Error(`Google Drive 创建备份失败: ${res.statusText}`);
      }
    }
  }

  async getFile(path: string): Promise<ArrayBuffer> {
    const filename = 'baimiao_data.enc';
    const parentId = await this.getOrCreateFolderId(path);
    const fileId = await this.getFileId(filename, parentId);
    if (!fileId) {
      throw new Error("FILE_NOT_FOUND");
    }
    
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });
    if (res.status === 404) {
      throw new Error("FILE_NOT_FOUND");
    }
    if (!res.ok) {
      throw new Error(`Google Drive 下载备份失败: ${res.statusText}`);
    }
    return res.arrayBuffer();
  }
}
