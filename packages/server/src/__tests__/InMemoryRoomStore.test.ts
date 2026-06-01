/**
 * Unit tests for InMemoryRoomStore.
 * Tests: createRoom, getRoom, getRoomByCode, updateRoom, deleteRoom, getAllRooms.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRoomStore } from '../store/RoomStore.js';
import type { Room } from '@bunker/shared';

function makeRoom(overrides: Partial<Room> = {}): Room {
  const now = new Date();
  return {
    roomId: 'room-1',
    roomCode: 'ABC123',
    hostPlayerId: 'player-1',
    state: 'LOBBY',
    currentRound: null,
    currentPhase: null,
    scenarioId: null,
    players: new Map(),
    game: null,
    createdAt: now,
    lastActivityAt: now,
    hostUserId: null,
    ...overrides,
  };
}

describe('InMemoryRoomStore', () => {
  let store: InMemoryRoomStore;

  beforeEach(() => {
    store = new InMemoryRoomStore();
  });

  it('creates and retrieves a room by ID', () => {
    const room = makeRoom({ roomId: 'r1' });
    store.createRoom(room);
    expect(store.getRoom('r1')).toEqual(room);
  });

  it('returns undefined for a non-existent room ID', () => {
    expect(store.getRoom('does-not-exist')).toBeUndefined();
  });

  it('retrieves a room by code', () => {
    const room = makeRoom({ roomId: 'r1', roomCode: 'XYZ999' });
    store.createRoom(room);
    expect(store.getRoomByCode('XYZ999')).toEqual(room);
  });

  it('returns undefined for a non-existent room code', () => {
    expect(store.getRoomByCode('XXXXXX')).toBeUndefined();
  });

  it('updates room atomically via updater function', () => {
    const room = makeRoom({ roomId: 'r1', state: 'LOBBY' });
    store.createRoom(room);

    store.updateRoom('r1', (r) => ({ ...r, state: 'SCENARIO_PICK' }));

    const updated = store.getRoom('r1');
    expect(updated?.state).toBe('SCENARIO_PICK');
  });

  it('does nothing when updating a non-existent room', () => {
    // Should not throw
    expect(() => {
      store.updateRoom('does-not-exist', (r) => r);
    }).not.toThrow();
  });

  it('deletes a room', () => {
    const room = makeRoom({ roomId: 'r1' });
    store.createRoom(room);
    store.deleteRoom('r1');
    expect(store.getRoom('r1')).toBeUndefined();
  });

  it('returns all rooms', () => {
    const room1 = makeRoom({ roomId: 'r1', roomCode: 'AAA111' });
    const room2 = makeRoom({ roomId: 'r2', roomCode: 'BBB222' });
    store.createRoom(room1);
    store.createRoom(room2);

    const all = store.getAllRooms();
    expect(all).toHaveLength(2);
    const ids = all.map((r) => r.roomId);
    expect(ids).toContain('r1');
    expect(ids).toContain('r2');
  });

  it('returns empty array when no rooms exist', () => {
    expect(store.getAllRooms()).toHaveLength(0);
  });
});
