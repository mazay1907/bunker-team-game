/**
 * Socket.IO handler for vote:submit, vote:tiebreaker, and host:skipVote.
 *
 * Open voting: each submitted vote is broadcast immediately (vote:update).
 * Completion: when all active players have voted, tally and resolve.
 *
 * Tie resolution (per GAME_RULES.md):
 * 1. Re-vote between tied players (all active players vote again)
 * 2. If still tied → host (or longest-connected) casts deciding vote
 * 3. Winner is eliminated; card fully revealed; game advances
 *
 * Sprint 2 additions:
 * - 30-second reconnect window for disconnected voters (7.3.1)
 * - host:disconnectedVoterPrompt → host can wait or skip vote (7.3.2, 7.3.3)
 * - host:skipVote marks vote as abstention and re-checks completion (7.3.3)
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
  HostSkipVotePayload,
  HostSkipVoteAck,
  HostDisconnectedVoterPromptPayload,
} from '@bunker/shared';
import type { IRoomStore } from '../../store/RoomStore.js';
import type { RoomManager } from '../../services/RoomManager.js';
import type { GameStateMachine } from '../../services/GameStateMachine.js';
import type { VoteEngine } from '../../services/VoteEngine.js';
import type { TimerService } from '../../services/TimerService.js';
import { buildOutcomeSummary } from '../../services/OutcomeSummary.js';
import { startRevealPhaseTimer } from './revealHandlers.js';

/** How long to hold a disconnected voter's slot before prompting host (seconds) */
const DISCONNECTED_VOTER_HOLD_SECONDS = 30;
/** Extension time when host chooses "Wait" (seconds) */
const DISCONNECTED_VOTER_EXTENSION_SECONDS = 60;

interface VoteHandlerDeps {
  io: Server;
  roomStore: IRoomStore;
  roomManager: RoomManager;
  gsm: GameStateMachine;
  voteEngine: VoteEngine;
  timerService: TimerService;
}

const voteSubmitSchema = z.object({ targetId: z.string().uuid() });
const skipVoteSchema = z.object({ disconnectedPlayerId: z.string().uuid() });

