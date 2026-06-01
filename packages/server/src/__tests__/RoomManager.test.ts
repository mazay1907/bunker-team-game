/**
 * Unit tests for RoomManager.
 * Tests: room code generation, createRoom, uniqueNickname.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from '../services/RoomManager.js';
import { InMemoryRoomStore } from '../store/RoomStore.js';
import { InMemorySessionStore } from '../store/SessionStore.js';
import { InMemoryReconnectStore } from '../store/ReconnectStore.js';
import { ROOM_CODE_CHARSET, ROOM_CODE_LENGTH } from '@bunker/shared';

describe('RoomManager', () => {
  let manager: RoomManager;
  let roomStore: InMemoryRoomStore;
  let sessionStore: InMemorySessionStore;
  let reconnectStore: InMemoryReconnectStore;

  beforeEach(() => {
    roomStore = new InMemoryRoomStore();
    sessionStore = new InMemorySessionStore();
    reconnectStore = new InMemoryReconnectStore();
    manager = new RoomManager(roomStore, sessionStore, reconnectStore);
  });

  describe('generateRoomCode', () => {
    it('generates a code of exactly 6 characters', () => {
      const code = manager.generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
    });

    it('uses only characters from the allowed charset (no O, I, 0, 1)', () => {
      for (let i = 0; i < 20; i++) {
        const code = manager.generateRoomCode();
        for (const char of code) {
          expect(ROOM_CODE_CHARSET).toContain(char);
        }
      }
    });

    it('generates unique codes on repeated calls (probabilistic)', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 20; i++) {
        codes.add(manager.generateRoomCode());
      }
      // With 32^6 = ~1 billion possible codes, collisions are essentially impossible
      expect(codes.size).toBe(20);
    });

    it('does not contain ambiguous characters O, I, 0, 1', () => {
      const AMBIGUOUS = new Set(['O', 'I', '0', '1']);
      for (let i = 0; i < 20; i++) {
        const code = manager.generateRoomCode();
        for (const char of code) {
          expect(AMBIGUOUS.has(char)).toBe(false);
        }
      }
    });
  });

  describe('createRoom', () => {
    it('returns all required fields', () => {
      const result = manager.createRoom('Аня');
      expect(result).toHaveProperty('roomId');
      expect(result).toHaveProperty('roomCode');
      expect(result).toHaveProperty('roomUrl');
      expect(result).toHaveProperty('playerId');
      expect(result).toHaveProperty('sessionToken');
      expect(result).toHaveProperty('reconnectToken');
    });

    it('roomUrl is /r/<roomCode>', () => {
      const result = manager.createRoom('TestHost');
      expect(result.roomUrl).toBe(`/r/${result.roomCode}`);
    });

    it('sessionToken is 64 hex chars', () => {
      const result = manager.createRoom('TestHost');
      expect(result.sessionToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('reconnectToken is 64 hex chars', () => {
      const result = manager.createRoom('TestHost');
      expect(result.reconnectToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('stores the room in roomStore', () => {
      const result = manager.createRoom('TestHost');
      const stored = roomStore.getRoom(result.roomId);
      expect(stored).toBeDefined();
      expect(stored?.roomCode).toBe(result.roomCode);
    });

    it('stores the session token in sessionStore', () => {
      const result = manager.createRoom('TestHost');
      const playerId = sessionStore.get(result.sessionToken);
      expect(playerId).toBe(result.playerId);
    });

    it('stores the reconnect token in reconnectStore', () => {
      const result = manager.createRoom('TestHost');
      const playerId = reconnectStore.get(result.reconnectToken);
      expect(playerId).toBe(result.playerId);
    });

    it('creates host player with ACTIVE status and socketId null', () => {
      const result = manager.createRoom('TestHost');
      const room = roomStore.getRoom(result.roomId);
      const player = room?.players.get(result.playerId);
      expect(player?.status).toBe('ACTIVE');
      expect(player?.socketId).toBeNull();
    });
  });

  describe('uniqueNickname', () => {
    it('returns base nickname when not taken', () => {
      const result = manager.uniqueNickname('Аня', new Set());
      expect(result).toBe('Аня');
    });

    it('appends (2) when base is taken', () => {
      const result = manager.uniqueNickname('Аня', new Set(['Аня']));
      expect(result).toBe('Аня (2)');
    });

    it('appends (3) when base and (2) are taken', () => {
      const result = manager.uniqueNickname('Аня', new Set(['Аня', 'Аня (2)']));
      expect(result).toBe('Аня (3)');
    });
  });
});
