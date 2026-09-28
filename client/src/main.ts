/**
 * SoxChat Client — Phase (c): E2EE messages + encrypted file transfer.
 */

import { initKeys, encryptMessage, decryptMessage, generateRoomKey } from './crypto.js';
import {
  initFileKey,
  encryptFileMeta,
  encryptChunk,
  decryptFileMeta,
  decryptChunk,
  chunkSize,
  chunkCount,
} from './fileCrypto.js';

type WSMessage =
  | { type: 'join'; nick: string }
  | { type: 'msg'; iv: string; ct: string; ts: number }
  | { type: 'file:offer'; fileId: string; nameEnc: string; mimeEnc: string; size: number; chunkCount: number; iv: string }
  | { type: 'file:chunk'; fileId: string; index: number; iv: string; data: string }
  | { type: 'leave' };

type ServerMessage =
  | { type: 'joined'; userId: string; participants: Array<{ id: string; nick: string }> }
  | { type: 'peer:joined'; userId: string; nick: string }
  | { type: 'peer:left'; userId: string }
  | { type: 'msg'; from: string; iv: string; ct: string; ts: number }
  | { type: 'file:offer'; from: string; fileId: string; nameEnc: string; mimeEnc: string; size: number; chunkCount: number; iv: string }
  | { type: 'file:chunk'; from: string; fileId: string; index: number; iv: string; data: string }
  | { type: 'file:done'; from: string; fileId: string }
  | { type: 'error'; code: string }
  | { type: 'room:destroyed' };

// --- State ---
let ws: WebSocket | null = null;
let myUserId: string | null = null;
let currentRoomId: string | null = null;
let nick: string = '';

// --- DOM helpers ---
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function getInput(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`Missing input #${id}`);
  return el;
}

function showScreen(id: string): void {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

// --- API ---
// Use VITE_API_URL if set (for separate frontend/backend domains), else same origin
const API_URL = import.meta.env.VITE_API_URL ?? '';

async function createRoom(): Promise<{ roomId: string; expiresAt: number }> {
  const res = await fetch(`${API_URL}/api/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to create room');
  return res.json();
}

// --- WebSocket ---
// Use VITE_WS_URL if set, else derive from current location
const WS_URL = import.meta.env.VITE_WS_URL ?? '';

function connectWs(roomId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const wsBase = WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    ws = new WebSocket(`${wsBase}/ws/room/${roomId}`);

    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WS connection failed'));
    ws.onclose = (e) => {
      if (e.code !== 1000) {
        addSystemMessage('Conexión cerrada');
      }
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      handleServerMessage(msg);
    };
  });
}

function send(msg: WSMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

let handleServerMessage = function(msg: ServerMessage): void {
  // Fire-and-forget async decryption
  void (async () => {
  switch (msg.type) {
    case 'joined':
      myUserId = msg.userId;
      updateParticipants(msg.participants);
      break;
    case 'peer:joined':
      addSystemMessage(`${msg.nick} se unió`);
      break;
    case 'peer:left':
      addSystemMessage('Un participante salió');
      break;
    case 'msg': {
      if (!myUserId) break;
      try {
        const plaintext = await decryptMessage(
          { iv: msg.iv, ct: msg.ct },
          msg.from,
          msg.ts,
        );
        addMessage(msg.from, plaintext, msg.from === myUserId);
      } catch {
        addSystemMessage('Mensaje no pudo ser descifrado');
      }
      break;
    }
    case 'error':
      addSystemMessage(`Error: ${msg.code}`);
      break;
    case 'room:destroyed':
      addSystemMessage('La sala fue destruida');
      break;
  }
  })();
};

// --- UI ---
function updateParticipants(list: Array<{ id: string; nick: string }>): void {
  $('participants').textContent = `${list.length} participante(s): ${list.map((p) => p.nick).join(', ')}`;
}

function addMessage(from: string, text: string, own: boolean): void {
  const div = document.createElement('div');
  div.className = `message${own ? ' own' : ''}`;
  const nickLabel = own ? 'Tú' : from.slice(0, 8);
  div.innerHTML = `<div class="nick">${escapeHtml(nickLabel)}</div><div class="text">${escapeHtml(text)}</div>`;
  $('messages').appendChild(div);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function addSystemMessage(text: string): void {
  const div = document.createElement('div');
  div.className = 'message';
  div.innerHTML = `<div class="text" style="color:#888;font-style:italic">${escapeHtml(text)}</div>`;
  $('messages').appendChild(div);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// --- Event handlers ---
$('btn-create').addEventListener('click', async () => {
  try {
    const { roomId, expiresAt } = await createRoom();
    currentRoomId = roomId;

    // Generate 256-bit room key for E2EE
    const keyHex = generateRoomKey();

    const inviteUrl = `${location.origin}/room/${roomId}#${keyHex}`;
    await navigator.clipboard.writeText(inviteUrl);
    alert(`Enlace copiado al portapapeles:\n${inviteUrl}\n\nLa sala expira en ${new Date(expiresAt).toLocaleTimeString()}`);

    showScreen('nick-entry');
  } catch {
    alert('Error al crear la sala');
  }
});

let roomKeyHex: string = '';

