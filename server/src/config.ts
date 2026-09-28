/**
 * Server configuration.
 * All values can be overridden via environment variables.
 */

export interface Config {
  port: number;
  host: string;
  /** Default room TTL in milliseconds (1 hour) */
  roomTtlMs: number;
  /** Maximum number of active rooms */
  maxRooms: number;
  /** Maximum participants per room */
  maxParticipantsPerRoom: number;
  /** Maximum text message size in bytes (ciphertext + overhead) */
  maxMessageBytes: number;
  /** Maximum file size in bytes (10 MB default) */
  maxFileBytes: number;
  /** Chunk size for file encryption (64 KB) */
  chunkSize: number;
  /** Rate limit: room creations per IP per window */
  rateLimitRoomCreate: { max: number; windowMs: number };
  /** Rate limit: WS connections per IP per window */
  rateLimitWsConnect: { max: number; windowMs: number };
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid env ${name}: "${raw}"`);
  }
  return parsed;
}

export function loadConfig(): Config {
  return {
    port: envInt('PORT', 3000),
    host: process.env.HOST ?? '0.0.0.0',
    roomTtlMs: envInt('ROOM_TTL_MS', 60 * 60 * 1000), // 1 hour
    maxRooms: envInt('MAX_ROOMS', 1000),
    maxParticipantsPerRoom: envInt('MAX_PARTICIPANTS_PER_ROOM', 20),
    maxMessageBytes: envInt('MAX_MESSAGE_BYTES', 4096),
    maxFileBytes: envInt('MAX_FILE_BYTES', 10 * 1024 * 1024), // 10 MB
    chunkSize: envInt('CHUNK_SIZE', 64 * 1024), // 64 KB
    rateLimitRoomCreate: {
      max: envInt('RATE_LIMIT_ROOM_CREATE_MAX', 10),
      windowMs: envInt('RATE_LIMIT_ROOM_CREATE_WINDOW_MS', 60 * 1000),
    },
    rateLimitWsConnect: {
      max: envInt('RATE_LIMIT_WS_CONNECT_MAX', 30),
      windowMs: envInt('RATE_LIMIT_WS_CONNECT_WINDOW_MS', 60 * 1000),
    },
  };
}
