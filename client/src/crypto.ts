/**
 * SoxChat Crypto — Phase (b): E2EE message encryption.
 *
 * Uses Web Crypto API only. No custom crypto.
 *
 * Key derivation:
 *   roomKey (256 bits, from URL fragment)
 *     ├── HKDF-SHA256(salt="soxchat-msg-v1", info="messages")  → msgKey
 *     └── HKDF-SHA256(salt="soxchat-file-v1", info="files")    → fileKey (phase c)
 *
 * Message encryption:
 *   AES-256-GCM with msgKey
 *   IV: 96-bit random (crypto.getRandomValues)
 *   AAD: userId || timestamp (authenticates sender and ordering)
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

// --- Base64 helpers ---

export function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function b64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- HKDF key derivation ---

async function deriveKey(
  roomKey: Uint8Array,
  salt: string,
  info: string,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    roomKey.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode(salt),
      info: enc.encode(info),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// --- Key cache ---

let msgKeyPromise: Promise<CryptoKey> | null = null;

export function initKeys(roomKeyHex: string): void {
  const roomKeyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    roomKeyBytes[i] = parseInt(roomKeyHex.slice(i * 2, i * 2 + 2), 16);
  }
  msgKeyPromise = deriveKey(roomKeyBytes, 'soxchat-msg-v1', 'messages');
}

async function getMsgKey(): Promise<CryptoKey> {
  if (!msgKeyPromise) throw new Error('Keys not initialized');
  return msgKeyPromise;
}

// --- Message encryption ---

export interface EncryptedMessage {
  iv: string; // base64
  ct: string; // base64 (ciphertext + GCM tag)
}

export async function encryptMessage(
  plaintext: string,
  userId: string,
  timestamp: number,
): Promise<EncryptedMessage> {
  const key = await getMsgKey();

  // 96-bit random IV — never reused
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // AAD authenticates sender and prevents replay/reordering
  const aad = enc.encode(`${userId}|${timestamp}`);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, additionalData: aad },
    key,
    enc.encode(plaintext),
  );

  return {
    iv: bufToB64(iv),
    ct: bufToB64(ciphertext),
  };
}

export async function decryptMessage(
  msg: EncryptedMessage,
  userId: string,
  timestamp: number,
): Promise<string> {
  const key = await getMsgKey();

  const iv = b64ToBuf(msg.iv);
  const ct = b64ToBuf(msg.ct);
  const aad = enc.encode(`${userId}|${timestamp}`);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, additionalData: aad },
      key,
      ct.buffer as ArrayBuffer,
    );
    return dec.decode(plaintext);
  } catch {
    throw new Error('DECRYPT_FAILED');
  }
}

// --- Room key generation (for room creator) ---

export function generateRoomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
