/**
 * Socket.IO handlers for host-only actions.
 * All handlers validate that the emitting socket belongs to the current host.
 *
 * Actions:
 * - host:kick       — remove a player from the lobby (pre-game only)
 * - host:startGame  — trigger scenario picker flow
 * - host:pickScenario — start game with chosen scenario
 * - host:extendTimer  — add 60 s to debate timer
 * - host:forceVote    — skip debate, open voting now
 * - host:endGame      — force-end game with full card reveal
 * - host:playAgain    — reset to SCENARIO_PICK with same players
 */

import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import {
  EVENTS,
  MIN_PLAYERS,
  MAX_PLAYERS,
} from '@bunker/shared';
import type {
  HostKickPayload, HostKickAck,
  HostStartGameAck,
  HostPickScenarioPayload, HostPickScenarioAck,
  HostExtendTimerAck,
  HostForceVoteAck,
  HostEndGameAck,
  HostPlayAgainAck,
  HostEndSessionAck,
  HostStartDebateTimerAck,
  HostNextSpeakerAck,
  PlayerKickedPayload,
  ScenariosListPayload,
  GameStartedPayload,
  GameEndedPayload,
  RoomClosedPayload,
  DebateOrderPayload,
  DebateSpeakerChangedPayload,
  HostTransferredPayload,
  PlayerView,
  Player,
  Game,
  VoteRecord,
} from '@bunker/shared';
import { getVoteCompletionChecker } from './voteHandlers.js';
import type { IRoomStore } from '../../store/RoomStore.js';
import type { ContentData } from '../../content/ContentData.js';
import type { RoomManager } from '../../services/RoomManager.js';
import type { GameStateMachine } from '../../services/GameStateMachine.js';
import type { TimerService } from '../../services/TimerService.js';
import type { CharacterDealer } from '../../services/CharacterDealer.js';
import { buildOutcomeSummary } from '../../services/OutcomeSummary.js';
import { emitAnalytics } from '../../services/Analytics.js';
import { callSurvivalWebhook } from '../../services/SurvivalWebhook.js';
import { startRevealPhaseTimer } from './revealHandlers.js';

/** Server-side speaking order state per room — not in shared types */
const debateSpeakingState = new Map<string, {
  orderedPlayerIds: string[];
  currentSpeakerIndex: number;
  waitingForNext: boolean; // true after timer expired — waiting for manual "Next" click
}>();

interface HostHandlerDeps {
  io: Server;
  roomStore: IRoomStore;
  roomManager: RoomManager;
  gsm: GameStateMachine;
  timerService: TimerService;
  dealer: CharacterDealer;
  contentData: ContentData;
}

const pickScenarioSchema = z.object({
  scenarioId: z.string().min(1),
});

const kickSchema = z.object({
  targetPlayerId: z.string().uuid(),
});

