/**
 * Socket.IO handlers for room join, leave, and reconnect events.
 * This is the entry point for all players — the same handler
 * serves first-time join and reconnect, distinguished by sessionToken presence.
 */

import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import {
  EVENTS,
  MIN_PLAYERS,
  MAX_PLAYERS,
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
} from '@bunker/shared';
import type { IRoomStore } from '../../store/RoomStore.js';
import type { ISessionStore } from '../../store/SessionStore.js';
import type { IReconnectStore } from '../../store/ReconnectStore.js';
import { RoomManager } from '../../services/RoomManager.js';

// Zod schema for room:join payload validation
const roomJoinSchema = z.object({
  roomCode: z.string().regex(/^[A-Z0-9]{6}$/, 'Invalid room code format'),
  nickname: z.string().trim().min(2).max(20),
  sessionToken: z.string().nullable(),
});

interface HandlerDeps {
  io: Server;
  roomStore: IRoomStore;
  sessionStore: ISessionStore;
  reconnectStore: IReconnectStore;
  roomManager: RoomManager;
}

export function registerRoomHandlers(socket: Socket, deps: HandlerDeps): void {
  const { io, roomStore, sessionStore, reconnectStore, roomManager } = deps;

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
            if (found && found.player.status === 'RECONNECTING') {
              const { room, player } = found;
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
                const statePayload: RoomStatePayload = {
                  room: roomManager.toRoomView(updatedRoom),
                  players: roomManager.getPlayerViews(updatedRoom, existingPlayerId),
                  ownCharacter: player.character,
                  game: null, // GameView constructed elsewhere
                };
                socket.emit(EVENTS.ROOM_STATE, statePayload);

                const reconnectedPayload: PlayerReconnectedPayload = {
                  playerId: existingPlayerId,
                };
                socket.to(room.roomId).emit(EVENTS.PLAYER_RECONNECTED, reconnectedPayload);
              }

              return ack({
                ok: true,
                player: roomManager.toPlayerView(player, room, existingPlayerId),
                room: roomManager.toRoomView(room),
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
          return ack({ ok: false, error: 'GAME_IN_PROGRESS' });
        }

        if (room.players.size >= MAX_PLAYERS) {
          return ack({ ok: false, error: 'ROOM_FULL' });
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
      // Remove player from lobby immediately
      roomStore.updateRoom(room.roomId, (r) => {
        r.players.delete(playerId);
        r.lastActivityAt = new Date();
        return r;
      });

      const leftPayload: PlayerLeftPayload = {
        playerId,
        newHostId: null, // host transfer handled by TimerService (future task)
      };
      io.to(room.roomId).emit(EVENTS.PLAYER_LEFT, leftPayload);
    } else {
      // In-game: hold slot for 5 minutes
      roomStore.updateRoom(room.roomId, (r) => {
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
      io.to(room.roomId).emit(EVENTS.PLAYER_RECONNECTING, reconnectingPayload);

      // TODO: start 5-minute auto-elimination timer (TimerService — future task)
      // TODO: if player is host, start 60-second host-transfer timer
    }
  });
}