$('btn-join').addEventListener('click', () => {
  const url = getInput('join-url').value.trim();
  const match = url.match(/\/room\/([a-f0-9]{64})#([a-f0-9]{64})/);
  if (!match) {
    alert('Enlace inválido');
    return;
  }
  currentRoomId = match[1];
  roomKeyHex = match[2];
  showScreen('nick-entry');
});

$('btn-enter').addEventListener('click', async () => {
  nick = getInput('nick-input').value.trim();
  if (!nick || !currentRoomId || !roomKeyHex) return;

  // Initialize E2EE keys from the room key in the URL fragment
  initKeys(roomKeyHex);
  initFileKey(roomKeyHex);

  try {
    await connectWs(currentRoomId);
    send({ type: 'join', nick });
    showScreen('chat');
    $('room-id-display').textContent = `Sala: ${currentRoomId.slice(0, 16)}...`;
    getInput('msg-input').focus();
  } catch {
    alert('No se pudo conectar a la sala');
  }
});

$('btn-send').addEventListener('click', async () => {
  const text = getInput('msg-input').value.trim();
  if (!text || !myUserId) return;

  const ts = Date.now();
  const encrypted = await encryptMessage(text, myUserId, ts);
  send({ type: 'msg', iv: encrypted.iv, ct: encrypted.ct, ts });
  addMessage(myUserId, text, true);
  getInput('msg-input').value = '';
});

getInput('msg-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-send').click();
});

$('btn-destroy').addEventListener('click', () => {
  if (confirm('¿Destruir la sala? Se borrarán todos los mensajes.')) {
    send({ type: 'leave' });
    ws?.close();
    location.reload();
  }
});

// --- File transfer ---

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

$('btn-file').addEventListener('click', () => {
  getInput('file-input').click();
});

getInput('file-input').addEventListener('change', async () => {
  const file = getInput('file-input').files?.[0];
  if (!file || !myUserId) return;
  if (file.size > MAX_FILE_SIZE) {
    alert('Archivo demasiado grande (máx 10 MB)');
    return;
  }

  const fileId = crypto.randomUUID();
  const chunks = chunkCount(file.size);

  // Send metadata offer
  const meta = await encryptFileMeta(fileId, file.name, file.type || 'application/octet-stream', file.size, chunks);
  send({
    type: 'file:offer',
    fileId,
    nameEnc: meta.nameEnc,
    mimeEnc: meta.mimeEnc,
    size: meta.size,
    chunkCount: meta.chunkCount,
    iv: meta.iv,
  });

  // Send chunks
  const buffer = new Uint8Array(await file.arrayBuffer());
  for (let i = 0; i < chunks; i++) {
    const start = i * chunkSize();
    const end = Math.min(start + chunkSize(), buffer.length);
    const chunkData = buffer.slice(start, end);
    const encrypted = await encryptChunk(fileId, i, chunkData);
    send({
      type: 'file:chunk',
      fileId,
      index: encrypted.index,
      iv: encrypted.iv,
      data: encrypted.data,
    });
  }

  addSystemMessage(`Archivo "${file.name}" enviado`);
  getInput('file-input').value = '';
});

// Incoming file chunks
const incomingFiles = new Map<string, {
  meta: { nameEnc: string; mimeEnc: string; size: number; chunkCount: number; iv: string };
  chunks: Map<number, { iv: string; data: string }>;
  from: string;
}>();

// Handle file:offer from server
const originalHandleServerMessage = handleServerMessage;
handleServerMessage = (msg: ServerMessage) => {
  if (msg.type === 'file:offer') {
    incomingFiles.set(msg.fileId, {
      meta: { nameEnc: msg.nameEnc, mimeEnc: msg.mimeEnc, size: msg.size, chunkCount: msg.chunkCount, iv: msg.iv },
      chunks: new Map(),
      from: msg.from,
    });
    addSystemMessage('Recibiendo archivo...');
    return;
  }
  if (msg.type === 'file:chunk') {
    const file = incomingFiles.get(msg.fileId);
    if (file) {
      file.chunks.set(msg.index, { iv: msg.iv, data: msg.data });
    }
    return;
  }
  if (msg.type === 'file:done') {
    const file = incomingFiles.get(msg.fileId);
    if (file) {
      void downloadFile(msg.fileId, file);
    }
    return;
  }
  originalHandleServerMessage(msg);
};

async function downloadFile(fileId: string, file: {
  meta: { nameEnc: string; mimeEnc: string; size: number; chunkCount: number; iv: string };
  chunks: Map<number, { iv: string; data: string }>;
  from: string;
}) {
  try {
    const { name } = await decryptFileMeta({
      fileId,
      nameEnc: file.meta.nameEnc,
      mimeEnc: file.meta.mimeEnc,
      size: file.meta.size,
      chunkCount: file.meta.chunkCount,
      iv: file.meta.iv,
    });

    const decryptedChunks: Uint8Array[] = [];
    for (let i = 0; i < file.meta.chunkCount; i++) {
      const chunk = file.chunks.get(i);
      if (!chunk) throw new Error('Missing chunk');
      const decrypted = await decryptChunk({ fileId, index: i, iv: chunk.iv, data: chunk.data });
      decryptedChunks.push(decrypted);
    }

    const totalLength = decryptedChunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of decryptedChunks) {
      combined.set(c, offset);
      offset += c.length;
    }

    const blob = new Blob([combined]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    addSystemMessage(`Archivo "${name}" descargado`);
  } catch {
    addSystemMessage('Error al descargar archivo');
  }
  incomingFiles.delete(fileId);
}
