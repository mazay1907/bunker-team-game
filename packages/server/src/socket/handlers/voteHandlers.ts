/**
 * Socket.IO handler for vote:submit and vote:tiebreaker flow.
 *
 * Open voting: each submitted vote is broadcast immediately (vote:update).
 * Completion: when all active players have voted, tally and resolve.
 *
 * Tie resolution (per GAME_RULES.md):
 * 1. Re-vote between tied players (all active players vote again)
 * 2. If still tied → host (or longest-connected) casts deciding vote
 * 3. Winner is eliminated; card fully revealed; game advances
 */

import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { EVENTS } from '@bunker/shared';
import type {
  VoteSubmitPayload,
  VoteSubmitAck,
  VoteUpdatePayload,
  VoteRecord,
  VoteTiebreakerPayload,
  PlayerEliminatedPayload,
} from '@bunker/shared';
import type { IRoomStore } from '../../store/RoomStore.js';
import type { RoomManager } from '../../services/RoomManager.js';
import type { GameStateMachine } from '../../services/GameStateMachine.js';
import type { VoteEngine } from '../../services/VoteEngine.js';

interface VoteHandlerDeps {
  io: Server;
  roomStore: IRoomStore;
  roomManager: RoomManager;
  gsm: GameStateMachine;
  voteEngine: VoteEngine;
}

const voteSubmitSchema = z.object({ targetId: z.string().uuid() });

