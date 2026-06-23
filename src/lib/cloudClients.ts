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

  private async getFileId(name: string): Promise<string | null> {
    const query = encodeURIComponent(`name = '${name}' and trashed = false`);
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
    const fileId = await this.getFileId(filename);
    
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
      const metadata = {
        name: filename,
        mimeType: 'application/octet-stream'
      };
      
      const boundary = '314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--\r\n`;
      
      const bytes = new Uint8Array(content);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      
      const metadataPart = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`;
      const mediaPart = `${delimiter}Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\n\r\n${btoa(binary)}`;
      const multipartBody = `${metadataPart}${mediaPart}${closeDelimiter}`;
      
      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      });
      if (!res.ok) {
        throw new Error(`Google Drive 创建备份失败: ${res.statusText}`);
      }
    }
  }

  async getFile(path: string): Promise<ArrayBuffer> {
    const filename = 'baimiao_data.enc';
    const fileId = await this.getFileId(filename);
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
