/**
 * RoomExpiryService — background job that cleans up idle rooms.
 *
 * Per BACKLOG 2.3.2: a room with zero connected players that has been
 * inactive for 30 minutes is removed from memory. This prevents unbounded
 * growth in the rooms Map for long-running server processes.
 *
 * WHY a separate service (not inline in TimerService):
 * This is a global sweep, not per-room. It runs independently of game state.
 */

import type { IRoomStore } from '../store/RoomStore.js';
import type { TimerService } from './TimerService.js';

/** Rooms idle for this long are removed (milliseconds) */
const ROOM_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

/** How often to check for expired rooms (milliseconds) */
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

export class RoomExpiryService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly roomStore: IRoomStore,
    private readonly timerService: TimerService,
  ) {}

  /**
   * Starts the periodic expiry sweep.
   * Safe to call multiple times — stops the previous interval first.
   */
  start(): void {
    this.stop();
    this.intervalHandle = setInterval(() => this.sweep(), CHECK_INTERVAL_MS);
  }

  /**
   * Stops the periodic sweep (called on server shutdown).
   */
  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Removes rooms with zero connected players that have been idle > 30 minutes.
   * Cancels all timers for expired rooms before deletion.
   */
  sweep(): void {
    const now = Date.now();
    for (const room of this.roomStore.getAllRooms()) {
      const idleMs = now - room.lastActivityAt.getTime();
      if (idleMs < ROOM_EXPIRY_MS) continue;

      const connectedPlayers = [...room.players.values()].filter(
        (p) => p.socketId !== null,
      );
      if (connectedPlayers.length > 0) continue;

      // Room is idle and has no connected players — safe to remove
      this.timerService.clearAll(room.roomId);
      this.roomStore.deleteRoom(room.roomId);
      console.log(`[RoomExpiry] Removed idle room ${room.roomCode} (${room.roomId})`);
    }
  }
}
