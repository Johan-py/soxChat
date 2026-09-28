# Threat Model — SoxChat

## 1. Overview

SoxChat is an ephemeral, end-to-end encrypted (E2EE) chat platform with file sharing. The server acts as a "dumb relay" and **must never** be able to read message contents or file data.

---

## 2. Threat Actors

### 2.1 Server Operator ("Honest but Curious")

**Description:** The server operator runs the infrastructure but is curious about user communications.

**Mitigations:**
- All messages and files are encrypted client-side before reaching the server
- The room key travels in the URL fragment (`#`), which browsers never send to the server
- The server only sees ciphertext, metadata (room ID, timestamps, file sizes), and encrypted file names
- No plaintext is logged

**Residual risk:** The operator can see metadata (who talks to whom, when, how much data is transferred).

---

### 2.2 Network Attacker (Passive)

**Description:** An attacker who can observe network traffic (e.g., on a shared Wi-Fi network, ISP, or compromised router).

**Mitigations:**
- TLS is mandatory in production (enforced by Caddy with automatic Let's Encrypt certificates)
- HSTS header with `max-age=31536000; includeSubDomains; preload` prevents downgrade attacks
- All WebSocket connections are over WSS (TLS)

**Residual risk:** The attacker can see metadata (IP addresses, connection times, data volumes).

---

### 2.3 Network Attacker (Active)

**Description:** An attacker who can actively modify, inject, or drop network packets.

**Mitigations:**
- TLS with certificate validation prevents man-in-the-middle attacks
- AES-256-GCM provides authenticated encryption — tampered ciphertext is detected and rejected
- AAD (Additional Authenticated Data) binds each message to its sender and timestamp
- File chunks include their index in the AAD, preventing reordering and truncation

**Residual risk:** None for content confidentiality/integrity. Metadata remains visible.

---

### 2.4 Malicious Room Participant

**Description:** A user who has the invite link and joins a room with malicious intent.

**Mitigations:**
- Rate limiting on room creation and WS connections
- Maximum participants per room (configurable, default 20)
- Message size limits prevent abuse
- File size limits prevent storage exhaustion

**Residual risk:** A malicious participant can spam messages or files within the limits. There is no authentication of participants (see Out of Scope).

---

### 2.5 Client-Side Attacker

**Description:** An attacker who compromises the client device or browser.

**Mitigations:**
- None — this is outside the threat model. If the client is compromised, the attacker has full access to plaintext.

---

## 3. Out of Scope (Explicitly)

The following are **not** addressed in this version:

1. **Malicious server serving modified JavaScript:** If the server is fully compromised and serves altered client code, all security guarantees are void. Mitigation would require Subresource Integrity (SRI) and reproducible builds.

2. **Compromised endpoints / supply chain attacks:** If npm dependencies or build tools are compromised, the client code may be altered.

3. **Metadata/traffic analysis:** An observer can see who communicates with whom, when, and how much data is transferred. Protecting against this requires mix networks or padding.

4. **Forward secrecy:** If the room key is compromised (e.g., leaked via screenshot, logs, or malware), all past messages encrypted with that key can be decrypted. Future improvement: ECDH key exchange per participant with ephemeral keys.

5. **Participant authentication:** Anyone with the invite link can join. There is no verification of participant identity. Future improvement: digital signatures or QR code verification.

6. **Denial of service:** While rate limiting mitigates basic abuse, a determined attacker with significant resources can still overwhelm the server.

7. **Client device compromise:** If a user's device is infected with malware, all encryption is bypassed.

---

## 4. Data Flow Diagram

```
┌─────────────┐                    ┌─────────────┐                    ┌─────────────┐
│  Alice      │                    │   Server    │                    │   Bob       │
│  (Browser)  │                    │  (Relay)    │                    │  (Browser)  │
└──────┬──────┘                    └──────┬──────┘                    └──────┬──────┘
       │                                  │                                  │
       │  1. POST /api/rooms              │                                  │
       │ ───────────────────────────────► │                                  │
       │  ◄── { roomId, expiresAt }       │                                  │
       │                                  │                                  │
       │  2. Derive msgKey, fileKey       │                                  │
       │     from roomKey (fragment)      │                                  │
       │                                  │                                  │
       │  3. WSS /ws/room/:id             │                                  │
       │ ───────────────────────────────► │                                  │
       │  { type: 'join', nick }          │                                  │
       │ ◄──────────── { type: 'joined' } │                                  │
       │                                  │                                  │
       │  4. { type: 'msg', iv, ct, ts }   │                                  │
       │ ───────────────────────────────► │  5. { type: 'msg', from, iv, ct }│
       │                                  │ ───────────────────────────────► │
       │                                  │                                  │
       │                                  │  6. Bob decrypts with msgKey      │
       │                                  │     (derived from same roomKey)   │
       │                                  │                                  │
```

**Key observation:** The server never sees `roomKey`, `msgKey`, or `fileKey`. It only relays ciphertext.

---

## 5. Security Properties

| Property | Guaranteed? | Mechanism |
|----------|-------------|-----------|
| Confidentiality of messages | Yes | AES-256-GCM with client-side keys |
| Confidentiality of files | Yes | AES-256-GCM with client-side keys |
| Confidentiality of file names | Yes | Encrypted in file:offer payload |
| Integrity of messages | Yes | GCM authentication tag |
| Integrity of files | Yes | GCM tag per chunk + AAD with index |
| Forward secrecy | No | Shared room key for all messages |
| Participant authentication | No | Anyone with link can join |
| Metadata protection | No | Server sees room IDs, timestamps, sizes |
| Server cannot read content | Yes | Keys never leave the client |

---

## 6. Assumptions

1. The client device is not compromised
2. The server serves unmodified JavaScript (no supply chain compromise)
3. TLS certificates are valid and trusted
4. The room key is shared out-of-band (not through the server)
5. Users do not share the room key with unauthorized parties
