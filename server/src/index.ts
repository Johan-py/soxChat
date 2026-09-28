/**
 * SoxChat Server — Phase (c): E2EE messages + encrypted file relay.
 *
 * The server is a "dumb relay": it never sees plaintext messages or files.
 * All content is encrypted client-side before reaching the server.
 */

import Fastify from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { RoomManager, Room, Participant } from './room.js';
import { RateLimiter } from './ratelimit.js';
import { FileStore } from './fileStore.js';
import securityHeaders from './security.js';

const config = loadConfig();
const app = Fastify({ logger: false });

// Register security headers plugin
await app.register(securityHeaders);

const tempDir = mkdtempSync(join(tmpdir(), 'soxchat-'));
const roomManager = new RoomManager(config);
const fileStore = new FileStore(config, tempDir);
const roomCreateLimiter = new RateLimiter(
  config.rateLimitRoomCreate.max,
  config.rateLimitRoomCreate.windowMs,
);
const wsConnectLimiter = new RateLimiter(
  config.rateLimitWsConnect.max,
  config.rateLimitWsConnect.windowMs,
);

// Periodic cleanup of expired rooms and rate limiter buckets
setInterval(() => {
  roomManager.cleanupExpired();
  roomCreateLimiter.cleanup();
  wsConnectLimiter.cleanup();
}, 30_000);

// Global error handler — never leak internal details
app.setErrorHandler((error, request, reply) => {
  // Log minimal info (no stack traces, no internal details)
  console.error(`[ERROR] ${request.method} ${request.url} — ${error.message}`);

  // Return generic error to client
  reply.code(500).send({ error: 'INTERNAL_ERROR' });
});

// --- HTTP: Create room ---

app.post('/api/rooms', async (request, reply) => {
  const clientIp = request.ip ?? request.socket.remoteAddress ?? 'unknown';

  if (!roomCreateLimiter.isAllowed(clientIp)) {
    return reply.code(429).send({ error: 'RATE_LIMITED' });
  }

  try {
    const room = roomManager.createRoom();
    return reply.code(201).send({
      roomId: room.id,
      expiresAt: room.expiresAt,
    });
  } catch {
    return reply.code(503).send({ error: 'SERVER_AT_CAPACITY' });
  }
});

// --- HTTP: Room info (for client to verify room exists) ---

const roomQueryLimiter = new RateLimiter(60, 60_000); // 60 requests per minute

app.get('/api/rooms/:id', async (request, reply) => {
  const clientIp = request.ip ?? request.socket.remoteAddress ?? 'unknown';

  if (!roomQueryLimiter.isAllowed(clientIp)) {
    return reply.code(429).send({ error: 'RATE_LIMITED' });
  }

  const { id } = request.params as { id: string };

  // Strict ID format validation (64 hex chars = 256 bits)
  if (!/^[a-f0-9]{64}$/.test(id)) {
    return reply.code(400).send({ error: 'INVALID_ROOM_ID' });
  }

  const room = roomManager.getRoom(id);
  if (!room) {
    return reply.code(404).send({ error: 'ROOM_NOT_FOUND' });
  }

  return reply.code(200).send({
    roomId: room.id,
    expiresAt: room.expiresAt,
    participantCount: room.participantCount,
  });
});

// --- WebSocket: /ws/room/:id ---

const wss = new WebSocketServer({ noServer: true });

app.server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '', 'http://localhost');
  const match = url.pathname.match(/^\/ws\/room\/([a-f0-9]{64})$/);

  if (!match) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const roomId = match[1];
  const clientIp = request.socket.remoteAddress ?? 'unknown';

  if (!wsConnectLimiter.isAllowed(clientIp)) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    handleConnection(ws, room);
  });
});

