/**
 * Tests for Phase (c): chunked file encryption.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initFileKey,
  encryptFileMeta,
  decryptFileMeta,
  encryptChunk,
  decryptChunk,
  chunkSize,
  chunkCount,
} from './fileCrypto.js';

const TEST_KEY = 'b'.repeat(64); // 256-bit key in hex
const TEST_FILE_ID = 'test-file-123';

describe('chunkSize / chunkCount', () => {
  it('has 64 KB chunk size', () => {
    expect(chunkSize()).toBe(64 * 1024);
  });

  it('calculates correct chunk count', () => {
    expect(chunkCount(0)).toBe(0);
    expect(chunkCount(1)).toBe(1);
    expect(chunkSize()).toBe(64 * 1024);
    expect(chunkCount(64 * 1024)).toBe(1);
    expect(chunkCount(64 * 1024 + 1)).toBe(2);
    expect(chunkCount(1024 * 1024)).toBe(16);
  });
});

describe('encryptFileMeta / decryptFileMeta', () => {
  beforeEach(async () => {
    await initFileKey(TEST_KEY);
  });

  it('roundtrips file name and MIME', async () => {
    const meta = await encryptFileMeta(TEST_FILE_ID, 'documento.pdf', 'application/pdf', 1024, 2);
    const decrypted = await decryptFileMeta(meta);
    expect(decrypted.name).toBe('documento.pdf');
    expect(decrypted.mime).toBe('application/pdf');
  });

  it('handles unicode file names', async () => {
    const meta = await encryptFileMeta(TEST_FILE_ID, 'foto ñoño 🎉.png', 'image/png', 500, 1);
    const decrypted = await decryptFileMeta(meta);
    expect(decrypted.name).toBe('foto ñoño 🎉.png');
    expect(decrypted.mime).toBe('image/png');
  });

  it('handles empty MIME', async () => {
    const meta = await encryptFileMeta(TEST_FILE_ID, 'file', '', 100, 1);
    const decrypted = await decryptFileMeta(meta);
    expect(decrypted.name).toBe('file');
    expect(decrypted.mime).toBe('');
  });

  it('fails with tampered ciphertext', async () => {
    const meta = await encryptFileMeta(TEST_FILE_ID, 'secret.txt', 'text/plain', 100, 1);
    const tampered = { ...meta, nameEnc: meta.nameEnc.slice(0, -4) + 'AAAA' };
    await expect(decryptFileMeta(tampered)).rejects.toThrow('META_DECRYPT_FAILED');
  });

  it('fails with wrong fileId (AAD mismatch)', async () => {
    const meta = await encryptFileMeta(TEST_FILE_ID, 'file.txt', 'text/plain', 100, 1);
    const wrongId = { ...meta, fileId: 'wrong-id' };
    await expect(decryptFileMeta(wrongId)).rejects.toThrow('META_DECRYPT_FAILED');
  });
});

describe('encryptChunk / decryptChunk', () => {
  beforeEach(async () => {
    await initFileKey(TEST_KEY);
  });

  it('roundtrips a chunk', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
    const chunk = await encryptChunk(TEST_FILE_ID, 0, data);
    const decrypted = await decryptChunk(chunk);
    expect([...decrypted]).toEqual([...data]);
  });

  it('produces different ciphertexts for same data (random IV)', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const c1 = await encryptChunk(TEST_FILE_ID, 0, data);
    const c2 = await encryptChunk(TEST_FILE_ID, 0, data);
    expect(c1.data).not.toBe(c2.data);
    expect(c1.iv).not.toBe(c2.iv);
  });

  it('handles large chunk (64 KB)', async () => {
    const data = crypto.getRandomValues(new Uint8Array(64 * 1024));
    const chunk = await encryptChunk(TEST_FILE_ID, 0, data);
    const decrypted = await decryptChunk(chunk);
    expect([...decrypted]).toEqual([...data]);
  });

  it('handles empty chunk', async () => {
    const data = new Uint8Array(0);
    const chunk = await encryptChunk(TEST_FILE_ID, 0, data);
    const decrypted = await decryptChunk(chunk);
    expect(decrypted.length).toBe(0);
  });

  it('fails with tampered ciphertext', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const chunk = await encryptChunk(TEST_FILE_ID, 0, data);
    const tampered = { ...chunk, data: chunk.data.slice(0, -4) + 'AAAA' };
    await expect(decryptChunk(tampered)).rejects.toThrow('CHUNK_DECRYPT_FAILED');
  });

  it('fails with wrong index (AAD mismatch — reordering)', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const chunk = await encryptChunk(TEST_FILE_ID, 0, data);
    // Try to decrypt as if it were chunk 1
    const reordered = { ...chunk, index: 1 };
    await expect(decryptChunk(reordered)).rejects.toThrow('CHUNK_DECRYPT_FAILED');
  });

  it('fails with wrong fileId (AAD mismatch)', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const chunk = await encryptChunk(TEST_FILE_ID, 0, data);
    const wrongFile = { ...chunk, fileId: 'wrong-file' };
    await expect(decryptChunk(wrongFile)).rejects.toThrow('CHUNK_DECRYPT_FAILED');
  });

  it('fails with wrong IV', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const chunk = await encryptChunk(TEST_FILE_ID, 0, data);
    const wrongIv = { ...chunk, iv: 'AAAAAAAAAAAAAAAAAAAAAA==' }; // 12 zero bytes in base64
    await expect(decryptChunk(wrongIv)).rejects.toThrow('CHUNK_DECRYPT_FAILED');
  });
});

describe('Multi-chunk file simulation', () => {
  beforeEach(async () => {
    await initFileKey(TEST_KEY);
  });

  it('roundtrips a multi-chunk file', async () => {
    // Generate in 32 KB pieces to stay under getRandomValues limit
    const fileData = new Uint8Array(200 * 1024);
    for (let i = 0; i < fileData.length; i += 32 * 1024) {
      const piece = crypto.getRandomValues(new Uint8Array(Math.min(32 * 1024, fileData.length - i)));
      fileData.set(piece, i);
    }
    const chunks = chunkCount(fileData.length);

    // Encrypt all chunks
    const encrypted: Array<{ index: number; iv: string; data: string }> = [];
    for (let i = 0; i < chunks; i++) {
      const start = i * chunkSize();
      const end = Math.min(start + chunkSize(), fileData.length);
      const chunkData = fileData.slice(start, end);
      const enc = await encryptChunk(TEST_FILE_ID, i, chunkData);
      encrypted.push({ index: enc.index, iv: enc.iv, data: enc.data });
    }

    // Decrypt all chunks
    const decrypted: Uint8Array[] = [];
    for (const enc of encrypted) {
      const dec = await decryptChunk({ fileId: TEST_FILE_ID, index: enc.index, iv: enc.iv, data: enc.data });
      decrypted.push(dec);
    }

    // Reassemble
    const totalLen = decrypted.reduce((sum, c) => sum + c.length, 0);
    const reassembled = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of decrypted) {
      reassembled.set(c, offset);
      offset += c.length;
    }

    expect([...reassembled]).toEqual([...fileData]);
  });

  it('detects chunk reordering via AAD', async () => {
    const fileData = new Uint8Array(130 * 1024);
    for (let i = 0; i < fileData.length; i += 32 * 1024) {
      const piece = crypto.getRandomValues(new Uint8Array(Math.min(32 * 1024, fileData.length - i)));
      fileData.set(piece, i);
    }
    const chunks = chunkCount(fileData.length);

    const encrypted: Array<{ index: number; iv: string; data: string }> = [];
    for (let i = 0; i < chunks; i++) {
      const start = i * chunkSize();
      const end = Math.min(start + chunkSize(), fileData.length);
      const chunkData = fileData.slice(start, end);
      const enc = await encryptChunk(TEST_FILE_ID, i, chunkData);
      encrypted.push({ index: enc.index, iv: enc.iv, data: enc.data });
    }

    // Try to decrypt chunk 1 as chunk 0 (reordering attack)
    const reordered = { fileId: TEST_FILE_ID, index: 0, iv: encrypted[1].iv, data: encrypted[1].data };
    await expect(decryptChunk(reordered)).rejects.toThrow('CHUNK_DECRYPT_FAILED');
  });
});
