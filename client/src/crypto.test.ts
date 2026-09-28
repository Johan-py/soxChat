/**
 * Tests for Phase (b): E2EE message encryption.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initKeys,
  encryptMessage,
  decryptMessage,
  generateRoomKey,
  bufToB64,
  b64ToBuf,
} from './crypto.js';

const TEST_KEY = 'a'.repeat(64); // 256-bit key in hex

describe('generateRoomKey', () => {
  it('generates 256-bit hex key', () => {
    const key = generateRoomKey();
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates unique keys', () => {
    const k1 = generateRoomKey();
    const k2 = generateRoomKey();
    expect(k1).not.toBe(k2);
  });
});

describe('Base64 helpers', () => {
  it('roundtrips Uint8Array', () => {
    const original = new Uint8Array([1, 2, 3, 255, 0, 128]);
    const b64 = bufToB64(original);
    const decoded = b64ToBuf(b64);
    expect([...decoded]).toEqual([...original]);
  });
});

describe('encryptMessage / decryptMessage', () => {
  beforeEach(() => {
    initKeys(TEST_KEY);
  });

  it('roundtrips a message', async () => {
    const msg = await encryptMessage('Hello, E2EE!', 'user1', 1234567890);
    expect(msg.iv).toBeDefined();
    expect(msg.ct).toBeDefined();

    const plaintext = await decryptMessage(msg, 'user1', 1234567890);
    expect(plaintext).toBe('Hello, E2EE!');
  });

  it('produces different ciphertexts for same plaintext (random IV)', async () => {
    const msg1 = await encryptMessage('same text', 'user1', 1000);
    const msg2 = await encryptMessage('same text', 'user1', 1000);
    expect(msg1.ct).not.toBe(msg2.ct);
    expect(msg1.iv).not.toBe(msg2.iv);
  });

  it('fails to decrypt with wrong userId (AAD mismatch)', async () => {
    const msg = await encryptMessage('secret', 'user1', 1000);
    await expect(decryptMessage(msg, 'user2', 1000)).rejects.toThrow('DECRYPT_FAILED');
  });

  it('fails to decrypt with wrong timestamp (AAD mismatch)', async () => {
    const msg = await encryptMessage('secret', 'user1', 1000);
    await expect(decryptMessage(msg, 'user1', 2000)).rejects.toThrow('DECRYPT_FAILED');
  });

  it('fails to decrypt tampered ciphertext', async () => {
    const msg = await encryptMessage('secret', 'user1', 1000);
    // Tamper with the ciphertext
    const tampered = { ...msg, ct: msg.ct.slice(0, -4) + 'AAAA' };
    await expect(decryptMessage(tampered, 'user1', 1000)).rejects.toThrow('DECRYPT_FAILED');
  });

  it('fails to decrypt with wrong IV', async () => {
    const msg = await encryptMessage('secret', 'user1', 1000);
    const wrongIv = { ...msg, iv: bufToB64(new Uint8Array(12)) };
    await expect(decryptMessage(wrongIv, 'user1', 1000)).rejects.toThrow('DECRYPT_FAILED');
  });

  it('handles unicode and special characters', async () => {
    const text = 'Hola ñoño 🎉 <script>alert("xss")</script>';
    const msg = await encryptMessage(text, 'user1', 1000);
    const decrypted = await decryptMessage(msg, 'user1', 1000);
    expect(decrypted).toBe(text);
  });

  it('handles empty string', async () => {
    const msg = await encryptMessage('', 'user1', 1000);
    const decrypted = await decryptMessage(msg, 'user1', 1000);
    expect(decrypted).toBe('');
  });
});

describe('Key derivation', () => {
  it('different room keys produce different message keys', async () => {
    initKeys('a'.repeat(64));
    const msg1 = await encryptMessage('test', 'user1', 1000);

    initKeys('b'.repeat(64));
    // Should fail — different key derived
    await expect(decryptMessage(msg1, 'user1', 1000)).rejects.toThrow('DECRYPT_FAILED');
  });
});