export function registerHostHandlers(socket: Socket, deps: HostHandlerDeps): void {
  const { io, roomStore, roomManager, gsm, timerService, dealer, contentData } = deps;

  /** Helper — find room where this socket is the host */
  function getHostRoom() {
    const playerId: string | undefined = socket.data.playerId;
    if (!playerId) return null;
    const found = roomManager.findPlayerById(playerId);
    if (!found) return null;
    if (found.room.hostPlayerId !== playerId) return null;
    if (found.player.status === 'KICKED') return null;
    return found;
  }

  // ── 60-second vote timer helper (reused from advanceSpeaker and HOST_FORCE_VOTE) ──
  const startVoteTimer = (roomId: string): void => {
    timerService.startDebateTimer(roomId, 60, () => {
      const r = roomStore.getRoom(roomId);
      if (!r || r.currentPhase !== 'VOTE') return;
      io.to(roomId).emit(EVENTS.TIMER_ENDED, {});
    });
  };

  // ── Speaker timer expired — show signal, wait for manual "Next" ──────────────
  const onSpeakerTimerExpired = (roomId: string): void => {
    const state = debateSpeakingState.get(roomId);
    if (!state) return;
    const r = roomStore.getRoom(roomId);
    if (!r || r.currentPhase !== 'DEBATE') { debateSpeakingState.delete(roomId); return; }
    debateSpeakingState.set(roomId, { ...state, waitingForNext: true });
    io.to(roomId).emit(EVENTS.TIMER_ENDED, {});
  };

  // ── Advance to next speaker (or transition to VOTE after last) ────────────────
  const advanceSpeaker = (roomId: string): void => {
    const state = debateSpeakingState.get(roomId);
    if (!state) return;
    const r = roomStore.getRoom(roomId);
    if (!r || r.currentPhase !== 'DEBATE') { debateSpeakingState.delete(roomId); return; }

    const nextIdx = state.currentSpeakerIndex + 1;
    if (nextIdx >= state.orderedPlayerIds.length) {
      debateSpeakingState.delete(roomId);
      const voteState = r.currentRound === 1 ? 'R1_VOTE' : r.currentRound === 2 ? 'R2_VOTE' : 'R3_VOTE';
      gsm.transitionTo(roomId, voteState);
      startVoteTimer(roomId);
    } else {
      debateSpeakingState.set(roomId, { ...state, currentSpeakerIndex: nextIdx, waitingForNext: false });
      const changedPayload: DebateSpeakerChangedPayload = { currentSpeakerIndex: nextIdx };
      io.to(roomId).emit(EVENTS.DEBATE_SPEAKER_CHANGED, changedPayload);
      timerService.startDebateTimer(roomId, 60, () => onSpeakerTimerExpired(roomId));
    }
  };

  // ── host:kick ─────────────────────────────────────────────────────────────────
  socket.on(EVENTS.HOST_KICK, (raw: unknown, ack: (r: HostKickAck) => void) => {
    const found = getHostRoom();
    if (!found) return ack({ ok: false, error: 'NOT_HOST' });
    const { room } = found;

    const parsed = kickSchema.safeParse(raw);
    if (!parsed.success) return ack({ ok: false, error: 'PLAYER_NOT_FOUND' });
    const { targetPlayerId } = parsed.data as HostKickPayload;

    const target = room.players.get(targetPlayerId);
    if (!target) return ack({ ok: false, error: 'PLAYER_NOT_FOUND' });

    // If the target is the current host, transfer host role to the next eligible player first
    if (targetPlayerId === room.hostPlayerId) {
      const newHostId = roomManager.findNextHost(room.roomId, targetPlayerId);
      if (newHostId) {
        roomStore.updateRoom(room.roomId, (r) => {
          r.hostPlayerId = newHostId;
          return r;
        });
        const transferred: HostTransferredPayload = { newHostId, reason: 'DISCONNECT_TIMEOUT' };
        io.to(room.roomId).emit(EVENTS.HOST_TRANSFERRED, transferred);
      }
    }

    // Notify the kicked player
    const kickedPayload: PlayerKickedPayload = { message: 'Вас видалено з кімнати' };
    if (target.socketId) {
      io.to(target.socketId).emit(EVENTS.PLAYER_KICKED, kickedPayload);
    }

    if (room.state === 'LOBBY') {
      // In lobby: simply remove the player
      roomStore.updateRoom(room.roomId, (r) => {
        r.players.delete(targetPlayerId);
        r.lastActivityAt = new Date();
        return r;
      });
    } else {
      // In game: mark as KICKED
      roomStore.updateRoom(room.roomId, (r) => {
        const p = r.players.get(targetPlayerId);
        if (p) r.players.set(targetPlayerId, { ...p, status: 'KICKED', socketId: null });
        r.lastActivityAt = new Date();
        return r;
      });

      // Workaround: if kicked player hadn't voted yet, auto-abstain so vote can complete
      if (room.currentPhase === 'VOTE' && room.currentRound !== null) {
        const round = room.game?.rounds[room.currentRound - 1];
        if (round) {
          const isTiebreak = round.tiebreakVotes !== null;
          const currentVotes = isTiebreak ? round.tiebreakVotes! : round.votes;
          if (!currentVotes.has(targetPlayerId)) {
            const abstention: VoteRecord = {
              voterId: targetPlayerId, targetId: targetPlayerId,
              submittedAt: new Date(), isAbstention: true,
            };
            roomStore.updateRoom(room.roomId, (r) => {
              const rd = r.game?.rounds[room.currentRound! - 1];
              if (!rd) return r;
              if (isTiebreak) {
                (rd.tiebreakVotes ??= new Map()).set(targetPlayerId, abstention);
              } else {
                rd.votes.set(targetPlayerId, abstention);
              }
              return r;
            });
            getVoteCompletionChecker()?.(room.roomId, room.currentRound);
          }
        }
      }
    }

    io.to(room.roomId).emit(EVENTS.PLAYER_LEFT, { playerId: targetPlayerId, newHostId: null });
    return ack({ ok: true });
  });

  // ── host:startGame ────────────────────────────────────────────────────────────
  socket.on(EVENTS.HOST_START_GAME, (ack: (r: HostStartGameAck) => void) => {
    const found = getHostRoom();
    if (!found) return ack({ ok: false, error: 'NOT_HOST' });
    const { room } = found;

    const count = room.players.size;
    if (count < MIN_PLAYERS) return ack({ ok: false, error: 'TOO_FEW_PLAYERS' });
    if (count > MAX_PLAYERS) return ack({ ok: false, error: 'TOO_MANY_PLAYERS' });

    // Transition to SCENARIO_PICK
    gsm.transitionTo(room.roomId, 'SCENARIO_PICK');

    const scenariosPayload: ScenariosListPayload = {
      scenarios: [...contentData.getAvailableScenarios()],
    };
    io.to(room.roomId).emit(EVENTS.SCENARIOS_LIST, scenariosPayload);

    return ack({ ok: true });
  });

  // ── host:pickScenario ─────────────────────────────────────────────────────────
  socket.on(
    EVENTS.HOST_PICK_SCENARIO,
    (raw: unknown, ack: (r: HostPickScenarioAck) => void) => {
      const found = getHostRoom();
      if (!found) return ack({ ok: false, error: 'NOT_HOST' });
      const { room } = found;

      if (room.state !== 'SCENARIO_PICK') return ack({ ok: false, error: 'INVALID_SCENARIO' });

      const parsed = pickScenarioSchema.safeParse(raw);
      if (!parsed.success) return ack({ ok: false, error: 'INVALID_SCENARIO' });

      const { scenarioId } = parsed.data as HostPickScenarioPayload;
      const available = contentData.getAvailableScenarios();

      let scenario = available.find((s) => s.id === scenarioId) ?? null;
      if (scenarioId === 'RANDOM' || !scenario) {
        const idx = Math.floor(Math.random() * available.length);
        scenario = available[idx] ?? null;
      }
      if (!scenario) return ack({ ok: false, error: 'INVALID_SCENARIO' });

      const playerIds = [...room.players.keys()];
      const cards = dealer.deal(playerIds, contentData);
      const now = new Date();

      const game: Game = {
        roomId: room.roomId,
        scenarioId: scenario.id,
        rounds: gsm.createRounds(),
        startedAt: now,
        endedAt: null,
        endReason: null,
      };

      // Assign characters and save game
      roomStore.updateRoom(room.roomId, (r) => {
        r.scenarioId = scenario!.id;
        r.game = game;
        r.lastActivityAt = now;
        for (const [pid, card] of cards.entries()) {
          const p = r.players.get(pid);
          if (p) r.players.set(pid, { ...p, character: card });
        }
        return r;
      });

      // Emit game:started to each player with their OWN card only
      for (const player of room.players.values()) {
        if (!player.socketId) continue;
        const card = cards.get(player.playerId);
        if (!card) continue;
        const updatedRoom = roomStore.getRoom(room.roomId)!;
        const payload: GameStartedPayload = {
          scenario: scenario,
          ownCharacter: card,
          players: roomManager.getPlayerViews(updatedRoom, player.playerId),
        };
        io.to(player.socketId).emit(EVENTS.GAME_STARTED, payload);
      }

      // Advance to R1_REVEAL and start the reveal auto-select timeout
      gsm.transitionTo(room.roomId, 'R1_REVEAL');
      startRevealPhaseTimer(room.roomId, 1, { io, roomStore, roomManager, gsm, timerService });

      emitAnalytics({
        type: 'game_started',
        roomCode: room.roomCode,
        scenarioId: scenario.id,
        playerCount: playerIds.length,
        timestamp: now.toISOString(),
      });

      return ack({ ok: true });
    },
  );

  // ── host:extendTimer ──────────────────────────────────────────────────────────
  socket.on(EVENTS.HOST_EXTEND_TIMER, (ack: (r: HostExtendTimerAck) => void) => {
    const found = getHostRoom();
    if (!found) return ack({ ok: false, error: 'NOT_HOST' });
    const { room } = found;

    if (room.currentPhase !== 'DEBATE') return ack({ ok: false, error: 'WRONG_PHASE' });

    try {
      const newRemaining = timerService.extendTimer(room.roomId, 60);
      return ack({ ok: true, newRemaining });
    } catch {
      return ack({ ok: false, error: 'WRONG_PHASE' });
    }
  });

  // ── host:forceVote ────────────────────────────────────────────────────────────
  socket.on(EVENTS.HOST_FORCE_VOTE, (ack: (r: HostForceVoteAck) => void) => {
    const found = getHostRoom();
    if (!found) return ack({ ok: false, error: 'NOT_HOST' });
    const { room } = found;

    if (room.currentPhase !== 'DEBATE') return ack({ ok: false, error: 'WRONG_PHASE' });

    timerService.cancelTimer(room.roomId);
    debateSpeakingState.delete(room.roomId);
    gsm.advance(room.roomId); // DEBATE → VOTE
    startVoteTimer(room.roomId);
    return ack({ ok: true });
  });

  // ── host:startDebateTimer ─────────────────────────────────────────────────────
  socket.on(EVENTS.HOST_START_DEBATE_TIMER, (ack: (r: HostStartDebateTimerAck) => void) => {
    const found = getHostRoom();
    if (!found) return ack({ ok: false, error: 'NOT_HOST' });
    const { room } = found;

    if (room.currentPhase !== 'DEBATE') return ack({ ok: false, error: 'WRONG_PHASE' });

    // Randomised speaking order (Fisher-Yates) so each round starts with a different person
    const active = [...room.players.values()]
      .filter((p) => p.status === 'ACTIVE' || p.status === 'RECONNECTING');
    const shuffled = [...active];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const orderedPlayerIds = shuffled.map((p) => p.playerId);

    debateSpeakingState.set(room.roomId, { orderedPlayerIds, currentSpeakerIndex: 0, waitingForNext: false });

    const orderPayload: DebateOrderPayload = { orderedPlayerIds, currentSpeakerIndex: 0 };
    io.to(room.roomId).emit(EVENTS.DEBATE_ORDER, orderPayload);

    // 60s for first speaker; on expire: show signal and wait for manual "Next"
    timerService.startDebateTimer(room.roomId, 60, () => onSpeakerTimerExpired(room.roomId));

    return ack({ ok: true });
  });

  // ── host:nextSpeaker — allowed for host OR current speaker ───────────────────
  socket.on(EVENTS.HOST_NEXT_SPEAKER, (ack: (r: HostNextSpeakerAck) => void) => {
    const playerId: string | undefined = socket.data.playerId;
    if (!playerId) return ack({ ok: false, error: 'NOT_HOST' });

    const found = roomManager.findPlayerById(playerId);
    if (!found) return ack({ ok: false, error: 'NOT_HOST' });
    const { room } = found;

    if (room.currentPhase !== 'DEBATE') return ack({ ok: false, error: 'WRONG_PHASE' });

    const speakingState = debateSpeakingState.get(room.roomId);
    if (!speakingState) return ack({ ok: false, error: 'WRONG_PHASE' });

    const isHost = room.hostPlayerId === playerId;
    const currentSpeakerId = speakingState.orderedPlayerIds[speakingState.currentSpeakerIndex];
    const isCurrentSpeaker = currentSpeakerId === playerId;

    if (!isHost && !isCurrentSpeaker) return ack({ ok: false, error: 'NOT_HOST' });

    // Cancel running timer (if any) and advance to next speaker
    timerService.cancelTimer(room.roomId);
    advanceSpeaker(room.roomId);

    return ack({ ok: true });
  });

  // ── host:endGame ──────────────────────────────────────────────────────────────
  socket.on(EVENTS.HOST_END_GAME, (ack: (r: HostEndGameAck) => void) => {
    const found = getHostRoom();
    if (!found) return ack({ ok: false, error: 'NOT_HOST' });
    const { room } = found;

    const inGame = room.state !== 'LOBBY' && room.state !== 'ENDED';
    if (!inGame) return ack({ ok: false, error: 'WRONG_PHASE' });

    timerService.clearAll(room.roomId);
    broadcastGameEnded(room.roomId, 'HOST_ENDED_EARLY');
    return ack({ ok: true });
  });

  // ── host:playAgain ────────────────────────────────────────────────────────────
  socket.on(EVENTS.HOST_PLAY_AGAIN, (ack: (r: HostPlayAgainAck) => void) => {
    const found = getHostRoom();
    if (!found) return ack({ ok: false, error: 'NOT_HOST' });
    const { room } = found;

    if (room.state !== 'ENDED') return ack({ ok: false, error: 'WRONG_PHASE' });

    // Reset player characters and reveal history
    roomStore.updateRoom(room.roomId, (r) => {
      r.game = null;
      r.scenarioId = null;
      r.currentRound = null;
      r.currentPhase = null;
      r.lastActivityAt = new Date();
      for (const [pid, p] of r.players.entries()) {
        r.players.set(pid, {
          ...p,
          character: null,
          revealHistory: [],
          eliminatedInRound: null,
          status: p.status === 'SPECTATOR' ? 'ACTIVE' : p.status,
        });
      }
      return r;
    });

    gsm.transitionTo(room.roomId, 'SCENARIO_PICK');

    const updatedRoom = roomStore.getRoom(room.roomId)!;
    const scenariosPayload: ScenariosListPayload = {
      scenarios: [...contentData.getAvailableScenarios()],
    };
    io.to(updatedRoom.roomId).emit(EVENTS.SCENARIOS_LIST, scenariosPayload);

    return ack({ ok: true });
  });

  // ── host:endSession ───────────────────────────────────────────────────────────
  socket.on(EVENTS.HOST_END_SESSION, (ack: (r: HostEndSessionAck) => void) => {
    const found = getHostRoom();
    if (!found) return ack({ ok: false, error: 'NOT_HOST' });
    const { room } = found;

    if (room.state !== 'ENDED') return ack({ ok: false, error: 'WRONG_PHASE' });

    timerService.clearAll(room.roomId);

    const closedPayload: RoomClosedPayload = { message: 'Дякуємо за гру' };
    io.to(room.roomId).emit(EVENTS.ROOM_CLOSED, closedPayload);

    // Disconnect all sockets from the Socket.IO room
    io.in(room.roomId).socketsLeave(room.roomId);

    roomStore.deleteRoom(room.roomId);

    return ack({ ok: true });
  });

  /** Helper — build and broadcast game:ended payload */
  function broadcastGameEnded(
    roomId: string,
    reason: 'COMPLETED' | 'HOST_ENDED_EARLY',
  ): void {
    const room = roomStore.getRoom(roomId);
    if (!room) return;

    // Build player lists and views BEFORE revealing all traits so that
    // TraitSlot.isRevealed correctly reflects what each player shared during gameplay.
    const allPlayers = [...room.players.values()];
    const survivors = allPlayers.filter((p) => p.status !== 'SPECTATOR' && p.status !== 'KICKED');
    const eliminated = allPlayers
      .filter((p) => p.status === 'SPECTATOR')
      .sort((a, b) => (a.eliminatedInRound ?? 0) - (b.eliminatedInRound ?? 0));

    const toView = (p: Player): PlayerView =>
      roomManager.toPlayerView(p, room, p.playerId);

    const survivorViews = survivors.map(toView);
    const eliminatedViews = eliminated.map(toView);

    // Now reveal all cards in the store (for persistence / analytics only)
    roomStore.updateRoom(roomId, (r) => {
      for (const [pid, p] of r.players.entries()) {
        if (!p.character) continue;
        const traits = { ...p.character.traits };
        for (const cat of Object.keys(traits) as Array<keyof typeof traits>) {
          traits[cat] = { ...traits[cat], isRevealed: true };
        }
        r.players.set(pid, { ...p, character: { ...p.character, traits } });
      }
      if (r.game) r.game.endedAt = new Date();
      if (r.game) r.game.endReason = reason;
      r.lastActivityAt = new Date();
      return r;
    });

    gsm.transitionTo(roomId, 'ENDED');

    const outcomeSummary = buildOutcomeSummary(survivors, eliminated, reason);

    const payload: GameEndedPayload = {
      reason,
      survivors: survivorViews,
      eliminated: eliminatedViews,
      outcomeSummary,
    };

    io.to(roomId).emit(EVENTS.GAME_ENDED, payload);

    emitAnalytics({
      type: 'game_completed',
      roomCode: room.roomCode,
      reason,
      survivorCount: survivors.length,
      timestamp: new Date().toISOString(),
    });

    // Fire-and-forget AI survival prediction for completed games only
    if (reason === 'COMPLETED' && room.scenarioId) {
      const scenario = contentData.getScenario(room.scenarioId);
      if (scenario) {
        void callSurvivalWebhook(roomId, scenario, survivors, io);
      }
    }
  }

  // Expose helper so reveal/vote handlers can call it
  (socket as unknown as Record<string, unknown>)['_broadcastGameEnded'] =
    broadcastGameEnded;
}
