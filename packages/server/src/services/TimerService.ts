/**
 * TimerService — manages server-side countdowns.
 *
 * Responsibilities:
 * - Debate timer (5 min, extendable, cancellable)
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
   * Clears all timers for a room (called on room expiry/cleanup).
   */
  clearAll(roomId: string): void {
    this.cancelTimer(roomId);
  }
}
