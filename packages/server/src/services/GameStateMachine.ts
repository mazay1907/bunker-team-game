/**
 * GameStateMachine — enforces the linear game state sequence.
 *
 * Sequence: LOBBY → SCENARIO_PICK → R1_REVEAL → R1_DEBATE → R1_VOTE →
 *           R2_REVEAL → R2_DEBATE → R2_VOTE →
 *           R3_REVEAL → R3_DEBATE → R3_VOTE → ENDED
 *
 * All transitions are server-authoritative. The client cannot drive transitions.
 * Emits phase:changed to all room members on every transition.
 */

import type { Server } from 'socket.io';
import type { Room, Round } from '@bunker/shared';
import { EVENTS, DEBATE_TIMER_SECONDS, REVEAL_QUOTAS } from '@bunker/shared';
import type { PhaseChangedPayload } from '@bunker/shared';
import type { IRoomStore } from '../store/RoomStore.js';

/** Ordered state sequence — index drives the advance() logic */
const STATE_SEQUENCE = [
  'LOBBY',
  'SCENARIO_PICK',
  'R1_REVEAL',
  'R1_DEBATE',
  'R1_VOTE',
  'R2_REVEAL',
  'R2_DEBATE',
  'R2_VOTE',
  'R3_REVEAL',
  'R3_DEBATE',
  'R3_VOTE',
  'ENDED',
] as const;

/** Map state name → round number (null for non-round states) */
const STATE_TO_ROUND: Record<string, 1 | 2 | 3 | null> = {
  LOBBY: null,
  SCENARIO_PICK: null,
  R1_REVEAL: 1, R1_DEBATE: 1, R1_VOTE: 1,
  R2_REVEAL: 2, R2_DEBATE: 2, R2_VOTE: 2,
  R3_REVEAL: 3, R3_DEBATE: 3, R3_VOTE: 3,
  ENDED: null,
};

/** Map state name → phase string (null for non-phase states) */
const STATE_TO_PHASE: Record<string, 'REVEAL' | 'DEBATE' | 'VOTE' | null> = {
  LOBBY: null, SCENARIO_PICK: null, ENDED: null,
  R1_REVEAL: 'REVEAL', R2_REVEAL: 'REVEAL', R3_REVEAL: 'REVEAL',
  R1_DEBATE: 'DEBATE', R2_DEBATE: 'DEBATE', R3_DEBATE: 'DEBATE',
  R1_VOTE: 'VOTE', R2_VOTE: 'VOTE', R3_VOTE: 'VOTE',
};

export class GameStateMachine {
  constructor(
    private readonly roomStore: IRoomStore,
    private readonly io: Server,
  ) {}

  /**
   * Advances room to the next state in the sequence.
   * Returns the new state string.
   */
  advance(roomId: string): Room['state'] {
    const room = this.roomStore.getRoom(roomId);
    if (!room) throw new Error(`Room not found: ${roomId}`);

    const currentIndex = STATE_SEQUENCE.indexOf(room.state as typeof STATE_SEQUENCE[number]);
    if (currentIndex === -1 || currentIndex >= STATE_SEQUENCE.length - 1) {
      throw new Error(`Cannot advance from state: ${room.state}`);
    }

    const nextState = STATE_SEQUENCE[currentIndex + 1];
    if (!nextState) throw new Error(`No next state after: ${room.state}`);

    return this.transitionTo(roomId, nextState);
  }

  /**
   * Transitions room to a specific state.
   * Used for direct jumps (e.g., ENDED after host force-end).
   */
  transitionTo(roomId: string, nextState: Room['state']): Room['state'] {
    const room = this.roomStore.getRoom(roomId);
    if (!room) throw new Error(`Room not found: ${roomId}`);

    const round = STATE_TO_ROUND[nextState] ?? null;
    const phase = STATE_TO_PHASE[nextState] ?? null;

    this.roomStore.updateRoom(roomId, (r) => {
      r.state = nextState;
      r.currentRound = round;
      r.currentPhase = phase;
      r.lastActivityAt = new Date();
      return r;
    });

    const revealQuota = round !== null ? REVEAL_QUOTAS[round] : null;
    const timerSeconds = phase === 'DEBATE' ? DEBATE_TIMER_SECONDS : null;

    const payload: PhaseChangedPayload = {
      state: nextState,
      round,
      phase,
      revealQuota,
      timerSeconds,
    };

    this.io.to(roomId).emit(EVENTS.PHASE_CHANGED, payload);
    return nextState;
  }

  /**
   * Creates pre-allocated rounds array for a new game.
   */
  createRounds(): [Round, Round, Round] {
    const makeRound = (n: 1 | 2 | 3): Round => ({
      roundNumber: n,
      revealQuota: REVEAL_QUOTAS[n],
      revealSubmissions: new Map(),
      votes: new Map(),
      tiebreakVotes: null,
      eliminatedPlayerId: null,
      autoEliminationTriggered: false,
    });
    return [makeRound(1), makeRound(2), makeRound(3)];
  }
}
