/**
 * Socket.IO handler for reveal:submit.
 *
 * Rolling reveal: each submission is broadcast immediately to all room members.
 * Phase advances to DEBATE when all active players have submitted.
 *
 * Validation (server-authoritative):
 * 1. Game must be in a REVEAL phase
 * 2. Player must not have already submitted this round
 * 3. Exactly {quota} categories must be selected
 * 4. None of the selected categories can already be revealed
 */

import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import {
  EVENTS,
  TRAIT_CATEGORIES,
  REVEAL_QUOTAS,
  REVEAL_TIMEOUT_SECONDS,
} from '@bunker/shared';
import type {
  RevealSubmitPayload,
  RevealSubmitAck,
  RevealUpdatePayload,
  RevealSubmission,
  TraitCategory,
} from '@bunker/shared';
import type { IRoomStore } from '../../store/RoomStore.js';
import type { RoomManager } from '../../services/RoomManager.js';
import type { GameStateMachine } from '../../services/GameStateMachine.js';
import type { TimerService } from '../../services/TimerService.js';
import { pickRandomUnrevealed, getPlayersWhoHaveNotSubmitted } from '../../services/RevealAutoSelect.js';

interface RevealHandlerDeps {
  io: Server;
  roomStore: IRoomStore;
  roomManager: RoomManager;
  gsm: GameStateMachine;
  timerService: TimerService;
}

const revealSubmitSchema = z.object({
  categories: z
    .array(z.enum(TRAIT_CATEGORIES as [TraitCategory, ...TraitCategory[]]))
    .min(1)
    .max(7),
});

export function registerRevealHandlers(socket: Socket, deps: RevealHandlerDeps): void {
  const { io, roomStore, roomManager, gsm, timerService } = deps;

  socket.on(
    EVENTS.REVEAL_SUBMIT,
    (raw: unknown, ack: (r: RevealSubmitAck) => void) => {
      const playerId: string | undefined = socket.data.playerId;
      if (!playerId) return ack({ ok: false, error: 'WRONG_PHASE' });

      const found = roomManager.findPlayerById(playerId);
      if (!found) return ack({ ok: false, error: 'WRONG_PHASE' });

      const { room, player } = found;

      // Validate game phase
      if (room.currentPhase !== 'REVEAL' || room.currentRound === null) {
        return ack({ ok: false, error: 'WRONG_PHASE' });
      }

      const round = room.game?.rounds[room.currentRound - 1];
      if (!round) return ack({ ok: false, error: 'WRONG_PHASE' });

      // Already submitted?
      if (round.revealSubmissions.has(playerId)) {
        return ack({ ok: false, error: 'ALREADY_SUBMITTED' });
      }

      // Parse and validate payload
      const parsed = revealSubmitSchema.safeParse(raw);
      if (!parsed.success) return ack({ ok: false, error: 'WRONG_COUNT' });

      const { categories } = parsed.data as RevealSubmitPayload;
      const quota = REVEAL_QUOTAS[room.currentRound];

      if (categories.length !== quota) return ack({ ok: false, error: 'WRONG_COUNT' });

      // Check for duplicates in selection
      const uniqueCats = new Set(categories);
      if (uniqueCats.size !== categories.length) return ack({ ok: false, error: 'WRONG_COUNT' });

      // Check that none are already revealed
      if (!player.character) return ack({ ok: false, error: 'WRONG_PHASE' });
      for (const cat of categories) {
        if (player.character.traits[cat]?.isRevealed) {
          return ack({ ok: false, error: 'ALREADY_REVEALED' });
        }
      }

      const now = new Date();
      persistReveal(room.roomId, playerId, categories, room.currentRound, now);

      // Count remaining players who haven't submitted
      const updatedRoom = roomStore.getRoom(room.roomId)!;
      const updatedRound = updatedRoom.game?.rounds[room.currentRound - 1]!;
      const activePlayers = [...updatedRoom.players.values()].filter(
        (p) => p.status === 'ACTIVE' || p.status === 'RECONNECTING',
      );
      const waitingFor = activePlayers.filter(
        (p) => !updatedRound.revealSubmissions.has(p.playerId),
      ).length;

      // Blind reveal: emit submission notice (no traits) until everyone is done
      const blindPayload: RevealUpdatePayload = {
        playerId,
        revealedTraits: [],
        waitingFor,
        isFinal: false,
      };
      io.to(room.roomId).emit(EVENTS.REVEAL_UPDATE, blindPayload);

      ack({ ok: true });

      advanceIfAllSubmitted(room.roomId, room.currentRound, waitingFor);
    },
  );

  /**
   * Persists a reveal submission for one player.
   * Marks the selected trait slots as revealed in the player's character card.
   */
  function persistReveal(
    roomId: string,
    playerId: string,
    categories: TraitCategory[],
    roundNumber: 1 | 2 | 3,
    now: Date,
  ): void {
    const submission: RevealSubmission = {
      playerId,
      revealedCategories: categories,
      submittedAt: now,
    };
    roomStore.updateRoom(roomId, (r) => {
      const p = r.players.get(playerId);
      if (!p?.character) return r;
      const updatedTraits = { ...p.character.traits };
      for (const cat of categories) {
        updatedTraits[cat] = { ...updatedTraits[cat], isRevealed: true };
      }
      r.players.set(playerId, {
        ...p,
        character: { ...p.character, traits: updatedTraits },
        revealHistory: [...p.revealHistory, submission],
      });
      const roundData = r.game?.rounds[roundNumber - 1];
      if (roundData) roundData.revealSubmissions.set(playerId, submission);
      r.lastActivityAt = now;
      return r;
    });
  }

  /**
   * Advances to DEBATE when all active players have submitted.
   * Clears the reveal timer — it's no longer needed.
   */
  function advanceIfAllSubmitted(
    roomId: string,
    roundNumber: 1 | 2 | 3,
    waitingFor: number,
  ): void {
    if (waitingFor !== 0) return;

    timerService.clearRevealTimer(roomId);

    // All submitted — now reveal all traits at once (blind reveal)
    emitFinalReveals(roomId, roundNumber);

    const debateState = roundNumber === 1
      ? 'R1_DEBATE'
      : roundNumber === 2
        ? 'R2_DEBATE'
        : 'R3_DEBATE';
    gsm.transitionTo(roomId, debateState);
    // Debate timer starts manually via host:startDebateTimer — no auto-start here
  }

  /** Emit one final REVEAL_UPDATE per player so all traits become visible simultaneously. */
  function emitFinalReveals(roomId: string, roundNumber: 1 | 2 | 3): void {
    const room = roomStore.getRoom(roomId);
    if (!room) return;
    const round = room.game?.rounds[roundNumber - 1];
    if (!round) return;

    for (const [pid, submission] of round.revealSubmissions.entries()) {
      const player = room.players.get(pid);
      if (!player?.character) continue;
      const revealedTraits = submission.revealedCategories
        .map((cat) => player.character!.traits[cat])
        .filter((s): s is typeof s & NonNullable<typeof s> => s !== undefined);

      const finalPayload: RevealUpdatePayload = {
        playerId: pid,
        revealedTraits,
        waitingFor: 0,
        isFinal: true,
      };
      io.to(roomId).emit(EVENTS.REVEAL_UPDATE, finalPayload);
    }
  }
}

