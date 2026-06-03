/**
 * Socket.IO handlers for room join, leave, and reconnect events.
 * This is the entry point for all players — the same handler
 * serves first-time join and reconnect, distinguished by sessionToken presence.
 *
 * Sprint 2 additions:
 * - 5-minute auto-elimination timer on disconnect mid-game (9.1, 9.2)
 * - 60-second host-transfer timer on host disconnect (9.3)
 * - Single-elimination rule for simultaneous disconnects (9.2.2)
 */

import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import {
  EVENTS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  RECONNECT_HOLD_SECONDS,
  HOST_TRANSFER_SECONDS,
} from '@bunker/shared';
import type {
  Player,
  RoomJoinPayload,
  RoomJoinAck,
  PlayerJoinedPayload,
  PlayerLeftPayload,
  PlayerReconnectingPayload,
  PlayerReconnectedPayload,
  RoomStatePayload,
  HostTransferredPayload,
  PlayerEliminatedPayload,
} from '@bunker/shared';
import type { IRoomStore } from '../../store/RoomStore.js';
import type { ISessionStore } from '../../store/SessionStore.js';
import type { IReconnectStore } from '../../store/ReconnectStore.js';
import { RoomManager } from '../../services/RoomManager.js';
import type { ContentData } from '../../content/ContentData.js';
import type { TimerService } from '../../services/TimerService.js';
import type { GameStateMachine } from '../../services/GameStateMachine.js';
import { buildOutcomeSummary } from '../../services/OutcomeSummary.js';
import { emitAnalytics } from '../../services/Analytics.js';
import { getCachedPrediction } from '../../services/SurvivalWebhook.js';

// Zod schema for room:join payload validation
// nickname min(2) is NOT enforced here — reconnect sends empty string and is valid.
// The first-time join path does the length check manually.
const roomJoinSchema = z.object({
  roomCode: z.string().regex(/^[A-Z0-9]{6}$/, 'Invalid room code format'),
  nickname: z.string().trim().max(20),
  sessionToken: z.string().nullable(),
});

interface HandlerDeps {
  io: Server;
  roomStore: IRoomStore;
  sessionStore: ISessionStore;
  reconnectStore: IReconnectStore;
  roomManager: RoomManager;
  contentData?: ContentData;
  timerService: TimerService;
  gsm: GameStateMachine;
}

