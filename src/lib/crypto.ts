// Browser Native E2EE encryption/decryption helper using Web Crypto API and CompressionStream

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: CRYPTO_CONSTANTS.PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    baseKey,
    { name: CRYPTO_CONSTANTS.ALGORITHM, length: CRYPTO_CONSTANTS.KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

// Encrypt plainText to ArrayBuffer: [salt(16B) + iv(12B) + cipherText]
export async function encryptData(plainText: string, password: string): Promise<ArrayBuffer> {
  const compressedBuffer = await compressText(plainText);
  const compressedArr = new Uint8Array(compressedBuffer);
  
  const salt = window.crypto.getRandomValues(new Uint8Array(CRYPTO_CONSTANTS.SALT_LENGTH_BYTES));
  const iv = window.crypto.getRandomValues(new Uint8Array(CRYPTO_CONSTANTS.IV_LENGTH_BYTES));
  
  const key = await deriveKey(password, salt);
  const cipherBuffer = await window.crypto.subtle.encrypt(
    {
      name: CRYPTO_CONSTANTS.ALGORITHM,
      iv: iv
    },
    key,
    compressedArr
  );
  
  const resultBuffer = new Uint8Array(salt.byteLength + iv.byteLength + cipherBuffer.byteLength);
  resultBuffer.set(salt, 0);
  resultBuffer.set(iv, salt.byteLength);
  resultBuffer.set(new Uint8Array(cipherBuffer), salt.byteLength + iv.byteLength);
  
  return resultBuffer.buffer;
}

// Decrypt encrypted ArrayBuffer back to plainText
export async function decryptData(encryptedBuffer: ArrayBuffer, password: string): Promise<string> {
  const encryptedArr = new Uint8Array(encryptedBuffer);
  if (encryptedArr.byteLength < (CRYPTO_CONSTANTS.SALT_LENGTH_BYTES + CRYPTO_CONSTANTS.IV_LENGTH_BYTES)) {
    throw new Error("加密数据长度过短，可能已损坏");
  }
  
  const salt = encryptedArr.slice(0, CRYPTO_CONSTANTS.SALT_LENGTH_BYTES);
  const iv = encryptedArr.slice(CRYPTO_CONSTANTS.SALT_LENGTH_BYTES, CRYPTO_CONSTANTS.SALT_LENGTH_BYTES + CRYPTO_CONSTANTS.IV_LENGTH_BYTES);
  const cipherText = encryptedArr.slice(CRYPTO_CONSTANTS.SALT_LENGTH_BYTES + CRYPTO_CONSTANTS.IV_LENGTH_BYTES);
  
  const key = await deriveKey(password, salt);
  
  try {
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: CRYPTO_CONSTANTS.ALGORITHM,
        iv: iv
      },
      key,
      cipherText
    );
    return await decompressText(decryptedBuffer);
  } catch (e) {
    throw new Error("密码错误或备份文件损坏，解密失败");
  }
}

// Gzip compress text
export async function compressText(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

// Gzip decompress ArrayBuffer
export async function decompressText(buffer: ArrayBuffer): Promise<string> {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

// Binary conversions
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
