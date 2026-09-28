# Cryptographic Architecture — SoxChat

## 1. Overview

SoxChat uses **client-side end-to-end encryption** with the Web Crypto API. The server never has access to plaintext message or file content.

---

## 2. Key Hierarchy

```
roomKey (256 bits, generated client-side, transmitted in URL fragment)
    │
    ├── HKDF-SHA256(salt="soxchat-msg-v1",  info="messages")  → msgKey  (AES-256-GCM)
    └── HKDF-SHA256(salt="soxchat-file-v1", info="files")     → fileKey (AES-256-GCM)
```

### Why HKDF?

- **Domain separation:** Different salts and info strings ensure `msgKey` and `fileKey` are cryptographically independent. Compromising one does not compromise the other.
- **Key separation:** Even if the same room key is reused, the derived keys are distinct.
- **Standard:** HKDF is NIST SP 800-56C compliant.

### Room Key Generation

- 256 bits of CSPRNG output (`crypto.getRandomValues`)
- Transmitted in the URL fragment (`#`), which browsers never send to the server
- Shared via the invite link (must be shared out-of-band for maximum security)

---

## 3. Message Encryption

### Algorithm: AES-256-GCM

| Parameter | Value |
|-----------|-------|
| Key | `msgKey` (256 bits) |
| IV | 96 bits, random per message (`crypto.getRandomValues`) |
| AAD | `userId + "\|" + timestamp` |
| Output | IV (12 bytes) + Ciphertext + GCM Tag (16 bytes) |

### Why AES-256-GCM?

- **Authenticated encryption:** Provides confidentiality AND integrity in one operation
- **No padding oracle:** GCM is a stream cipher mode, immune to padding oracle attacks
- **Hardware acceleration:** AES-NI instructions on modern CPUs
- **Standard:** NIST SP 800-38D

### Why 96-bit IV?

- Optimal for GCM (no GHASH computation needed for IV)
- Random 96-bit IVs have negligible collision probability (birthday bound: ~2^48 messages)
- NIST recommends 96-bit IVs for GCM

### AAD (Additional Authenticated Data)

The AAD binds each message to:
- **Sender identity** (`userId`): Prevents impersonation
- **Timestamp**: Prevents replay attacks

The AAD is not encrypted but is authenticated — any modification causes decryption to fail.

---

## 4. File Encryption

### Chunking

Files are split into chunks (default 64 KB) for:
- **Memory efficiency:** Large files don't need to be loaded entirely into memory
- **Streaming:** Chunks can be encrypted and sent incrementally
- **Parallelism:** Chunks can be processed independently

### Per-Chunk Encryption

| Parameter | Value |
|-----------|-------|
| Key | `fileKey` (256 bits) |
| IV | 96 bits, random per chunk |
| AAD | `fileId + "\|" + chunkIndex` |
| Output | IV (12 bytes) + Ciphertext + GCM Tag (16 bytes) |

### Why AAD with chunk index?

- **Prevents reordering:** Each chunk is bound to its position
- **Prevents truncation:** Missing chunks are detected (gap in indices)
- **Prevents duplication:** Duplicate chunks are detected

### Metadata Encryption

File name and MIME type are encrypted together in the `file:offer` payload:

```
[2 bytes: name length][name bytes][mime bytes]
```

Encrypted with `fileKey`, AAD = `meta|fileId`.

---

## 5. Security Properties

| Property | Messages | Files |
|----------|----------|-------|
| Confidentiality | AES-256-GCM | AES-256-GCM |
| Integrity | GCM auth tag | GCM auth tag per chunk |
| Sender authentication | AAD with userId | AAD with fileId |
| Replay protection | AAD with timestamp | Chunk index in AAD |
| Reordering protection | N/A (single chunk) | Chunk index in AAD |
| Truncation detection | N/A | Chunk count verification |

---

## 6. Limitations

### 6.1 No Forward Secrecy

**Problem:** If the room key is compromised, ALL past messages and files can be decrypted.

**Future improvement:** ECDH (P-256) key exchange per participant with ephemeral keys. Each session would have a unique key, and past sessions would remain secure even if the long-term key is compromised.

### 6.2 No Participant Authentication

**Problem:** Anyone with the invite link can join. There is no verification of participant identity.

**Future improvement:** Digital signatures (Ed25519) or QR code verification (like Signal's safety numbers).

### 6.3 Metadata Visibility

**Problem:** The server can see:
- Room IDs
- Connection times
- Message timestamps
- File sizes
- Participant count

**Future improvement:** Traffic padding, mix networks, or onion routing.

### 6.4 Key Distribution

**Problem:** The room key is shared via the invite link. If the link is intercepted, the key is compromised.

**Mitigation:** Share the link via a secure channel (e.g., Signal, WhatsApp, in person).

---

## 7. Implementation Notes

### Web Crypto API Only

- No custom cryptographic implementations
- All operations use `crypto.subtle` (native browser implementation)
- Constant-time operations where applicable

### IV Uniqueness

- Every IV is generated with `crypto.getRandomValues` (CSPRNG)
- IVs are never reused with the same key
- 96-bit IVs provide negligible collision probability

### Key Caching

- Derived keys (`msgKey`, `fileKey`) are cached in memory
- Keys are never written to disk or localStorage
- Keys are cleared when the page is closed

---

## 8. Compliance

| Standard | Compliance |
|----------|------------|
| NIST SP 800-38D (GCM) | Yes |
| NIST SP 800-56C (HKDF) | Yes |
| FIPS 197 (AES) | Yes |
| RFC 5116 (AEAD) | Yes |
