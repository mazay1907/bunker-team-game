/**
 * BUGFIX_STALE_STORE_ON_NEW_GAME — `enterRoom()` unit tests.
 *
 * Covers the contract from Reqs/BUGFIX_STALE_STORE_ON_NEW_GAME.md:
 * - Same room held (case-insensitive) → no-op, returns false.
 * - Different room held → full reset, returns true.
 * - No room held (null, e.g. fresh page load) → nothing to reset, returns true.
 * - Simulated LobbyPage-ordering scenario: a finished previous game's stale
 *   fields (gameEnded, ownCharacter, votes, etc.) must be fully cleared once a
 *   new room is entered, before any new-room store writes occur.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore.js';
import type { RoomView, PlayerView, CharacterCard } from '@bunker/shared';

function makeRoom(roomCode: string): RoomView {
  return {
    roomCode,
    state: 'LOBBY',
    currentPhase: null,
    currentRound: null,
    playerCount: 1,
    hostId: 'p1',
    scenario: null,
  } as unknown as RoomView;
}

function makePlayer(playerId: string): PlayerView {
  return {
    playerId,
    nickname: 'Test',
    isHost: true,
    status: 'ALIVE',
  } as unknown as PlayerView;
}

describe('useGameStore.enterRoom', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('returns false and does not reset when the same room (exact case) is already active', () => {
    useGameStore.getState().setRoom(makeRoom('ABCDEF'));
    useGameStore.getState().setGameEnded({
      reason: 'COMPLETED',
      survivors: [],
      eliminated: [],
      outcomeSummary: '',
    });

    const isNewRoom = useGameStore.getState().enterRoom('ABCDEF');

    expect(isNewRoom).toBe(false);
    // Stale field untouched — no reset fired for the same-room case.
    expect(useGameStore.getState().gameEnded).not.toBeNull();
  });

  it('returns false when the incoming roomCode differs only by case (case-insensitive match)', () => {
    useGameStore.getState().setRoom(makeRoom('ABCDEF'));

    const isNewRoom = useGameStore.getState().enterRoom('abcdef');

    expect(isNewRoom).toBe(false);
  });

  it('returns true and fully resets when a different room is held', () => {
    useGameStore.getState().setRoom(makeRoom('OLDROOM'));
    useGameStore.getState().setOwnCharacter({ traits: {} } as unknown as CharacterCard);
    useGameStore.getState().setGameEnded({
      reason: 'COMPLETED',
      survivors: [makePlayer('p1')],
      eliminated: [makePlayer('p2')],
      outcomeSummary: '',
    });
    useGameStore.getState().addVote({ voterId: 'p1', targetId: 'p2' } as never);
    useGameStore.getState().setVoteTally({ p2: 1 });
    useGameStore.getState().addRevealSubmitted('p1');
    useGameStore.getState().setDebateSpeakingOrder(['p1', 'p2'], 0);
    useGameStore.getState().setIsRevealed(true);
    useGameStore.getState().setSurvivalPrediction('will survive');

    const isNewRoom = useGameStore.getState().enterRoom('NEWROOM');

    expect(isNewRoom).toBe(true);

    const state = useGameStore.getState();
    expect(state.gameEnded).toBeNull();
    expect(state.ownCharacter).toBeNull();
    expect(state.game).toBeNull();
    expect(state.votes).toEqual([]);
    expect(state.voteTally).toEqual({});
    expect(state.revealSubmittedIds).toEqual([]);
    expect(state.debateSpeakingOrder).toEqual([]);
    expect(state.isRevealed).toBe(false);
    expect(state.survivalPrediction).toBeNull();
    expect(state.room).toBeNull();
  });

  it('returns true and does not throw when no room is held (fresh page load — nothing to reset)', () => {
    expect(useGameStore.getState().room).toBeNull();

    const isNewRoom = useGameStore.getState().enterRoom('ANYROOM');

    expect(isNewRoom).toBe(true);
    expect(useGameStore.getState().room).toBeNull();
  });

  it('simulates the LobbyPage mount-ordering scenario: stale finished-game state is cleared before the new room joins', () => {
    // Simulate tab T holding a finished previous game's state.
    useGameStore.getState().setRoom(makeRoom('PREVGAME'));
    useGameStore.getState().setOwnPlayer('p1', 'Host');
    useGameStore.getState().setGameEnded({
      reason: 'COMPLETED',
      survivors: [makePlayer('p1')],
      eliminated: [],
      outcomeSummary: '',
    });
    useGameStore.getState().setOwnCharacter({ traits: {} } as unknown as CharacterCard);

    // LobbyPage's mount effect calls enterRoom() as the unconditional first
    // statement, before registerSocketListeners() and before any conditional
    // early-return branch — simulated here directly against the store.
    const upperRoomCode = 'newgame'.toUpperCase();
    const isNewRoom = useGameStore.getState().enterRoom(upperRoomCode);
    expect(isNewRoom).toBe(true);

    // Only after enterRoom() runs does the new room's data get written.
    useGameStore.getState().setRoom(makeRoom(upperRoomCode));
    useGameStore.getState().setOwnPlayer('p2', 'NewPlayer');

    const state = useGameStore.getState();
    expect(state.gameEnded).toBeNull();
    expect(state.ownCharacter).toBeNull();
    expect(state.room?.roomCode).toBe('NEWGAME');
    expect(state.ownPlayerId).toBe('p2');
  });
});
