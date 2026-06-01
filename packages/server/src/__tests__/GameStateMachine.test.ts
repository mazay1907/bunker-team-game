/**
 * Unit tests for GameStateMachine.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Server } from 'socket.io';
import { GameStateMachine } from '../services/GameStateMachine.js';
import { InMemoryRoomStore } from '../store/RoomStore.js';
import { InMemorySessionStore } from '../store/SessionStore.js';
import { InMemoryReconnectStore } from '../store/ReconnectStore.js';
import { RoomManager } from '../services/RoomManager.js';

function makeIoMock(): Server {
  return {
    to: vi.fn().mockReturnValue({ emit: vi.fn() }),
  } as unknown as Server;
}

function makeRoom(manager: RoomManager) {
  const result = manager.createRoom('TestHost');
  return result;
}

describe('GameStateMachine', () => {
  let roomStore: InMemoryRoomStore;
  let manager: RoomManager;
  let gsm: GameStateMachine;
  let io: Server;

  beforeEach(() => {
    roomStore = new InMemoryRoomStore();
    const sessionStore = new InMemorySessionStore();
    const reconnectStore = new InMemoryReconnectStore();
    manager = new RoomManager(roomStore, sessionStore, reconnectStore);
    io = makeIoMock();
    gsm = new GameStateMachine(roomStore, io);
  });

  describe('advance', () => {
    it('advances LOBBY → SCENARIO_PICK', () => {
      const { roomId } = makeRoom(manager);
      const next = gsm.advance(roomId);
      expect(next).toBe('SCENARIO_PICK');
    });

    it('advances SCENARIO_PICK → R1_REVEAL', () => {
      const { roomId } = makeRoom(manager);
      gsm.advance(roomId); // LOBBY → SCENARIO_PICK
      const next = gsm.advance(roomId);
      expect(next).toBe('R1_REVEAL');
    });

    it('sets currentRound and currentPhase correctly', () => {
      const { roomId } = makeRoom(manager);
      gsm.advance(roomId); // LOBBY → SCENARIO_PICK
      gsm.advance(roomId); // → R1_REVEAL
      const room = roomStore.getRoom(roomId)!;
      expect(room.currentRound).toBe(1);
      expect(room.currentPhase).toBe('REVEAL');
    });

    it('advances through the full sequence to ENDED', () => {
      const { roomId } = makeRoom(manager);
      const sequence = [
        'SCENARIO_PICK', 'R1_REVEAL', 'R1_DEBATE', 'R1_VOTE',
        'R2_REVEAL', 'R2_DEBATE', 'R2_VOTE',
        'R3_REVEAL', 'R3_DEBATE', 'R3_VOTE', 'ENDED',
      ];
      for (const expectedState of sequence) {
        const next = gsm.advance(roomId);
        expect(next).toBe(expectedState);
      }
    });

    it('throws when advancing from ENDED', () => {
      const { roomId } = makeRoom(manager);
      roomStore.updateRoom(roomId, (r) => { r.state = 'ENDED'; return r; });
      expect(() => gsm.advance(roomId)).toThrow();
    });
  });

  describe('transitionTo', () => {
    it('jumps directly to a specific state', () => {
      const { roomId } = makeRoom(manager);
      gsm.transitionTo(roomId, 'R2_VOTE');
      const room = roomStore.getRoom(roomId)!;
      expect(room.state).toBe('R2_VOTE');
      expect(room.currentRound).toBe(2);
      expect(room.currentPhase).toBe('VOTE');
    });

    it('emits phase:changed event via io', () => {
      const { roomId } = makeRoom(manager);
      const emitMock = vi.fn();
      (io.to as ReturnType<typeof vi.fn>).mockReturnValue({ emit: emitMock });
      gsm.transitionTo(roomId, 'R1_REVEAL');
      expect(emitMock).toHaveBeenCalledWith('phase:changed', expect.objectContaining({
        state: 'R1_REVEAL',
        round: 1,
        phase: 'REVEAL',
        revealQuota: 2,
      }));
    });
  });

  describe('createRounds', () => {
    it('creates exactly 3 rounds', () => {
      const rounds = gsm.createRounds();
      expect(rounds).toHaveLength(3);
    });

    it('sets correct reveal quotas', () => {
      const rounds = gsm.createRounds();
      expect(rounds[0].revealQuota).toBe(2);
      expect(rounds[1].revealQuota).toBe(2);
      expect(rounds[2].revealQuota).toBe(1);
    });

    it('initializes empty submissions and votes', () => {
      const rounds = gsm.createRounds();
      for (const round of rounds) {
        expect(round.revealSubmissions.size).toBe(0);
        expect(round.votes.size).toBe(0);
        expect(round.tiebreakVotes).toBeNull();
        expect(round.eliminatedPlayerId).toBeNull();
      }
    });
  });
});
