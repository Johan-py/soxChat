/**
 * Room and RoomManager — in-memory only, no persistence.
 *
 * Security notes:
 * - Room IDs are 256 bits of CSPRNG output (32 bytes hex-encoded).
 * - Rooms auto-destroy on TTL expiry; all participant sockets are closed.
 * - No message content is stored — only relayed in real-time.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { Config } from './config.js';

export interface Participant {
  id: string;
  socket: WebSocket;
  nick: string;
  joinedAt: number;
}

export class Room {
  readonly id: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  private participants = new Map<string, Participant>();
  private destroyed = false;

  constructor(id: string, ttlMs: number) {
    this.id = id;
    this.createdAt = Date.now();
    this.expiresAt = this.createdAt + ttlMs;
  }

  addParticipant(socket: WebSocket, nick: string): Participant {
    if (this.destroyed) throw new Error('Room is destroyed');
    const participant: Participant = {
      id: randomUUID(),
      socket,
      nick,
      joinedAt: Date.now(),
    };
    this.participants.set(participant.id, participant);
    return participant;
  }

  removeParticipant(id: string): void {
    this.participants.delete(id);
  }

  get participantCount(): number {
    return this.participants.size;
  }

  get participantList(): Array<{ id: string; nick: string }> {
    return [...this.participants.values()].map((p) => ({
      id: p.id,
      nick: p.nick,
    }));
  }

  getParticipant(id: string): Participant | undefined {
    return this.participants.get(id);
  }

  /** Broadcast a JSON message to all participants except optionally one. */
  broadcast(message: object, excludeId?: string): void {
    const data = JSON.stringify(message);
    for (const p of this.participants.values()) {
      if (p.id === excludeId) continue;
      if (p.socket.readyState === p.socket.OPEN) {
        p.socket.send(data);
      }
    }
  }

  /** Close all participant sockets and mark room as destroyed. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const p of this.participants.values()) {
      if (p.socket.readyState === p.socket.OPEN) {
        p.socket.close(1000, 'Room destroyed');
      }
    }
    this.participants.clear();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  get isExpired(): boolean {
    return Date.now() >= this.expiresAt;
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  createRoom(): Room {
    // Enforce global room limit
    this.cleanupExpired();
    if (this.rooms.size >= this.config.maxRooms) {
      throw new Error('Server at capacity');
    }
    // 256-bit random ID (32 bytes hex = 64 chars)
    const id = randomBytes(32).toString('hex');
    const room = new Room(id, this.config.roomTtlMs);
    this.rooms.set(id, room);
    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  destroyRoom(id: string): void {
    const room = this.rooms.get(id);
    if (room) {
      room.destroy();
      this.rooms.delete(id);
    }
  }

  /** Remove expired rooms. Returns count cleaned. */
  cleanupExpired(): number {
    let cleaned = 0;
    for (const [id, room] of this.rooms) {
      if (room.isExpired || room.isDestroyed) {
        room.destroy();
        this.rooms.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  get activeRoomCount(): number {
    return this.rooms.size;
  }
}
