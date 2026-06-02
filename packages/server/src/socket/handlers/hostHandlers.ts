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
  PlayerView,
  Game,
} from '@bunker/shared';
import { DEBATE_TIMER_SECONDS } from '@bunker/shared';
import type { IRoomStore } from '../../store/RoomStore.js';
import type { ContentData } from '../../content/ContentData.js';
import type { RoomManager } from '../../services/RoomManager.js';
import type { GameStateMachine } from '../../services/GameStateMachine.js';
import type { TimerService } from '../../services/TimerService.js';
import type { CharacterDealer } from '../../services/CharacterDealer.js';
import { buildOutcomeSummary } from '../../services/OutcomeSummary.js';
import { emitAnalytics } from '../../services/Analytics.js';
import { startRevealPhaseTimer } from './revealHandlers.js';

/** Server-side speaking order state per room — not in shared types */
const debateSpeakingState = new Map<string, { orderedPlayerIds: string[]; currentSpeakerIndex: number }>();

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
    return found;
  }

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
      // In game: mark as KICKED (keeps them in the list as spectator-like)
      roomStore.updateRoom(room.roomId, (r) => {
        const p = r.players.get(targetPlayerId);
        if (p) r.players.set(targetPlayerId, { ...p, status: 'KICKED', socketId: null });
        r.lastActivityAt = new Date();
        return r;
      });
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
    return ack({ ok: true });
  });

  // ── host:startDebateTimer ─────────────────────────────────────────────────────
  socket.on(EVENTS.HOST_START_DEBATE_TIMER, (ack: (r: HostStartDebateTimerAck) => void) => {
    const found = getHostRoom();
    if (!found) return ack({ ok: false, error: 'NOT_HOST' });
    const { room } = found;

    if (room.currentPhase !== 'DEBATE') return ack({ ok: false, error: 'WRONG_PHASE' });

    // Compute circular speaking order for this round (shift by round-1)
    const roundNumber = room.currentRound ?? 1;
    const activePlayers = [...room.players.values()]
      .filter((p) => p.status === 'ACTIVE' || p.status === 'RECONNECTING')
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
    const shift = (roundNumber - 1) % Math.max(activePlayers.length, 1);
    const orderedPlayerIds = [
      ...activePlayers.slice(shift),
      ...activePlayers.slice(0, shift),
    ].map((p) => p.playerId);

    debateSpeakingState.set(room.roomId, { orderedPlayerIds, currentSpeakerIndex: 0 });

    const orderPayload: DebateOrderPayload = { orderedPlayerIds, currentSpeakerIndex: 0 };
    io.to(room.roomId).emit(EVENTS.DEBATE_ORDER, orderPayload);

    // Start countdown — when it ends, just signal (no auto-advance to vote)
    timerService.startDebateTimer(room.roomId, DEBATE_TIMER_SECONDS, () => {
      const r = roomStore.getRoom(room.roomId);
      if (!r || r.currentPhase !== 'DEBATE') return;
      io.to(room.roomId).emit(EVENTS.TIMER_ENDED, {});
    });

    return ack({ ok: true });
  });

  // ── host:nextSpeaker ──────────────────────────────────────────────────────────
  socket.on(EVENTS.HOST_NEXT_SPEAKER, (ack: (r: HostNextSpeakerAck) => void) => {
    const found = getHostRoom();
    if (!found) return ack({ ok: false, error: 'NOT_HOST' });
    const { room } = found;

    if (room.currentPhase !== 'DEBATE') return ack({ ok: false, error: 'WRONG_PHASE' });

    const state = debateSpeakingState.get(room.roomId);
    if (!state) return ack({ ok: false, error: 'WRONG_PHASE' });

    const next = (state.currentSpeakerIndex + 1) % state.orderedPlayerIds.length;
    debateSpeakingState.set(room.roomId, { ...state, currentSpeakerIndex: next });

    const changedPayload: DebateSpeakerChangedPayload = { currentSpeakerIndex: next };
    io.to(room.roomId).emit(EVENTS.DEBATE_SPEAKER_CHANGED, changedPayload);

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

    // Reveal all cards
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

    const updated = roomStore.getRoom(roomId)!;
    const allPlayers = [...updated.players.values()];
    const survivors = allPlayers.filter((p) => p.status !== 'SPECTATOR' && p.status !== 'KICKED');
    const eliminated = allPlayers
      .filter((p) => p.status === 'SPECTATOR')
      .sort((a, b) => (a.eliminatedInRound ?? 0) - (b.eliminatedInRound ?? 0));

    const toView = (p: typeof allPlayers[0]): PlayerView =>
      roomManager.toPlayerView(p, updated, p.playerId);

    const outcomeSummary = buildOutcomeSummary(survivors, eliminated, reason);

    const payload: GameEndedPayload = {
      reason,
      survivors: survivors.map(toView),
      eliminated: eliminated.map(toView),
      outcomeSummary,
    };

    io.to(roomId).emit(EVENTS.GAME_ENDED, payload);

    emitAnalytics({
      type: 'game_completed',
      roomCode: updated.roomCode,
      reason,
      survivorCount: survivors.length,
      timestamp: new Date().toISOString(),
    });
  }

  // Expose helper so reveal/vote handlers can call it
  (socket as unknown as Record<string, unknown>)['_broadcastGameEnded'] =
    broadcastGameEnded;
}
