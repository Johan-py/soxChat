/**
 * Tests for Phase (a): rooms, TTL, rate limiting.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Room, RoomManager } from './room.js';
import { RateLimiter } from './ratelimit.js';
import type { Config } from './config.js';

const testConfig: Config = {
  port: 3000,
  host: '0.0.0.0',
  roomTtlMs: 1000, // 1 second for testing
  maxRooms: 10,
  maxParticipantsPerRoom: 5,
  maxMessageBytes: 4096,
  maxFileBytes: 10 * 1024 * 1024,
  chunkSize: 64 * 1024,
  rateLimitRoomCreate: { max: 3, windowMs: 1000 },
  rateLimitWsConnect: { max: 5, windowMs: 1000 },
};

describe('Room', () => {
  it('creates room with 256-bit ID', () => {
    const room = new Room('a'.repeat(64), 60000);
    expect(room.id).toBe('a'.repeat(64));
    expect(room.isExpired).toBe(false);
    expect(room.isDestroyed).toBe(false);
  });

  it('expires after TTL', () => {
    vi.useFakeTimers();
    const room = new Room('b'.repeat(64), 1000);
    expect(room.isExpired).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(room.isExpired).toBe(true);
    vi.useRealTimers();
  });

  it('tracks participants', () => {
    const room = new Room('c'.repeat(64), 60000);
    const fakeSocket = { readyState: 1, OPEN: 1, send: vi.fn(), close: vi.fn() } as any;

    const p1 = room.addParticipant(fakeSocket, 'alice');
    const p2 = room.addParticipant(fakeSocket, 'bob');

    expect(room.participantCount).toBe(2);
    expect(room.participantList).toHaveLength(2);
    expect(room.getParticipant(p1.id)).toBeDefined();
    expect(room.getParticipant(p2.id)).toBeDefined();

    room.removeParticipant(p1.id);
    expect(room.participantCount).toBe(1);
  });

  it('broadcasts to all except sender', () => {
    const room = new Room('d'.repeat(64), 60000);
    const socket1 = { readyState: 1, OPEN: 1, send: vi.fn(), close: vi.fn() } as any;
    const socket2 = { readyState: 1, OPEN: 1, send: vi.fn(), close: vi.fn() } as any;

    const p1 = room.addParticipant(socket1, 'alice');
    room.addParticipant(socket2, 'bob');

    room.broadcast({ type: 'test' }, p1.id);

    expect(socket1.send).not.toHaveBeenCalled();
    expect(socket2.send).toHaveBeenCalledTimes(1);
  });

  it('destroys and closes sockets', () => {
    const room = new Room('e'.repeat(64), 60000);
    const socket = { readyState: 1, OPEN: 1, send: vi.fn(), close: vi.fn() } as any;
    room.addParticipant(socket, 'alice');

    room.destroy();

    expect(room.isDestroyed).toBe(true);
    expect(socket.close).toHaveBeenCalled();
    expect(room.participantCount).toBe(0);
  });
});

describe('RoomManager', () => {
  let manager: RoomManager;

  beforeEach(() => {
    manager = new RoomManager(testConfig);
  });

  it('creates and retrieves rooms', () => {
    const room = manager.createRoom();
    expect(room.id).toMatch(/^[a-f0-9]{64}$/);
    expect(manager.getRoom(room.id)).toBe(room);
  });

  it('enforces max rooms limit', () => {
    for (let i = 0; i < testConfig.maxRooms; i++) {
      manager.createRoom();
    }
    expect(() => manager.createRoom()).toThrow('Server at capacity');
  });

  it('cleanup removes expired rooms', () => {
    vi.useFakeTimers();
    const room = manager.createRoom();
    vi.advanceTimersByTime(testConfig.roomTtlMs + 1);
    const cleaned = manager.cleanupExpired();
    expect(cleaned).toBe(1);
    expect(manager.getRoom(room.id)).toBeUndefined();
    vi.useRealTimers();
  });

  it('destroyRoom removes room', () => {
    const room = manager.createRoom();
    manager.destroyRoom(room.id);
    expect(manager.getRoom(room.id)).toBeUndefined();
  });
});

describe('RateLimiter', () => {
  it('allows requests under limit', () => {
    const limiter = new RateLimiter(3, 1000);
    expect(limiter.isAllowed('ip1')).toBe(true);
    expect(limiter.isAllowed('ip1')).toBe(true);
    expect(limiter.isAllowed('ip1')).toBe(true);
  });

  it('blocks requests over limit', () => {
    const limiter = new RateLimiter(2, 1000);
    limiter.isAllowed('ip1');
    limiter.isAllowed('ip1');
    expect(limiter.isAllowed('ip1')).toBe(false);
  });

  it('tracks IPs separately', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.isAllowed('ip1')).toBe(true);
    expect(limiter.isAllowed('ip2')).toBe(true);
    expect(limiter.isAllowed('ip1')).toBe(false);
  });

  it('resets after window', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.isAllowed('ip1')).toBe(true);
    expect(limiter.isAllowed('ip1')).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(limiter.isAllowed('ip1')).toBe(true);
    vi.useRealTimers();
  });
});