/**
 * Starts the reveal timeout for a room entering a REVEAL phase.
 * On timeout: auto-submits random unrevealed categories for each player
 * who has not submitted yet, then advances to DEBATE.
 *
 * Called externally from hostHandlers (R1_REVEAL) and voteHandlers (R2/R3_REVEAL).
 */
export function startRevealPhaseTimer(
  roomId: string,
  roundNumber: 1 | 2 | 3,
  deps: RevealHandlerDeps,
): void {
  const { io, roomStore, gsm, timerService } = deps;

  timerService.startRevealTimer(roomId, REVEAL_TIMEOUT_SECONDS, () => {
    autoSubmitPendingReveals(roomId, roundNumber, { io, roomStore, gsm, timerService });
  });
}

/**
 * Auto-submits random reveal selections for all players who haven't submitted yet.
 * Emits reveal:update for each, then advances to DEBATE.
 * Idempotent — if room is no longer in REVEAL phase, exits early.
 */
function autoSubmitPendingReveals(
  roomId: string,
  roundNumber: 1 | 2 | 3,
  deps: Pick<RevealHandlerDeps, 'io' | 'roomStore' | 'gsm' | 'timerService'>,
): void {
  const { io, roomStore, gsm, timerService } = deps;
  const room = roomStore.getRoom(roomId);
  if (!room || room.currentPhase !== 'REVEAL' || room.currentRound !== roundNumber) return;

  const round = room.game?.rounds[roundNumber - 1];
  if (!round) return;

  const quota = REVEAL_QUOTAS[roundNumber];
  const allPlayers = [...room.players.values()];
  const pending = getPlayersWhoHaveNotSubmitted(
    allPlayers,
    new Set(round.revealSubmissions.keys()),
  );

  const now = new Date();

  for (const player of pending) {
    const categories = pickRandomUnrevealed(player, quota);
    if (categories.length === 0) continue;

    // Persist the auto-selected reveal
    roomStore.updateRoom(roomId, (r) => {
      const p = r.players.get(player.playerId);
      if (!p?.character) return r;
      const updatedTraits = { ...p.character.traits };
      for (const cat of categories) {
        updatedTraits[cat] = { ...updatedTraits[cat], isRevealed: true };
      }
      const submission: RevealSubmission = {
        playerId: player.playerId,
        revealedCategories: categories,
        submittedAt: now,
      };
      r.players.set(player.playerId, {
        ...p,
        character: { ...p.character, traits: updatedTraits },
        revealHistory: [...p.revealHistory, submission],
      });
      const rd = r.game?.rounds[roundNumber - 1];
      if (rd) rd.revealSubmissions.set(player.playerId, submission);
      r.lastActivityAt = now;
      return r;
    });

  }

  // All auto-submissions done — emit final batch for ALL players in this round
  const finalRoom = roomStore.getRoom(roomId);
  if (!finalRoom) return;
  const finalRound = finalRoom.game?.rounds[roundNumber - 1];
  if (!finalRound) return;
  for (const [pid, submission] of finalRound.revealSubmissions.entries()) {
    const p = finalRoom.players.get(pid);
    if (!p?.character) continue;
    const revealedTraits = submission.revealedCategories
      .map((cat) => p.character!.traits[cat])
      .filter((s): s is typeof s & NonNullable<typeof s> => s !== undefined);
    const finalPayload: RevealUpdatePayload = {
      playerId: pid,
      revealedTraits,
      waitingFor: 0,
      isFinal: true,
    };
    io.to(roomId).emit(EVENTS.REVEAL_UPDATE, finalPayload);
  }

  // Advance to DEBATE — timer starts manually via host:startDebateTimer
  const debateState = roundNumber === 1
    ? 'R1_DEBATE'
    : roundNumber === 2
      ? 'R2_DEBATE'
      : 'R3_DEBATE';
  gsm.transitionTo(roomId, debateState);
}
