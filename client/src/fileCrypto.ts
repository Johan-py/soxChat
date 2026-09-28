/**
 * SoxChat File Crypto — Phase (c): chunked file encryption.
 *
 * Each file is split into chunks (64 KB default), each encrypted
 * independently with AES-256-GCM using a unique IV per chunk.
 *
 * AAD = fileId || chunkIndex (prevents reordering and truncation)
 * File name and MIME type are encrypted inside the file:offer payload.
 */

import { bufToB64, b64ToBuf } from './crypto.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

// --- Key derivation for files ---

let fileKeyPromise: Promise<CryptoKey> | null = null;

export async function initFileKey(roomKeyHex: string): Promise<void> {
  const roomKeyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    roomKeyBytes[i] = parseInt(roomKeyHex.slice(i * 2, i * 2 + 2), 16);
  }

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    roomKeyBytes.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveKey'],
  );

  fileKeyPromise = crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode('soxchat-file-v1'),
      info: enc.encode('files'),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function getFileKey(): Promise<CryptoKey> {
  if (!fileKeyPromise) throw new Error('File key not initialized');
  return fileKeyPromise;
}

// --- Types ---

export interface EncryptedFileMeta {
  fileId: string;
  nameEnc: string; // base64
  mimeEnc: string; // base64
  size: number;
  chunkCount: number;
  iv: string; // base64 (IV for metadata encryption)
}

export interface EncryptedChunk {
  fileId: string;
  index: number;
  iv: string; // base64
  data: string; // base64 (ciphertext + GCM tag)
}

// --- Metadata encryption (file name + MIME) ---

export async function encryptFileMeta(
  fileId: string,
  name: string,
  mime: string,
  size: number,
  chunkCount: number,
): Promise<EncryptedFileMeta> {
  const key = await getFileKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const nameBuf = enc.encode(name);
  const mimeBuf = enc.encode(mime);

  // Encrypt name and MIME together: [nameLen:2][name][mime]
  const combined = new Uint8Array(2 + nameBuf.length + mimeBuf.length);
  const view = new DataView(combined.buffer);
  view.setUint16(0, nameBuf.length, false);
  combined.set(nameBuf, 2);
  combined.set(mimeBuf, 2 + nameBuf.length);

  const aad = enc.encode(`meta|${fileId}`);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, additionalData: aad },
    key,
    combined,
  );

  return {
    fileId,
    nameEnc: bufToB64(ct),
    mimeEnc: '', // included in nameEnc payload
    size,
    chunkCount,
    iv: bufToB64(iv),
  };
}

export async function decryptFileMeta(
  meta: EncryptedFileMeta,
): Promise<{ name: string; mime: string }> {
  const key = await getFileKey();
  const iv = b64ToBuf(meta.iv);
  const ct = b64ToBuf(meta.nameEnc);
  const aad = enc.encode(`meta|${meta.fileId}`);

  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, additionalData: aad },
      key,
      ct.buffer as ArrayBuffer,
    );
    const buf = new Uint8Array(pt);
    const view = new DataView(buf.buffer);
    const nameLen = view.getUint16(0, false);
    const name = dec.decode(buf.slice(2, 2 + nameLen));
    const mime = dec.decode(buf.slice(2 + nameLen));
    return { name, mime };
  } catch {
    throw new Error('META_DECRYPT_FAILED');
  }
}

// --- Chunk encryption ---

export async function encryptChunk(
  fileId: string,
  index: number,
  data: Uint8Array,
): Promise<EncryptedChunk> {
  const key = await getFileKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = enc.encode(`${fileId}|${index}`);

  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, additionalData: aad },
    key,
    data.buffer as ArrayBuffer,
  );

  return {
    fileId,
    index,
    iv: bufToB64(iv),
    data: bufToB64(ct),
  };
}

export async function decryptChunk(
  chunk: EncryptedChunk,
): Promise<Uint8Array> {
  const key = await getFileKey();
  const iv = b64ToBuf(chunk.iv);
  const ct = b64ToBuf(chunk.data);
  const aad = enc.encode(`${chunk.fileId}|${chunk.index}`);

  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, additionalData: aad },
      key,
      ct.buffer as ArrayBuffer,
    );
    return new Uint8Array(pt);
  } catch {
    throw new Error('CHUNK_DECRYPT_FAILED');
  }
}

// --- Chunking helper ---

export function chunkSize(): number {
  return 64 * 1024; // 64 KB
}

export function chunkCount(fileSize: number): number {
  return Math.ceil(fileSize / chunkSize());
}
