/**
 * AdminConfigService — watches admin.json and applies host overrides.
 *
 * The admin edits admin.json (at the project root) to change who is the host
 * in a live room without recreating it. The server polls the file every 2s
 * and emits host:transferred when it detects a new or changed override.
 *
 * admin.json format:
 *   {
 *     "hostOverrides": {
 *       "ROOMCODE": "nickname"
 *     }
 *   }
 */

import { readFileSync, writeFileSync, watchFile } from 'fs';
import { resolve, dirname } from 'path';
import type { Server } from 'socket.io';
import { EVENTS } from '@bunker/shared';
import type { HostTransferredPayload } from '@bunker/shared';
import type { IRoomStore } from '../store/RoomStore.js';

interface AdminConfigData {
  hostOverrides: Record<string, string>;
}

interface RoomStatus {
  roomCode: string;
  state: string;
  host: string;
  players: string[];
}

export class AdminConfigService {
  private data: AdminConfigData = { hostOverrides: {} };

  constructor(
    private readonly configPath: string,
    private readonly io: Server,
    private readonly roomStore: IRoomStore,
  ) {
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const overrides = parsed['hostOverrides'];
      this.data = {
        hostOverrides:
          overrides && typeof overrides === 'object' && !Array.isArray(overrides)
            ? (overrides as Record<string, string>)
            : {},
      };
    } catch {
      // File missing or malformed — leave defaults
    }
  }

  start(): void {
    watchFile(this.configPath, { interval: 2000 }, () => {
      const prev = { ...this.data.hostOverrides };
      this.load();
      for (const [code, nick] of Object.entries(this.data.hostOverrides)) {
        if (prev[code] !== nick) {
          this.applyOverride(code, nick);
        }
      }
    });

    // Write room status to admin-status.json every 5 seconds so admin can see live state
    const statusPath = resolve(dirname(this.configPath), 'admin-status.json');
    setInterval(() => { this.writeStatus(statusPath); }, 5000);
    this.writeStatus(statusPath);

    console.log(`[AdminConfig] Watching ${this.configPath}`);
    console.log(`[AdminConfig] Room status at ${statusPath}`);
  }

  private writeStatus(statusPath: string): void {
    try {
      const rooms = this.roomStore.getAllRooms().map((room) => {
        const host = room.players.get(room.hostPlayerId);
        return {
          roomCode: room.roomCode,
          state: room.state,
          host: host?.nickname ?? '—',
          players: Array.from(room.players.values())
            .filter((p) => p.status !== 'KICKED')
            .map((p) => ({
              nickname: p.nickname,
              status: p.status,
              isHost: p.playerId === room.hostPlayerId,
            })),
        };
      });
      writeFileSync(statusPath, JSON.stringify({ updatedAt: new Date().toISOString(), rooms }, null, 2), 'utf8');
    } catch {
      // Non-fatal — status write failure doesn't affect gameplay
    }
  }

  private applyOverride(roomCode: string, nickname: string): void {
    const room = this.roomStore.getRoomByCode(roomCode.toUpperCase());
    if (!room) {
      console.log(`[AdminConfig] Room ${roomCode} not found — override skipped`);
      return;
    }

    const target = Array.from(room.players.values()).find(
      (p) =>
        p.nickname.toLowerCase() === nickname.toLowerCase() &&
        (p.status === 'ACTIVE' || p.status === 'RECONNECTING'),
    );

    if (!target) {
      console.log(`[AdminConfig] Player "${nickname}" not in room ${roomCode} — override skipped`);
      return;
    }

    if (target.playerId === room.hostPlayerId) {
      return; // already host
    }

    this.roomStore.updateRoom(room.roomId, (r) => {
      r.hostPlayerId = target.playerId;
      r.lastActivityAt = new Date();
      return r;
    });

    const payload: HostTransferredPayload = {
      newHostId: target.playerId,
      reason: 'DISCONNECT_TIMEOUT',
    };
    this.io.to(room.roomId).emit(EVENTS.HOST_TRANSFERRED, payload);

    console.log(`[AdminConfig] Host of ${roomCode} transferred to "${target.nickname}"`);
  }

  getRoomsStatus(): RoomStatus[] {
    return this.roomStore.getAllRooms().map((room) => {
      const host = room.players.get(room.hostPlayerId);
      return {
        roomCode: room.roomCode,
        state: room.state,
        host: host?.nickname ?? '—',
        players: Array.from(room.players.values())
          .filter((p) => p.status !== 'KICKED')
          .map((p) =>
            `${p.nickname}${p.playerId === room.hostPlayerId ? ' [host]' : ''}`,
          ),
      };
    });
  }
}