export function registerVoteHandlers(socket: Socket, deps: VoteHandlerDeps): void {
  const { io, roomStore, roomManager, gsm, voteEngine } = deps;

  socket.on(
    EVENTS.VOTE_SUBMIT,
    (raw: unknown, ack: (r: VoteSubmitAck) => void) => {
      const playerId: string | undefined = socket.data.playerId;
      if (!playerId) return ack({ ok: false, error: 'WRONG_PHASE' });

      const found = roomManager.findPlayerById(playerId);
      if (!found) return ack({ ok: false, error: 'WRONG_PHASE' });
      const { room, player } = found;

      if (room.currentPhase !== 'VOTE' || room.currentRound === null) {
        return ack({ ok: false, error: 'WRONG_PHASE' });
      }

      // Spectators cannot vote
      if (player.status === 'SPECTATOR' || player.status === 'KICKED') {
        return ack({ ok: false, error: 'WRONG_PHASE' });
      }

      const round = room.game?.rounds[room.currentRound - 1];
      if (!round) return ack({ ok: false, error: 'WRONG_PHASE' });

      const parsed = voteSubmitSchema.safeParse(raw);
      if (!parsed.success) return ack({ ok: false, error: 'INVALID_TARGET' });

      const { targetId } = parsed.data as VoteSubmitPayload;

      // Determine if this is a tiebreak vote
      const isTiebreak = round.tiebreakVotes !== null;
      const tiedIds = isTiebreak
        ? [...(round.tiebreakVotes!.values())].map((v) => v.targetId)
        : undefined;
      const allowedIds = isTiebreak
        ? [...new Set(tiedIds)]
        : undefined;

      // Validate self-vote
      if (targetId === playerId) return ack({ ok: false, error: 'SELF_VOTE' });

      // Validate already voted (different Map for tiebreak)
      const activeVotes = isTiebreak ? round.tiebreakVotes! : round.votes;
      if (activeVotes.has(playerId)) return ack({ ok: false, error: 'ALREADY_VOTED' });

      // Validate target is eligible
      if (!voteEngine.isValidVoteTarget(playerId, targetId, room, allowedIds)) {
        return ack({ ok: false, error: 'INVALID_TARGET' });
      }

      const now = new Date();
      const record: VoteRecord = {
        voterId: playerId,
        targetId,
        submittedAt: now,
        isAbstention: false,
      };

      // Persist vote
      roomStore.updateRoom(room.roomId, (r) => {
        const rd = r.game?.rounds[room.currentRound! - 1];
        if (!rd) return r;
        if (isTiebreak) {
          rd.tiebreakVotes ??= new Map();
          rd.tiebreakVotes.set(playerId, record);
        } else {
          rd.votes.set(playerId, record);
        }
        r.lastActivityAt = now;
        return r;
      });

      // Build tally and broadcast
      const updatedRoom = roomStore.getRoom(room.roomId)!;
      const updatedRound = updatedRoom.game!.rounds[room.currentRound - 1]!;
      const currentVotes = isTiebreak ? updatedRound.tiebreakVotes! : updatedRound.votes;
      const { tally } = voteEngine.tally(currentVotes);

      const updatePayload: VoteUpdatePayload = { voterId: playerId, targetId, tally };
      io.to(room.roomId).emit(EVENTS.VOTE_UPDATE, updatePayload);

      ack({ ok: true });

      // Check completion
      checkVoteCompletion(room.roomId, room.currentRound);
    },
  );

  function checkVoteCompletion(roomId: string, roundNumber: 1 | 2 | 3): void {
    const room = roomStore.getRoom(roomId);
    if (!room || room.currentPhase !== 'VOTE') return;

    const round = room.game?.rounds[roundNumber - 1];
    if (!round) return;

    const isTiebreak = round.tiebreakVotes !== null;
    const currentVotes = isTiebreak ? round.tiebreakVotes! : round.votes;

    const activePlayers = [...room.players.values()].filter(
      (p) => p.status === 'ACTIVE' || p.status === 'RECONNECTING',
    );
    const allVoted = activePlayers.every((p) => currentVotes.has(p.playerId));
    if (!allVoted) return;

    const { leaders, tally } = voteEngine.tally(currentVotes);

    if (leaders.length === 1) {
      // Clear winner
      eliminatePlayer(roomId, leaders[0]!, roundNumber, 'VOTE');
    } else if (!isTiebreak) {
      // First tie — start tiebreak re-vote
      roomStore.updateRoom(roomId, (r) => {
        const rd = r.game?.rounds[roundNumber - 1];
        if (rd) rd.tiebreakVotes = new Map();
        return r;
      });

      const deciderId = voteEngine.getTiebreakerDecider(room);
      const tiebreakerPayload: VoteTiebreakerPayload = {
        tiedPlayerIds: leaders,
        isHostDeciding: false,
        decidingPlayerId: null,
      };
      io.to(roomId).emit(EVENTS.VOTE_TIEBREAKER, tiebreakerPayload);
    } else {
      // Tiebreak also tied — host decides
      const deciderId = voteEngine.getTiebreakerDecider(room);
      const tiebreakerPayload: VoteTiebreakerPayload = {
        tiedPlayerIds: leaders,
        isHostDeciding: true,
        decidingPlayerId: deciderId,
      };
      io.to(roomId).emit(EVENTS.VOTE_TIEBREAKER, tiebreakerPayload);

      // Reset tiebreak votes to let decider cast the final vote
      roomStore.updateRoom(roomId, (r) => {
        const rd = r.game?.rounds[roundNumber - 1];
        if (rd) rd.tiebreakVotes = new Map();
        return r;
      });
    }
  }

  function eliminatePlayer(
    roomId: string,
    eliminatedId: string,
    roundNumber: 1 | 2 | 3,
    reason: 'VOTE' | 'AUTO_TIMEOUT',
  ): void {
    // Reveal full character card
    roomStore.updateRoom(roomId, (r) => {
      const p = r.players.get(eliminatedId);
      if (!p?.character) return r;
      const traits = { ...p.character.traits };
      for (const cat of Object.keys(traits) as Array<keyof typeof traits>) {
        traits[cat] = { ...traits[cat], isRevealed: true };
      }
      r.players.set(eliminatedId, {
        ...p,
        status: 'SPECTATOR',
        eliminatedInRound: roundNumber,
        character: { ...p.character, traits },
      });
      const rd = r.game?.rounds[roundNumber - 1];
      if (rd) rd.eliminatedPlayerId = eliminatedId;
      r.lastActivityAt = new Date();
      return r;
    });

    const updatedRoom = roomStore.getRoom(roomId)!;
    const eliminatedPlayer = updatedRoom.players.get(eliminatedId)!;

    const elimPayload: PlayerEliminatedPayload = {
      playerId: eliminatedId,
      eliminatedInRound: roundNumber,
      fullCharacter: eliminatedPlayer.character!,
      reason,
    };
    io.to(roomId).emit(EVENTS.PLAYER_ELIMINATED, elimPayload);

    // Advance game
    if (roundNumber === 3) {
      // Final round — game over
      const allPlayers = [...updatedRoom.players.values()];
      const survivors = allPlayers.filter(
        (p) => p.status !== 'SPECTATOR' && p.status !== 'KICKED',
      );
      const eliminated = allPlayers
        .filter((p) => p.status === 'SPECTATOR')
        .sort((a, b) => (a.eliminatedInRound ?? 0) - (b.eliminatedInRound ?? 0));

      roomStore.updateRoom(roomId, (r) => {
        if (r.game) { r.game.endedAt = new Date(); r.game.endReason = 'COMPLETED'; }
        return r;
      });

      gsm.transitionTo(roomId, 'ENDED');

      const survivorNames = survivors.map((p) => p.nickname).join(', ');
      io.to(roomId).emit(EVENTS.GAME_ENDED, {
        reason: 'COMPLETED',
        survivors: survivors.map((p) =>
          roomManager.toPlayerView(p, updatedRoom, p.playerId),
        ),
        eliminated: eliminated.map((p) =>
          roomManager.toPlayerView(p, updatedRoom, p.playerId),
        ),
        outcomeSummary: `У бункері залишились: ${survivorNames}.`,
      });
    } else {
      const nextReveal = roundNumber === 1 ? 'R2_REVEAL' : 'R3_REVEAL';
      gsm.transitionTo(roomId, nextReveal);
    }
  }
}
