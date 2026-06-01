/**
 * RoomManager — central coordinator for room lifecycle.
 * Handles room creation and provides player-view serialisation.
 * Socket.IO event handling delegates to roomHandlers.ts.
 */

import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
  Room,
  Player,
  PlayerView,
  RoomView,
  TraitSlot,
} from '@bunker/shared';
import {
  ROOM_CODE_CHARSET,
  ROOM_CODE_LENGTH,
} from '@bunker/shared';
import type { IRoomStore } from '../store/RoomStore.js';
import type { ISessionStore } from '../store/SessionStore.js';
import type { IReconnectStore } from '../store/ReconnectStore.js';
import type { CreateRoomResponse } from '@bunker/shared';

// Maximum retries for room code generation on collision
const MAX_CODE_RETRIES = 10;

export class RoomManager {
  constructor(
    private readonly roomStore: IRoomStore,
    private readonly sessionStore: ISessionStore,
    private readonly reconnectStore: IReconnectStore,
  ) {}

  /**
   * Generates a 6-char room code from the safe character set.
   * Uses crypto.randomBytes for cryptographic randomness — never Math.random.
   * Retries on collision with an existing code.
   * Excludes ambiguous characters O, I, 0, 1 (already excluded in ROOM_CODE_CHARSET).
   */
  generateRoomCode(): string {
    for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
      const code = this.generateCode();
      if (!this.roomStore.getRoomByCode(code)) {
        return code;
      }
    }
    throw new Error('Failed to generate unique room code after max retries');
  }

  private generateCode(): string {
    const bytes = randomBytes(ROOM_CODE_LENGTH);
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      // Use modulo to map byte to charset index
      // ROOM_CODE_CHARSET.length is 32, so bias is negligible
      const byte = bytes[i];
      if (byte === undefined) throw new Error('randomBytes returned insufficient bytes');
      code += ROOM_CODE_CHARSET[byte % ROOM_CODE_CHARSET.length];
    }
    return code;
  }

  /**
   * Creates a new room and the host's player slot.
   * Called by POST /api/rooms.
   */
  createRoom(nickname: string): CreateRoomResponse {
    const roomId = uuidv4();
    const roomCode = this.generateRoomCode();
    const playerId = uuidv4();
    const sessionToken = randomBytes(32).toString('hex'); // 64-char hex
    const reconnectToken = randomBytes(32).toString('hex'); // 64-char hex
    const now = new Date();

    const player: Player = {
      playerId,
      roomId,
      nickname: nickname.trim(),
      sessionToken,
      reconnectToken,
      socketId: null, // set when socket connects via room:join
      status: 'ACTIVE',
      joinedAt: now,
      disconnectedAt: null,
      eliminatedInRound: null,
      character: null,
      revealHistory: [],
    };

    const room: Room = {
      roomId,
      roomCode,
      hostPlayerId: playerId,
      state: 'LOBBY',
      currentRound: null,
      currentPhase: null,
      scenarioId: null,
      players: new Map([[playerId, player]]),
      game: null,
      createdAt: now,
      lastActivityAt: now,
      hostUserId: null, // Phase 2 FK placeholder
    };

    this.roomStore.createRoom(room);
    this.sessionStore.set(sessionToken, playerId);
    this.reconnectStore.set(reconnectToken, playerId);

    return {
      roomId,
      roomCode,
      roomUrl: `/r/${roomCode}`,
      playerId,
      sessionToken,
      reconnectToken,
    };
  }

  /**
   * Generates a unique nickname by appending a numeric suffix if needed.
   * E.g., "Аня" → "Аня (2)" if "Аня" already exists in the room.
   */
  uniqueNickname(base: string, existingNicknames: Set<string>): string {
    if (!existingNicknames.has(base)) return base;
    let counter = 2;
    while (existingNicknames.has(`${base} (${counter})`)) {
      counter++;
    }
    return `${base} (${counter})`;
  }

  /**
   * Builds a PlayerView (safe client projection) from a Player.
   * visibleTraits contains only revealed traits unless the viewer IS the player
   * or the player is eliminated (full card exposed on elimination).
   */
  toPlayerView(player: Player, room: Room, viewerPlayerId: string): PlayerView {
    const isSelf = player.playerId === viewerPlayerId;
    const isEliminated = player.status === 'SPECTATOR';

    let visibleTraits: TraitSlot[] = [];
    if (player.character) {
      const slots = Object.values(player.character.traits) as TraitSlot[];
      if (isSelf || isEliminated) {
        visibleTraits = slots;
      } else {
        visibleTraits = slots.filter((slot) => slot.isRevealed);
      }
    }

    return {
      playerId: player.playerId,
      nickname: player.nickname,
      status: player.status,
      isHost: player.playerId === room.hostPlayerId,
      eliminatedInRound: player.eliminatedInRound,
      visibleTraits,
    };
  }

  /**
   * Builds a RoomView (safe client projection) from a Room.
   */
  toRoomView(room: Room): RoomView {
    return {
      roomCode: room.roomCode,
      state: room.state,
      currentRound: room.currentRound,
      currentPhase: room.currentPhase,
      scenario: null, // filled in with ContentData when game is active
      playerCount: room.players.size,
    };
  }

  /**
   * Returns all players in a room as PlayerViews for the given viewer.
   */
  getPlayerViews(room: Room, viewerPlayerId: string): PlayerView[] {
    return Array.from(room.players.values()).map((player) =>
      this.toPlayerView(player, room, viewerPlayerId),
    );
  }

  /**
   * Looks up a player by their socket ID across all rooms.
   * Used in disconnect handlers.
   */
  findPlayerBySocketId(socketId: string): { room: Room; player: Player } | undefined {
    for (const room of this.roomStore.getAllRooms()) {
      for (const player of room.players.values()) {
        if (player.socketId === socketId) {
          return { room, player };
        }
      }
    }
    return undefined;
  }

  /**
   * Looks up a player by their playerId across all rooms.
   */
  findPlayerById(playerId: string): { room: Room; player: Player } | undefined {
    for (const room of this.roomStore.getAllRooms()) {
      const player = room.players.get(playerId);
      if (player) return { room, player };
    }
    return undefined;
  }
}