function handleConnection(ws: WebSocket, room: Room): void {
  let participant: Participant | null = null;

  ws.on('message', (data) => {
    void handleMessage(data).catch(() => {
      ws.close(1011, 'Internal error');
    });
  });

  async function handleMessage(data: WebSocket.RawData): Promise<void> {
    // Hard size limit on incoming messages
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    if (raw.length > config.maxMessageBytes) {
      ws.send(JSON.stringify({ type: 'error', code: 'MESSAGE_TOO_LARGE' }));
      return;
    }

    let msg: { type: string; [key: string]: unknown };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_JSON' }));
      return;
    }

    switch (msg.type) {
      case 'join': {
        if (participant) return; // already joined

        const nick = msg.nick;
        if (typeof nick !== 'string' || nick.length < 1 || nick.length > 32) {
          ws.send(JSON.stringify({ type: 'error', code: 'INVALID_NICK' }));
          return;
        }

        if (room.participantCount >= config.maxParticipantsPerRoom) {
          ws.send(JSON.stringify({ type: 'error', code: 'ROOM_FULL' }));
          return;
        }

        try {
          participant = room.addParticipant(ws, nick);
        } catch {
          ws.send(JSON.stringify({ type: 'error', code: 'ROOM_DESTROYED' }));
          return;
        }

        // Notify the joiner
        ws.send(
          JSON.stringify({
            type: 'joined',
            userId: participant.id,
            participants: room.participantList,
          }),
        );

        // Notify others
        room.broadcast(
          { type: 'peer:joined', userId: participant.id, nick },
          participant.id,
        );
        break;
      }

      case 'msg': {
        if (!participant) {
          ws.send(JSON.stringify({ type: 'error', code: 'NOT_JOINED' }));
          return;
        }
        // Phase (b): relay encrypted payload (iv + ct + ts). Server cannot decrypt.
        room.broadcast(
          {
            type: 'msg',
            from: participant.id,
            iv: msg.iv,
            ct: msg.ct,
            ts: msg.ts,
          },
          participant.id,
        );
        break;
      }

      case 'file:offer': {
        if (!participant) {
          ws.send(JSON.stringify({ type: 'error', code: 'NOT_JOINED' }));
          return;
        }
        const { fileId, nameEnc, mimeEnc, size, chunkCount, iv } = msg;
        if (
          typeof fileId !== 'string' ||
          typeof nameEnc !== 'string' ||
          typeof mimeEnc !== 'string' ||
          typeof size !== 'number' ||
          typeof chunkCount !== 'number' ||
          typeof iv !== 'string'
        ) {
          ws.send(JSON.stringify({ type: 'error', code: 'INVALID_FILE_OFFER' }));
          return;
        }
        if (size > config.maxFileBytes) {
          ws.send(JSON.stringify({ type: 'error', code: 'FILE_TOO_LARGE' }));
          return;
        }
        try {
          fileStore.createFile(participant.id, chunkCount, size);
        } catch {
          ws.send(JSON.stringify({ type: 'error', code: 'FILE_TOO_LARGE' }));
          return;
        }
        room.broadcast(
          {
            type: 'file:offer',
            from: participant.id,
            fileId,
            nameEnc,
            mimeEnc,
            size,
            chunkCount,
            iv,
          },
          participant.id,
        );
        break;
      }

      case 'file:chunk': {
        if (!participant) {
          ws.send(JSON.stringify({ type: 'error', code: 'NOT_JOINED' }));
          return;
        }
        const { fileId, index, iv, data } = msg;
        if (
          typeof fileId !== 'string' ||
          typeof index !== 'number' ||
          typeof iv !== 'string' ||
          typeof data !== 'string'
        ) {
          ws.send(JSON.stringify({ type: 'error', code: 'INVALID_CHUNK' }));
          return;
        }
        try {
          const buf = Buffer.from(data, 'base64');
          const result = await fileStore.storeChunk(fileId, index, buf);
          if (result.complete) {
            room.broadcast(
              { type: 'file:done', from: participant.id, fileId },
              participant.id,
            );
          }
        } catch {
          ws.send(JSON.stringify({ type: 'error', code: 'CHUNK_STORE_FAILED' }));
          return;
        }
        // Relay chunk to others
        room.broadcast(
          { type: 'file:chunk', from: participant.id, fileId, index, iv, data },
          participant.id,
        );
        break;
      }

      case 'leave': {
        ws.close(1000, 'User left');
        break;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', code: 'UNKNOWN_TYPE' }));
    }
  }

  ws.on('close', () => {
    if (participant) {
      room.removeParticipant(participant.id);
      room.broadcast({ type: 'peer:left', userId: participant.id });

      // Auto-destroy room if empty
      if (room.participantCount === 0) {
        roomManager.destroyRoom(room.id);
      }
    }
  });

  ws.on('error', () => {
    // Silently close on error — no internal details leaked
    ws.close(1011, 'Internal error');
  });
}

// --- Start ---

app.listen({ port: config.port, host: config.host }).then(() => {
  console.log(`SoxChat server listening on ${config.host}:${config.port}`);
});
