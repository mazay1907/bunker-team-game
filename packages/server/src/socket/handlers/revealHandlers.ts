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
  DEBATE_TIMER_SECONDS,
  REVEAL_QUOTAS,
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
      const submission: RevealSubmission = {
        playerId,
        revealedCategories: categories,
        submittedAt: now,
      };

      // Update player character + room state
      roomStore.updateRoom(room.roomId, (r) => {
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

        const roundData = r.game?.rounds[room.currentRound! - 1];
        if (roundData) roundData.revealSubmissions.set(playerId, submission);

        r.lastActivityAt = now;
        return r;
      });

      // Count remaining players who haven't submitted
      const updatedRoom = roomStore.getRoom(room.roomId)!;
      const updatedRound = updatedRoom.game?.rounds[room.currentRound - 1]!;
      const activePlayers = [...updatedRoom.players.values()].filter(
        (p) => p.status === 'ACTIVE' || p.status === 'RECONNECTING',
      );
      const waitingFor = activePlayers.filter(
        (p) => !updatedRound.revealSubmissions.has(p.playerId),
      ).length;

      const updatedPlayer = updatedRoom.players.get(playerId)!;
      const revealedTraits = Object.values(updatedPlayer.character?.traits ?? {}).filter(
        (t) => categories.includes(t.category),
      );

      const updatePayload: RevealUpdatePayload = {
        playerId,
        revealedTraits,
        waitingFor,
      };
      io.to(room.roomId).emit(EVENTS.REVEAL_UPDATE, updatePayload);

      ack({ ok: true });

      // Advance to DEBATE when everyone has submitted
      if (waitingFor === 0) {
        const debateState = room.currentRound === 1
          ? 'R1_DEBATE'
          : room.currentRound === 2
            ? 'R2_DEBATE'
            : 'R3_DEBATE';
        gsm.transitionTo(room.roomId, debateState);

        timerService.startDebateTimer(room.roomId, DEBATE_TIMER_SECONDS, () => {
          const r = roomStore.getRoom(room.roomId);
          if (!r || r.currentPhase !== 'DEBATE') return;
          const voteState = room.currentRound === 1
            ? 'R1_VOTE'
            : room.currentRound === 2
              ? 'R2_VOTE'
              : 'R3_VOTE';
          gsm.transitionTo(room.roomId, voteState);
        });
      }
    },
  );
}
