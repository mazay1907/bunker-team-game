/**
 * TimerService — manages server-side countdowns.
 *
 * Responsibilities:
 * - Debate timer (5 min, extendable, cancellable)
 * - Reconnect hold timers (5 min per disconnected player)
 * - Host-transfer timer (60 sec per host disconnect)
 * - Room expiry check (30 min idle)
 * - Emits timer:tick every second during debate
 * - All timer handles cleared on room expiry to prevent memory leaks
 *
 * WHY single Map per room: rooms are independent; cancelling one room's
 * timer must not affect others. NodeJS.Timeout handles are cheap.
 */

import type { Server } from 'socket.io';
import { EVENTS } from '@bunker/shared';
import type { TimerTickPayload, TimerExtendedPayload } from '@bunker/shared';

interface TimerEntry {
  remaining: number;           // seconds remaining
  intervalHandle: ReturnType<typeof setInterval>;
  onExpire: () => void;
}

export class TimerService {
  /** Active debate timers keyed by roomId */
  private readonly timers = new Map<string, TimerEntry>();

  /**
   * One-shot reconnect hold timers: key = `${roomId}:${playerId}`.
   * Fires onExpire after RECONNECT_HOLD_SECONDS if player doesn't reconnect.
   */
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * One-shot host-transfer timers: key = roomId.
   * Fires onExpire after HOST_TRANSFER_SECONDS if host doesn't reconnect.
   */
  private readonly hostTransferTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly io: Server) {}

  /**
   * Starts a debate countdown for a room.
   * If a timer already exists for the room, it is cancelled first.
   * onExpire fires when the countdown reaches zero.
   */
  startDebateTimer(roomId: string, seconds: number, onExpire: () => void): void {
    this.cancelTimer(roomId);

    const entry: TimerEntry = {
      remaining: seconds,
      onExpire,
      intervalHandle: setInterval(() => {
        entry.remaining -= 1;

        const tick: TimerTickPayload = { remaining: entry.remaining };
        this.io.to(roomId).emit(EVENTS.TIMER_TICK, tick);

        if (entry.remaining <= 0) {
          this.cancelTimer(roomId);
          onExpire();
        }
      }, 1000),
    };

    this.timers.set(roomId, entry);
  }

  /**
   * Adds seconds to the current debate timer.
   * Returns the new remaining seconds.
   * Throws if no timer is active for the room.
   */
  extendTimer(roomId: string, additionalSeconds: number): number {
    const entry = this.timers.get(roomId);
    if (!entry) throw new Error(`No active timer for room: ${roomId}`);

    entry.remaining += additionalSeconds;

    const payload: TimerExtendedPayload = { newRemaining: entry.remaining };
    this.io.to(roomId).emit(EVENTS.TIMER_EXTENDED, payload);

    return entry.remaining;
  }

  /**
   * Cancels the debate timer without firing onExpire.
   * Used when host force-advances to vote phase.
   */
  cancelTimer(roomId: string): void {
    const entry = this.timers.get(roomId);
    if (entry) {
      clearInterval(entry.intervalHandle);
      this.timers.delete(roomId);
    }
  }

  /**
   * Returns remaining seconds for the room's debate timer, or null if no timer.
   */
  getRemaining(roomId: string): number | null {
    return this.timers.get(roomId)?.remaining ?? null;
  }

  /**
   * Starts a one-shot reconnect hold timer for a specific player.
   * onExpire fires after `seconds` if not cancelled by clearReconnectTimer.
   */
  startReconnectTimer(roomId: string, playerId: string, seconds: number, onExpire: () => void): void {
    const key = `${roomId}:${playerId}`;
    this.clearReconnectTimer(roomId, playerId);
    const handle = setTimeout(onExpire, seconds * 1000);
    this.reconnectTimers.set(key, handle);
  }

  /**
   * Cancels a player's reconnect hold timer (player reconnected in time).
   */
  clearReconnectTimer(roomId: string, playerId: string): void {
    const key = `${roomId}:${playerId}`;
    const handle = this.reconnectTimers.get(key);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.reconnectTimers.delete(key);
    }
  }

  /**
   * Starts a one-shot host-transfer timer for a room.
   * onExpire fires after `seconds` if the host doesn't reconnect.
   */
  startHostTransferTimer(roomId: string, seconds: number, onExpire: () => void): void {
    this.cancelHostTransferTimer(roomId);
    const handle = setTimeout(onExpire, seconds * 1000);
    this.hostTransferTimers.set(roomId, handle);
  }

  /**
   * Cancels the host-transfer timer (host reconnected in time).
   */
  cancelHostTransferTimer(roomId: string): void {
    const handle = this.hostTransferTimers.get(roomId);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.hostTransferTimers.delete(roomId);
    }
  }

  /**
   * Clears all timers for a room (called on room expiry/cleanup).
   */
  clearAll(roomId: string): void {
    this.cancelTimer(roomId);
    this.cancelHostTransferTimer(roomId);
    // Clear all reconnect timers for this room
    for (const key of this.reconnectTimers.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        clearTimeout(this.reconnectTimers.get(key));
        this.reconnectTimers.delete(key);
      }
    }
  }
}