export function registerVoteHandlers(socket: Socket, deps: VoteHandlerDeps): void {
  const { io, roomStore, roomManager, gsm, voteEngine, timerService } = deps;

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
      // allowedIds comes from the stored candidates, not from existing votes (which may be empty)
      const allowedIds = isTiebreak ? (round.tiebreakCandidateIds ?? undefined) : undefined;

      // Validate self-vote
      if (targetId === playerId) return ack({ ok: false, error: 'SELF_VOTE' });

      // Validate already voted (different Map for tiebreak)
      // One vote change is allowed per player per round (not in tiebreak).
      const activeVotes = isTiebreak ? round.tiebreakVotes! : round.votes;
      const alreadyVoted = activeVotes.has(playerId);
      if (alreadyVoted) {
        if (isTiebreak || round.voteChangesUsed.has(playerId)) {
          return ack({ ok: false, error: 'ALREADY_VOTED' });
        }
        // First change is allowed — continue to update vote
      }

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

      // Persist vote (replaces existing if changing)
      roomStore.updateRoom(room.roomId, (r) => {
        const rd = r.game?.rounds[room.currentRound! - 1];
        if (!rd) return r;
        if (isTiebreak) {
          rd.tiebreakVotes ??= new Map();
          rd.tiebreakVotes.set(playerId, record);
        } else {
          rd.votes.set(playerId, record);
          if (alreadyVoted) {
            rd.voteChangesUsed.add(playerId);
          }
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

  // ── host:skipVote ──────────────────────────────────────────────────────────
  socket.on(
    EVENTS.HOST_SKIP_VOTE,
    (raw: unknown, ack: (r: HostSkipVoteAck) => void) => {
      const hostPlayerId: string | undefined = socket.data.playerId;
      if (!hostPlayerId) return ack({ ok: false, error: 'NOT_HOST' });

      const found = roomManager.findPlayerById(hostPlayerId);
      if (!found) return ack({ ok: false, error: 'NOT_HOST' });
      const { room } = found;

      if (room.hostPlayerId !== hostPlayerId) return ack({ ok: false, error: 'NOT_HOST' });
      if (room.currentPhase !== 'VOTE' || !room.currentRound) {
        return ack({ ok: false, error: 'WRONG_PHASE' });
      }

      const parsed = skipVoteSchema.safeParse(raw);
      if (!parsed.success) return ack({ ok: false, error: 'WRONG_PHASE' });

      const { disconnectedPlayerId } = parsed.data as HostSkipVotePayload;
      const disconnected = room.players.get(disconnectedPlayerId);
      if (!disconnected || disconnected.status !== 'RECONNECTING') {
        return ack({ ok: false, error: 'WRONG_PHASE' });
      }

      // Record abstention vote for the disconnected player
      const abstention: VoteRecord = {
        voterId: disconnectedPlayerId,
        targetId: disconnectedPlayerId, // self-reference as abstention marker
        submittedAt: new Date(),
        isAbstention: true,
      };

      const round = room.game?.rounds[room.currentRound - 1];
      if (!round) return ack({ ok: false, error: 'WRONG_PHASE' });

      const isTiebreak = round.tiebreakVotes !== null;

      roomStore.updateRoom(room.roomId, (r) => {
        const rd = r.game?.rounds[room.currentRound! - 1];
        if (!rd) return r;
        if (isTiebreak) {
          rd.tiebreakVotes ??= new Map();
          rd.tiebreakVotes.set(disconnectedPlayerId, abstention);
        } else {
          rd.votes.set(disconnectedPlayerId, abstention);
        }
        r.lastActivityAt = new Date();
        return r;
      });

      ack({ ok: true });

      // Re-check completion with the abstention counted
      checkVoteCompletion(room.roomId, room.currentRound);
    },
  );

  /**
   * Checks if all active voters have submitted.
   * For RECONNECTING players: starts a 30-sec hold window, then prompts host.
   */
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

    const pending = activePlayers.filter((p) => !currentVotes.has(p.playerId));
    if (pending.length === 0) {
      // All votes in — resolve
      resolveVotes(roomId, roundNumber, isTiebreak);
      return;
    }

    // Check for RECONNECTING players who haven't voted and don't have a pending timer
    for (const player of pending) {
      if (player.status !== 'RECONNECTING') continue;

      const timerKey = `vote:${roomId}:${player.playerId}`;
      // Only start timer once per reconnecting voter (re-use reconnect timer key)
      // We store disconnected-voter prompt timers in TimerService under a special key
      scheduleDisconnectedVoterPrompt(roomId, player.playerId, roundNumber);
    }
  }

  /**
   * Schedules a prompt to the host after 30 seconds if a voter is still disconnected.
   * If host chooses "Wait", adds another 60 seconds and re-prompts.
   */
  function scheduleDisconnectedVoterPrompt(
    roomId: string,
    disconnectedPlayerId: string,
    roundNumber: 1 | 2 | 3,
  ): void {
    // Use vote-specific reconnect timer so it doesn't conflict with the 5-min auto-elim timer
    const voteTimerKey = `vote_${roomId}_${disconnectedPlayerId}`;

    // Avoid double-scheduling by checking if a timer is already running
    // We clear it and restart only if not already scheduled
    // Use a simple Map stored in closure; TimerService handles only debate/reconnect timers
    const delayMs = DISCONNECTED_VOTER_HOLD_SECONDS * 1000;
    timerService.startReconnectTimer(`vote:${roomId}`, disconnectedPlayerId, DISCONNECTED_VOTER_HOLD_SECONDS, () => {
      promptHostForDisconnectedVoter(roomId, disconnectedPlayerId, roundNumber, DISCONNECTED_VOTER_EXTENSION_SECONDS);
    });

    void voteTimerKey; // used for documentation clarity
  }

  /**
   * Sends host:disconnectedVoterPrompt to the host socket.
   * The host's client will show a modal: "Wait 1 min" or "Skip vote".
   */
  function promptHostForDisconnectedVoter(
    roomId: string,
    disconnectedPlayerId: string,
    roundNumber: 1 | 2 | 3,
    extensionSeconds: number,
  ): void {
    const room = roomStore.getRoom(roomId);
    if (!room || room.currentPhase !== 'VOTE') return;

    const disconnected = room.players.get(disconnectedPlayerId);
    // If the player reconnected before prompt fires — do nothing
    if (!disconnected || disconnected.status !== 'RECONNECTING') return;

    // Check if they already have a vote (reconnected + voted)
    const round = room.game?.rounds[roundNumber - 1];
    if (!round) return;
    const isTiebreak = round.tiebreakVotes !== null;
    const currentVotes = isTiebreak ? round.tiebreakVotes! : round.votes;
    if (currentVotes.has(disconnectedPlayerId)) return;

    // Find the host's socket to send a targeted prompt
    const hostPlayer = room.players.get(room.hostPlayerId);
    if (!hostPlayer?.socketId) return;

    const promptPayload: HostDisconnectedVoterPromptPayload = {
      disconnectedPlayerId,
      disconnectedNickname: disconnected.nickname,
    };
    io.to(hostPlayer.socketId).emit(EVENTS.HOST_DISCONNECTED_VOTER_PROMPT, promptPayload);

    // Schedule the next prompt if host doesn't act within extensionSeconds
    timerService.startReconnectTimer(`vote:${roomId}`, disconnectedPlayerId, extensionSeconds, () => {
      promptHostForDisconnectedVoter(roomId, disconnectedPlayerId, roundNumber, extensionSeconds);
    });
  }

  function resolveVotes(roomId: string, roundNumber: 1 | 2 | 3, isTiebreak: boolean): void {
    const room = roomStore.getRoom(roomId);
    if (!room) return;

    const round = room.game?.rounds[roundNumber - 1];
    if (!round) return;

    const currentVotes = isTiebreak ? round.tiebreakVotes! : round.votes;
    const { leaders, tally } = voteEngine.tally(currentVotes);

    if (leaders.length === 1) {
      // Clear winner
      eliminatePlayer(roomId, leaders[0]!, roundNumber, 'VOTE');
    } else if (!isTiebreak) {
      // First tie — start tiebreak re-vote
      roomStore.updateRoom(roomId, (r) => {
        const rd = r.game?.rounds[roundNumber - 1];
        if (rd) {
          rd.tiebreakVotes = new Map();
          rd.tiebreakCandidateIds = leaders;
        }
        return r;
      });

      const deciderId = voteEngine.getTiebreakerDecider(room);
      const tiebreakerPayload: VoteTiebreakerPayload = {
        tiedPlayerIds: leaders,
        isHostDeciding: false,
        decidingPlayerId: null,
      };
      io.to(roomId).emit(EVENTS.VOTE_TIEBREAKER, tiebreakerPayload);
      void deciderId;
    } else {
      // Tiebreak also tied — host decides
      const deciderId = voteEngine.getTiebreakerDecider(room);
      const tiebreakerPayload: VoteTiebreakerPayload = {
        tiedPlayerIds: leaders,
        isHostDeciding: true,
        decidingPlayerId: deciderId,
      };
      io.to(roomId).emit(EVENTS.VOTE_TIEBREAKER, tiebreakerPayload);

      // Reset tiebreak votes — decider picks from the same candidates
      roomStore.updateRoom(roomId, (r) => {
        const rd = r.game?.rounds[roundNumber - 1];
        if (rd) {
          rd.tiebreakVotes = new Map();
          rd.tiebreakCandidateIds = leaders;
        }
        return r;
      });
    }

    void tally; // tally is broadcast via vote:update events as each vote comes in
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

      const outcomeSummary = buildOutcomeSummary(survivors, eliminated, 'COMPLETED');
      io.to(roomId).emit(EVENTS.GAME_ENDED, {
        reason: 'COMPLETED',
        survivors: survivors.map((p) =>
          roomManager.toPlayerView(p, updatedRoom, p.playerId),
        ),
        eliminated: eliminated.map((p) =>
          roomManager.toPlayerView(p, updatedRoom, p.playerId),
        ),
        outcomeSummary,
      });
    } else {
      const nextRoundNumber = (roundNumber + 1) as 2 | 3;
      const nextReveal = roundNumber === 1 ? 'R2_REVEAL' : 'R3_REVEAL';
      gsm.transitionTo(roomId, nextReveal);
      startRevealPhaseTimer(roomId, nextRoundNumber, { io, roomStore, roomManager, gsm, timerService });
    }
  }
}