export function registerRoomHandlers(socket: Socket, deps: HandlerDeps): void {
  const { io, roomStore, sessionStore, reconnectStore, roomManager, contentData, timerService, gsm } = deps;

  // ── room:join ────────────────────────────────────────────────────────────────
  socket.on(
    EVENTS.ROOM_JOIN,
    async (payload: unknown, ack: (res: RoomJoinAck) => void) => {
      try {
        const parsed = roomJoinSchema.safeParse(payload);
        if (!parsed.success) {
          return ack({ ok: false, error: 'INVALID_NICKNAME' });
        }

        const { roomCode, nickname, sessionToken } = parsed.data;

        // ── Reconnect path ─────────────────────────────────────────────────────
        // Check reconnect token first (more secure — requires both tokens)
        const auth = socket.handshake.auth as Record<string, unknown>;
        const reconnectToken =
          typeof auth['reconnectToken'] === 'string' ? auth['reconnectToken'] : null;

        if (reconnectToken) {
          const existingPlayerId = reconnectStore.get(reconnectToken);
          if (existingPlayerId) {
            const found = roomManager.findPlayerById(existingPlayerId);
            // Also handle ACTIVE players with no socketId (host connecting after HTTP room creation)
            // Also allow KICKED players to re-enter if they still have their reconnect token
            const isReturning =
              found &&
              (found.player.status === 'RECONNECTING' ||
                found.player.status === 'KICKED' ||
                (found.player.status === 'ACTIVE' && !found.player.socketId));

            if (isReturning && found) {
              const { room, player } = found;

              // Cancel the reconnect hold timer — player came back in time
              timerService.clearReconnectTimer(room.roomId, existingPlayerId);

              // If this player was the host, cancel host-transfer timer too
              if (room.hostPlayerId === existingPlayerId) {
                timerService.cancelHostTransferTimer(room.roomId);
                // Emit host:transferred with ORIGINAL_RECONNECTED reason if we had transferred
                // (host re-gains their role — it was never changed since we cancelled in time)
              }

              // Update socket ID and status
              roomStore.updateRoom(room.roomId, (r) => {
                const updatedPlayer = r.players.get(existingPlayerId);
                if (!updatedPlayer) return r;
                r.players.set(existingPlayerId, {
                  ...updatedPlayer,
                  socketId: socket.id,
                  status: 'ACTIVE',
                  disconnectedAt: null,
                });
                r.lastActivityAt = new Date();
                return r;
              });
              socket.data.playerId = existingPlayerId;
              sessionStore.set(player.sessionToken, existingPlayerId);
              await socket.join(room.roomId);

              // Send full state to reconnecting player
              const updatedRoom = roomStore.getRoom(room.roomId);
              if (updatedRoom) {
                const updatedPlayer = updatedRoom.players.get(existingPlayerId);
                const statePayload: RoomStatePayload = {
                  room: roomManager.toRoomView(updatedRoom, contentData),
                  players: roomManager.getPlayerViews(updatedRoom, existingPlayerId),
                  ownCharacter: updatedPlayer?.character ?? null,
                  game: null,
                };
                socket.emit(EVENTS.ROOM_STATE, statePayload);

                // If the game ended while this player was away and the AI prediction
                // already arrived, send it now so they don't see the loading spinner forever.
                const cachedPrediction = getCachedPrediction(room.roomId);
                if (cachedPrediction) {
                  socket.emit(EVENTS.SURVIVAL_PREDICTION, { prediction: cachedPrediction });
                }

                if (player.status === 'KICKED') {
                  // Kicked player re-entering — others removed them from their list, re-add via PLAYER_JOINED
                  const playerView = roomManager.toPlayerView(updatedPlayer!, updatedRoom, existingPlayerId);
                  socket.to(room.roomId).emit(EVENTS.PLAYER_JOINED, { player: playerView });
                } else {
                  const reconnectedPayload: PlayerReconnectedPayload = {
                    playerId: existingPlayerId,
                  };
                  socket.to(room.roomId).emit(EVENTS.PLAYER_RECONNECTED, reconnectedPayload);
                }
              }

              return ack({
                ok: true,
                player: roomManager.toPlayerView(player, room, existingPlayerId),
                room: roomManager.toRoomView(room, contentData),
                reconnectToken,
              });
            }
          }
        }

        // ── First-time join path ───────────────────────────────────────────────
        const room = roomStore.getRoomByCode(roomCode);
        if (!room) {
          return ack({ ok: false, error: 'ROOM_NOT_FOUND' });
        }

        if (room.state !== 'LOBBY') {
          if (room.state === 'ENDED') {
            return ack({ ok: false, error: 'ROOM_NOT_FOUND' });
          }
          // Name-based reconnect: token is lost (browser crash, new device) but player can
          // rejoin by matching their exact nickname in the active room
          if (nickname.trim().length >= 2) {
            const byNick = [...room.players.values()].find(
              (p) => p.nickname === nickname.trim() &&
                (p.status === 'ACTIVE' || p.status === 'RECONNECTING'),
            );
            if (byNick) {
              const newRcToken = randomBytes(32).toString('hex');
              timerService.clearReconnectTimer(room.roomId, byNick.playerId);
              if (room.hostPlayerId === byNick.playerId) {
                timerService.cancelHostTransferTimer(room.roomId);
              }
              reconnectStore.set(newRcToken, byNick.playerId);
              roomStore.updateRoom(room.roomId, (r) => {
                const p = r.players.get(byNick.playerId);
                if (p) r.players.set(byNick.playerId, { ...p, socketId: socket.id, status: 'ACTIVE', disconnectedAt: null });
                r.lastActivityAt = new Date();
                return r;
              });
              socket.data.playerId = byNick.playerId;
              sessionStore.set(byNick.sessionToken, byNick.playerId);
              await socket.join(room.roomId);
              const rr = roomStore.getRoom(room.roomId)!;
              const rp = rr.players.get(byNick.playerId)!;
              socket.emit(EVENTS.ROOM_STATE, {
                room: roomManager.toRoomView(rr, contentData),
                players: roomManager.getPlayerViews(rr, byNick.playerId),
                ownCharacter: rp.character ?? null,
                game: null,
              } satisfies RoomStatePayload);
              const namePrediction = getCachedPrediction(room.roomId);
              if (namePrediction) {
                socket.emit(EVENTS.SURVIVAL_PREDICTION, { prediction: namePrediction });
              }
              socket.to(room.roomId).emit(EVENTS.PLAYER_RECONNECTED, { playerId: byNick.playerId } satisfies PlayerReconnectedPayload);
              console.log(`[room:join] name-reconnect "${byNick.nickname}" in ${room.roomCode}`);
              return ack({ ok: true, player: roomManager.toPlayerView(rp, rr, byNick.playerId), room: roomManager.toRoomView(rr, contentData), reconnectToken: newRcToken });
            }
          }
          return ack({ ok: false, error: 'GAME_IN_PROGRESS' });
        }

        if (room.players.size >= MAX_PLAYERS) {
          return ack({ ok: false, error: 'ROOM_FULL' });
        }

        if (nickname.trim().length < 2) {
          return ack({ ok: false, error: 'INVALID_NICKNAME' });
        }

        // Handle nickname collision
        const existingNicknames = new Set(
          Array.from(room.players.values()).map((p) => p.nickname),
        );
        const resolvedNickname = roomManager.uniqueNickname(nickname.trim(), existingNicknames);

        const playerId = uuidv4();
        const newSessionToken = randomBytes(32).toString('hex');
        const newReconnectToken = randomBytes(32).toString('hex');
        const now = new Date();

        const newPlayer: Player = {
          playerId,
          roomId: room.roomId,
          nickname: resolvedNickname,
          sessionToken: newSessionToken,
          reconnectToken: newReconnectToken,
          socketId: socket.id,
          status: 'ACTIVE',
          joinedAt: now,
          disconnectedAt: null,
          eliminatedInRound: null,
          character: null,
          revealHistory: [],
        };

        roomStore.updateRoom(room.roomId, (r) => {
          r.players.set(playerId, newPlayer);
          r.lastActivityAt = now;
          return r;
        });

        sessionStore.set(newSessionToken, playerId);
        reconnectStore.set(newReconnectToken, playerId);
        socket.data.playerId = playerId;

        await socket.join(room.roomId);

        // Notify all others of new player
        const playerView = roomManager.toPlayerView(newPlayer, room, playerId);
        const joinedPayload: PlayerJoinedPayload = { player: playerView };
        socket.to(room.roomId).emit(EVENTS.PLAYER_JOINED, joinedPayload);

        emitAnalytics({
          type: 'player_joined',
          roomCode: room.roomCode,
          playerCount: room.players.size,
          timestamp: now.toISOString(),
        });

        // Send full room state (all current players) to the joining socket
        // so they immediately see everyone already in the room, not just themselves.
        const updatedRoom = roomStore.getRoom(room.roomId);
        if (updatedRoom) {
          const statePayload: RoomStatePayload = {
            room: roomManager.toRoomView(updatedRoom, contentData),
            players: roomManager.getPlayerViews(updatedRoom, playerId),
            ownCharacter: null,
            game: null,
          };
          socket.emit(EVENTS.ROOM_STATE, statePayload);
        }

        return ack({
          ok: true,
          player: playerView,
          room: roomManager.toRoomView(room),
          reconnectToken: newReconnectToken,
        });
      } catch (err) {
        console.error('[room:join] Unexpected error:', err, {
          socketId: socket.id,
        });
        return ack({ ok: false, error: 'ROOM_NOT_FOUND' });
      }
    },
  );

  // ── disconnect ───────────────────────────────────────────────────────────────
  socket.on('disconnect', (reason: string) => {
    console.log(`[disconnect] ${socket.id} reason=${reason}`);

    const playerId = socket.data.playerId;
    if (!playerId) return;

    const found = roomManager.findPlayerById(playerId);
    if (!found) return;

    const { room, player } = found;

    if (room.state === 'LOBBY') {
      handleLobbyDisconnect(room.roomId, playerId);
    } else if (room.state !== 'ENDED') {
      handleInGameDisconnect(room.roomId, player);
    }
  });

  /**
   * Handles player disconnect in lobby: remove immediately.
   * If the disconnecting player is the host and other players remain,
   * transfer host to the longest-connected player.
   */
  function handleLobbyDisconnect(roomId: string, playerId: string): void {
    const room = roomStore.getRoom(roomId);
    if (!room) return;

    const wasHost = room.hostPlayerId === playerId;
    roomStore.updateRoom(roomId, (r) => {
      r.players.delete(playerId);
      r.lastActivityAt = new Date();
      return r;
    });

    const updatedRoom = roomStore.getRoom(roomId);
    if (!updatedRoom) return;

    let newHostId: string | null = null;

    if (wasHost && updatedRoom.players.size > 0) {
      newHostId = findLongestConnectedPlayer(updatedRoom.roomId);
      if (newHostId) {
        roomStore.updateRoom(roomId, (r) => {
          r.hostPlayerId = newHostId!;
          return r;
        });
        const transferred: HostTransferredPayload = {
          newHostId,
          reason: 'DISCONNECT_TIMEOUT',
        };
        io.to(roomId).emit(EVENTS.HOST_TRANSFERRED, transferred);
      }
    }

    const leftPayload: PlayerLeftPayload = { playerId, newHostId };
    io.to(roomId).emit(EVENTS.PLAYER_LEFT, leftPayload);
  }

  /**
   * Handles player disconnect mid-game.
   * Sets RECONNECTING status and starts:
   * - 5-min auto-elimination timer
   * - If host: 60-sec host-transfer timer
   */
  function handleInGameDisconnect(roomId: string, player: Player): void {
    const playerId = player.playerId;

    // Skip spectators — they don't affect game state
    if (player.status === 'SPECTATOR' || player.status === 'KICKED') return;

    roomStore.updateRoom(roomId, (r) => {
      const p = r.players.get(playerId);
      if (p) {
        r.players.set(playerId, {
          ...p,
          status: 'RECONNECTING',
          disconnectedAt: new Date(),
          socketId: null,
        });
        r.lastActivityAt = new Date();
      }
      return r;
    });

    const reconnectingPayload: PlayerReconnectingPayload = { playerId };
    io.to(roomId).emit(EVENTS.PLAYER_RECONNECTING, reconnectingPayload);

    // Start 5-minute auto-elimination timer
    timerService.startReconnectTimer(roomId, playerId, RECONNECT_HOLD_SECONDS, () => {
      autoEliminatePlayer(roomId, playerId);
    });

    // If this player is the host, start 60-sec host-transfer timer
    const room = roomStore.getRoom(roomId);
    if (room && room.hostPlayerId === playerId) {
      timerService.startHostTransferTimer(roomId, HOST_TRANSFER_SECONDS, () => {
        transferHostRole(roomId, playerId);
      });
    }
  }

  /**
   * Auto-eliminates a player after 5-minute reconnect hold expires.
   * Per GAME_RULES.md: if multiple disconnect at same time, only the FIRST
   * to exceed the limit is eliminated; others return to ACTIVE.
   */
  function autoEliminatePlayer(roomId: string, playerId: string): void {
    const room = roomStore.getRoom(roomId);
    if (!room || room.state === 'ENDED' || room.state === 'LOBBY') return;

    const player = room.players.get(playerId);
    if (!player || player.status !== 'RECONNECTING') return;

    // Check if a round elimination has already occurred this round
    const roundIndex = (room.currentRound ?? 1) - 1;
    const round = room.game?.rounds[roundIndex];
    if (round?.eliminatedPlayerId) {
      // An elimination already happened — return this player to ACTIVE
      roomStore.updateRoom(roomId, (r) => {
        const p = r.players.get(playerId);
        if (p) r.players.set(playerId, { ...p, status: 'ACTIVE', disconnectedAt: null });
        return r;
      });
      return;
    }

    if (!room.currentRound) return;

    // Reveal full character card
    roomStore.updateRoom(roomId, (r) => {
      const p = r.players.get(playerId);
      if (!p?.character) return r;
      const traits = { ...p.character.traits };
      for (const cat of Object.keys(traits) as Array<keyof typeof traits>) {
        traits[cat] = { ...traits[cat], isRevealed: true };
      }
      r.players.set(playerId, {
        ...p,
        status: 'SPECTATOR',
        eliminatedInRound: room.currentRound!,
        character: { ...p.character, traits },
      });
      const rd = r.game?.rounds[room.currentRound! - 1];
      if (rd) {
        rd.eliminatedPlayerId = playerId;
        rd.autoEliminationTriggered = true;
      }
      r.lastActivityAt = new Date();
      return r;
    });

    const updatedRoom = roomStore.getRoom(roomId)!;
    const eliminatedPlayer = updatedRoom.players.get(playerId)!;

    const elimPayload: PlayerEliminatedPayload = {
      playerId,
      eliminatedInRound: room.currentRound,
      fullCharacter: eliminatedPlayer.character!,
      reason: 'AUTO_TIMEOUT',
    };
    io.to(roomId).emit(EVENTS.PLAYER_ELIMINATED, elimPayload);

    // Advance game after auto-elimination
    advanceAfterElimination(roomId, room.currentRound);
  }

  /**
   * Advances the game state after an elimination (same logic as voteHandlers).
   */
  function advanceAfterElimination(roomId: string, roundNumber: 1 | 2 | 3): void {
    const room = roomStore.getRoom(roomId);
    if (!room) return;

    if (roundNumber === 3) {
      const allPlayers = [...room.players.values()];
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
        survivors: survivors.map((p) => roomManager.toPlayerView(p, room, p.playerId)),
        eliminated: eliminated.map((p) => roomManager.toPlayerView(p, room, p.playerId)),
        outcomeSummary,
      });
    } else {
      // Cancel any active vote/debate timers — round is skipped
      timerService.cancelTimer(roomId);
      const nextReveal = roundNumber === 1 ? 'R2_REVEAL' : 'R3_REVEAL';
      gsm.transitionTo(roomId, nextReveal);
    }
  }

  /**
   * Transfers host role to the longest-connected non-eliminated player.
   * Called after 60-sec host-transfer timer expires.
   */
  function transferHostRole(roomId: string, oldHostId: string): void {
    const room = roomStore.getRoom(roomId);
    if (!room) return;

    // If the old host somehow reconnected before timer fired — do nothing
    const oldHost = room.players.get(oldHostId);
    if (oldHost && oldHost.status === 'ACTIVE') return;

    const newHostId = findLongestConnectedPlayer(roomId);
    if (!newHostId) return;

    roomStore.updateRoom(roomId, (r) => {
      r.hostPlayerId = newHostId;
      r.lastActivityAt = new Date();
      return r;
    });

    const transferred: HostTransferredPayload = {
      newHostId,
      reason: 'DISCONNECT_TIMEOUT',
    };
    io.to(roomId).emit(EVENTS.HOST_TRANSFERRED, transferred);
  }

  /**
   * Finds the player with the earliest joinedAt who is ACTIVE or RECONNECTING.
   * Used for host transfer and host tiebreaker fallback.
   */
  function findLongestConnectedPlayer(roomId: string): string | null {
    const room = roomStore.getRoom(roomId);
    if (!room) return null;

    const candidates = [...room.players.values()]
      .filter((p) => p.status === 'ACTIVE' || p.status === 'RECONNECTING')
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

    return candidates[0]?.playerId ?? null;
  }
}
