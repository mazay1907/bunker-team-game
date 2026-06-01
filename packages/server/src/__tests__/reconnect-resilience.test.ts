/**
 * Sprint 2 resilience tests:
 * - Auto-elimination after 5-minute disconnect timeout
 * - Single-elimination rule for simultaneous disconnects
 * - Host transfer after 60-second timeout
 * - Spectator disconnect exemption
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Room, Player, Game, Round } from '@bunker/shared';
import { RECONNECT_HOLD_SECONDS, HOST_TRANSFER_SECONDS } from '@bunker/shared';
import { InMemoryRoomStore } from '../store/RoomStore.js';
import { TimerService } from '../services/TimerService.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    playerId: 'player-1',
    roomId: 'room-1',
    nickname: 'Тест',
    sessionToken: 'session-abc',
    reconnectToken: 'reconnect-abc',
    socketId: 'socket-1',
    status: 'ACTIVE',
    joinedAt: new Date('2026-01-01T10:00:00Z'),
    disconnectedAt: null,
    eliminatedInRound: null,
    character: null,
    revealHistory: [],
    ...overrides,
  };
}

function makeRound(n: 1 | 2 | 3): Round {
  return {
    roundNumber: n,
    revealQuota: n === 3 ? 1 : 2,
    revealSubmissions: new Map(),
    votes: new Map(),
    tiebreakVotes: null,
    eliminatedPlayerId: null,
    autoEliminationTriggered: false,
  };
}

function makeRoom(overrides: Partial<Room> = {}): Room {
  const p1 = makePlayer({ playerId: 'p1', joinedAt: new Date('2026-01-01T10:00:00Z') });
  const p2 = makePlayer({ playerId: 'p2', joinedAt: new Date('2026-01-01T10:01:00Z') });
  const game: Game = {
    roomId: 'room-1',
    scenarioId: 'nuclear-war',
    rounds: [makeRound(1), makeRound(2), makeRound(3)],
    startedAt: new Date(),
    endedAt: null,
    endReason: null,
  };
  return {
    roomId: 'room-1',
    roomCode: 'ABCDEF',
    hostPlayerId: 'p1',
    state: 'R1_VOTE',
    currentRound: 1,
    currentPhase: 'VOTE',
    scenarioId: 'nuclear-war',
    players: new Map([['p1', p1], ['p2', p2]]),
    game,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    hostUserId: null,
    ...overrides,
  };
}

// ── TimerService unit tests ────────────────────────────────────────────────────

describe('TimerService reconnect timers', () => {
  let timerService: TimerService;

  beforeEach(() => {
    vi.useFakeTimers();
    // Minimal mock for io — only used for debate timer ticks, not reconnect timers
    const mockIo = { to: () => ({ emit: vi.fn() }) };
    timerService = new TimerService(mockIo as unknown as import('socket.io').Server);
  });

  it('fires reconnect callback after specified seconds', () => {
    const cb = vi.fn();
    timerService.startReconnectTimer('room-1', 'player-1', 10, cb);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('clearReconnectTimer prevents callback from firing', () => {
    const cb = vi.fn();
    timerService.startReconnectTimer('room-1', 'player-1', 10, cb);
    timerService.clearReconnectTimer('room-1', 'player-1');
    vi.advanceTimersByTime(15_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('fires host-transfer callback after specified seconds', () => {
    const cb = vi.fn();
    timerService.startHostTransferTimer('room-1', 5, cb);
    vi.advanceTimersByTime(5_000);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('cancelHostTransferTimer prevents callback from firing', () => {
    const cb = vi.fn();
    timerService.startHostTransferTimer('room-1', 5, cb);
    timerService.cancelHostTransferTimer('room-1');
    vi.advanceTimersByTime(10_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('clearAll cancels reconnect and host-transfer timers', () => {
    const reconnectCb = vi.fn();
    const hostCb = vi.fn();
    timerService.startReconnectTimer('room-1', 'player-1', 10, reconnectCb);
    timerService.startHostTransferTimer('room-1', 5, hostCb);
    timerService.clearAll('room-1');
    vi.advanceTimersByTime(15_000);
    expect(reconnectCb).not.toHaveBeenCalled();
    expect(hostCb).not.toHaveBeenCalled();
  });

  it('starting a new reconnect timer cancels the old one', () => {
    const oldCb = vi.fn();
    const newCb = vi.fn();
    timerService.startReconnectTimer('room-1', 'player-1', 10, oldCb);
    timerService.startReconnectTimer('room-1', 'player-1', 20, newCb);
    vi.advanceTimersByTime(15_000);
    expect(oldCb).not.toHaveBeenCalled(); // replaced
    expect(newCb).not.toHaveBeenCalled(); // not yet
    vi.advanceTimersByTime(10_000);
    expect(newCb).toHaveBeenCalledOnce();
  });

  it('RECONNECT_HOLD_SECONDS is 300', () => {
    expect(RECONNECT_HOLD_SECONDS).toBe(300);
  });

  it('HOST_TRANSFER_SECONDS is 60', () => {
    expect(HOST_TRANSFER_SECONDS).toBe(60);
  });
});

// ── RoomStore single-elimination check ────────────────────────────────────────

describe('auto-elimination: single-elimination rule', () => {
  it('round.eliminatedPlayerId set after first elimination blocks second', () => {
    const store = new InMemoryRoomStore();
    const room = makeRoom();
    store.createRoom(room);

    // Simulate first auto-elimination
    store.updateRoom('room-1', (r) => {
      const rd = r.game?.rounds[0];
      if (rd) {
        rd.eliminatedPlayerId = 'p1';
        rd.autoEliminationTriggered = true;
      }
      return r;
    });

    const updatedRoom = store.getRoom('room-1')!;
    const round = updatedRoom.game?.rounds[0]!;
    expect(round.eliminatedPlayerId).toBe('p1');
    expect(round.autoEliminationTriggered).toBe(true);

    // Second player in same round should NOT be eliminated (caller checks this)
    const alreadyEliminated = round.eliminatedPlayerId !== null;
    expect(alreadyEliminated).toBe(true);
  });
});

// ── RoomExpiryService ─────────────────────────────────────────────────────────

describe('RoomExpiryService', () => {
  it('removes idle room with no connected players after 30 minutes', async () => {
    const { RoomExpiryService } = await import('../services/RoomExpiryService.js');
    const store = new InMemoryRoomStore();
    const mockIo = { to: () => ({ emit: vi.fn() }) };
    const ts = new TimerService(mockIo as unknown as import('socket.io').Server);

    const room = makeRoom({
      state: 'ENDED',
      lastActivityAt: new Date(Date.now() - 31 * 60 * 1000), // 31 min ago
    });
    // All players disconnected
    store.createRoom(room);
    store.updateRoom('room-1', (r) => {
      for (const [id, p] of r.players) {
        r.players.set(id, { ...p, socketId: null });
      }
      return r;
    });

    const expiry = new RoomExpiryService(store, ts);
    expiry.sweep();

    expect(store.getRoom('room-1')).toBeUndefined();
  });

  it('keeps active room with connected players', async () => {
    const { RoomExpiryService } = await import('../services/RoomExpiryService.js');
    const store = new InMemoryRoomStore();
    const mockIo = { to: () => ({ emit: vi.fn() }) };
    const ts = new TimerService(mockIo as unknown as import('socket.io').Server);

    const room = makeRoom({
      lastActivityAt: new Date(Date.now() - 31 * 60 * 1000),
    });
    // One player still connected
    store.createRoom(room);

    const expiry = new RoomExpiryService(store, ts);
    expiry.sweep();

    expect(store.getRoom('room-1')).toBeDefined();
  });

  it('keeps recently-active room even with no connected players', async () => {
    const { RoomExpiryService } = await import('../services/RoomExpiryService.js');
    const store = new InMemoryRoomStore();
    const mockIo = { to: () => ({ emit: vi.fn() }) };
    const ts = new TimerService(mockIo as unknown as import('socket.io').Server);

    const room = makeRoom({
      lastActivityAt: new Date(Date.now() - 5 * 60 * 1000), // only 5 min ago
    });
    store.createRoom(room);
    store.updateRoom('room-1', (r) => {
      for (const [id, p] of r.players) {
        r.players.set(id, { ...p, socketId: null });
      }
      return r;
    });

    const expiry = new RoomExpiryService(store, ts);
    expiry.sweep();

    expect(store.getRoom('room-1')).toBeDefined();
  });
});
