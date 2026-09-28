/**
 * FileStore — temporary storage for encrypted file chunks.
 *
 * Security:
 * - Files stored with random names (never original names)
 * - Stored in a temp directory, deleted on room expiry
 * - Served only as application/octet-stream with Content-Disposition: attachment
 * - Hard size limit enforced
 * - No persistence across restarts
 */

import { createWriteStream, createReadStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { Config } from './config.js';

export interface StoredFile {
  fileId: string;
  ownerId: string;
  totalChunks: number;
  receivedChunks: Set<number>;
  size: number;
  tempPath: string;
  createdAt: number;
}

export class FileStore {
  private files = new Map<string, StoredFile>();
  private config: Config;
  private tempDir: string;

  constructor(config: Config, tempDir: string) {
    this.config = config;
    this.tempDir = tempDir;
  }

  /**
   * Initialize a new file upload.
   * Returns the fileId to use for chunks.
   */
  createFile(ownerId: string, totalChunks: number, size: number): StoredFile {
    if (size > this.config.maxFileBytes) {
      throw new Error('FILE_TOO_LARGE');
    }
    const fileId = randomBytes(16).toString('hex');
    const tempPath = join(this.tempDir, `tmp_${fileId}`);
    const file: StoredFile = {
      fileId,
      ownerId,
      totalChunks,
      receivedChunks: new Set(),
      size,
      tempPath,
      createdAt: Date.now(),
    };
    this.files.set(fileId, file);
    return file;
  }

  /**
   * Store a chunk. Returns true if all chunks received.
   */
  async storeChunk(
    fileId: string,
    index: number,
    data: Buffer,
  ): Promise<{ complete: boolean; received: number; total: number }> {
    const file = this.files.get(fileId);
    if (!file) throw new Error('FILE_NOT_FOUND');
    if (index < 0 || index >= file.totalChunks) throw new Error('INVALID_CHUNK_INDEX');

    // Write chunk to temp file at correct offset
    const offset = index * this.config.chunkSize;
    const fd = await fs.open(file.tempPath, 'w');
    try {
      await fd.write(data, 0, data.length, offset);
    } finally {
      await fd.close();
    }

    file.receivedChunks.add(index);
    return {
      complete: file.receivedChunks.size === file.totalChunks,
      received: file.receivedChunks.size,
      total: file.totalChunks,
    };
  }

  /**
   * Get file info for download.
   */
  getFile(fileId: string): StoredFile | undefined {
    return this.files.get(fileId);
  }

  /**
   * Delete a file and its temp data.
   */
  async deleteFile(fileId: string): Promise<void> {
    const file = this.files.get(fileId);
    if (!file) return;
    try {
      await fs.unlink(file.tempPath);
    } catch {
      // File may not exist — ignore
    }
    this.files.delete(fileId);
  }

  /**
   * Delete all files (on room destroy).
   */
  async deleteAll(): Promise<void> {
    for (const file of this.files.values()) {
      try {
        await fs.unlink(file.tempPath);
      } catch {
        // Ignore
      }
    }
    this.files.clear();
  }

  /**
   * Get file hash for integrity verification (optional).
   */
  async getFileHash(fileId: string): Promise<string | null> {
    const file = this.files.get(fileId);
    if (!file) return null;
    const hash = createHash('sha256');
    const stream = createReadStream(file.tempPath);
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  get activeFileCount(): number {
    return this.files.size;
  }
}
