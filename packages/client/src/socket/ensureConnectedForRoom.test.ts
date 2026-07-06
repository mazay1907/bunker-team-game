/**
 * BUGFIX_HOST_DUPLICATE_JOIN — client-side `ensureConnectedForRoom()` unit tests.
 *
 * Covers the contract from Reqs/BUGFIX_HOST_DUPLICATE_JOIN.md Section 3:
 * - No-op branch (already connected, same room).
 * - Fresh-connect branch (not connected at all).
 * - Force-rehandshake branch (connected, different room) — Scenario A/B/C repro.
 * - Disconnect/connect ordering (Scenario F): await 'disconnect' event or ~500ms
 *   timeout fallback, never call connect() synchronously back-to-back with
 *   disconnect().
 * - In-flight queuing: same-room calls collapse, different-room calls queue
 *   (never run two cycles concurrently).
 *
 * The vitest config for this package runs tests in plain Node (no jsdom), so
 * `document.cookie` is polyfilled before importing socket.ts, matching the
 * pattern used by socket.cookieScoping.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Minimal document.cookie polyfill (Node has no DOM) ──────────────────────
let cookieJar: Record<string, string> = {};

function installCookiePolyfill(): void {
  cookieJar = {};
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get cookie(): string {
        return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
      },
      set cookie(value: string) {
        const [pair] = value.split(';');
        const eq = pair!.indexOf('=');
        cookieJar[pair!.slice(0, eq)] = pair!.slice(eq + 1);
      },
    },
  });
}

installCookiePolyfill();

const {
  socket,
  ensureConnectedForRoom,
  getActiveRoomCode,
  __resetConnectionHygieneForTests,
} = await import('./socket.js');

// The real socket.io-client Socket has a reserved-events guard on `.emit()`
// (throws for 'connect'/'disconnect'/'connect_error'), but exposes an internal
// `emitReserved` (aliased to the underlying Emitter's raw `.emit`) precisely to
// let internal engine code fire these events — safe/intended to use from tests
// to simulate connect/disconnect lifecycle without a real network connection.
type ReservedEmitter = { emitReserved: (event: string, ...args: unknown[]) => void };
function fireReserved(event: string, ...args: unknown[]): void {
  (socket as unknown as ReservedEmitter).emitReserved(event, ...args);
}

describe('ensureConnectedForRoom', () => {
  beforeEach(() => {
    installCookiePolyfill();
    __resetConnectionHygieneForTests();
    socket.connected = false;
    vi.restoreAllMocks();
  });

  it('no-op branch: returns immediately if already connected and last handshaked for this room', async () => {
    vi.spyOn(socket, 'connect').mockImplementation(() => {
      socket.connected = true;
      fireReserved('connect');
      return socket;
    });
    vi.spyOn(socket, 'disconnect').mockImplementation(() => {
      socket.connected = false;
      fireReserved('disconnect', 'io client disconnect');
      return socket;
    });

    await ensureConnectedForRoom('aaaa11');
    expect(socket.connect).toHaveBeenCalledTimes(1);

    await ensureConnectedForRoom('AAAA11');
    // Same room (case-insensitive) + still connected → no additional connect/disconnect
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('fresh-connect branch: calls connect() and sets activeRoomCode when not connected', async () => {
    vi.spyOn(socket, 'connect').mockImplementation(() => {
      socket.connected = true;
      fireReserved('connect');
      return socket;
    });
    const disconnectSpy = vi.spyOn(socket, 'disconnect');

    await ensureConnectedForRoom('bbbb22');

    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).not.toHaveBeenCalled();
    expect(getActiveRoomCode()).toBe('BBBB22');
  });

  it('force-rehandshake branch: disconnects then reconnects when connected for a different room', async () => {
    const callOrder: string[] = [];
    vi.spyOn(socket, 'connect').mockImplementation(() => {
      callOrder.push('connect');
      socket.connected = true;
      fireReserved('connect');
      return socket;
    });
    vi.spyOn(socket, 'disconnect').mockImplementation(() => {
      callOrder.push('disconnect');
      socket.connected = false;
      // Simulate the async transport close completing on the next tick.
      setTimeout(() => fireReserved('disconnect', 'io client disconnect'), 0);
      return socket;
    });

    await ensureConnectedForRoom('cccc33');
    expect(getActiveRoomCode()).toBe('CCCC33');

    await ensureConnectedForRoom('dddd44');

    expect(callOrder).toEqual(['connect', 'disconnect', 'connect']);
    expect(getActiveRoomCode()).toBe('DDDD44');
  });

  it('Scenario F: never calls connect() synchronously back-to-back with disconnect() — awaits the disconnect event first', async () => {
    let connectCalledAt: number | null = null;
    let disconnectResolvedAt: number | null = null;

    vi.spyOn(socket, 'connect').mockImplementation(() => {
      connectCalledAt = Date.now();
      socket.connected = true;
      fireReserved('connect');
      return socket;
    });
    vi.spyOn(socket, 'disconnect').mockImplementation(() => {
      socket.connected = false;
      // Delay the 'disconnect' event to prove connect() waits for it.
      setTimeout(() => {
        disconnectResolvedAt = Date.now();
        fireReserved('disconnect', 'io client disconnect');
      }, 20);
      return socket;
    });

    await ensureConnectedForRoom('eeee55');
    await ensureConnectedForRoom('ffff66');

    expect(disconnectResolvedAt).not.toBeNull();
    expect(connectCalledAt).not.toBeNull();
    expect(connectCalledAt as unknown as number).toBeGreaterThanOrEqual(disconnectResolvedAt as unknown as number);
  });

  it('Scenario F: falls back to the ~500ms timeout if the disconnect event never fires', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(socket, 'connect').mockImplementation(() => {
        socket.connected = true;
        fireReserved('connect');
        return socket;
      });
      vi.spyOn(socket, 'disconnect').mockImplementation(() => {
        socket.connected = false;
        // Never fires 'disconnect' — timeout fallback must still resolve.
        return socket;
      });

      await ensureConnectedForRoom('gggg77');

      const cyclePromise = ensureConnectedForRoom('hhhh88');
      let settled = false;
      void cyclePromise.then(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(499);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(50);
      await cyclePromise;
      expect(settled).toBe(true);
      expect(socket.connect).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('in-flight queuing: collapses concurrent same-room calls onto one promise', async () => {
    let resolveConnect: (() => void) | null = null;
    vi.spyOn(socket, 'connect').mockImplementation(() => {
      // connect() resolves asynchronously — held open deliberately to prove
      // both calls collapse onto the SAME in-flight cycle, not two.
      resolveConnect = () => {
        socket.connected = true;
        fireReserved('connect');
      };
      return socket;
    });

    const first = ensureConnectedForRoom('iiii99');
    const second = ensureConnectedForRoom('IIII99');

    expect(socket.connect).toHaveBeenCalledTimes(1);
    resolveConnect!();
    await Promise.all([first, second]);
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('in-flight queuing: a different-room call while one is in-flight is queued, never run concurrently', async () => {
    const events: string[] = [];
    vi.spyOn(socket, 'connect').mockImplementation(() => {
      events.push(`connect:${getActiveRoomCode() ?? ''}`);
      socket.connected = true;
      fireReserved('connect');
      return socket;
    });
    vi.spyOn(socket, 'disconnect').mockImplementation(() => {
      events.push(`disconnect:${getActiveRoomCode() ?? ''}`);
      socket.connected = false;
      setTimeout(() => fireReserved('disconnect', 'io client disconnect'), 0);
      return socket;
    });

    // First call for room JJJJ00 (fresh connect, not yet connected).
    const p1 = ensureConnectedForRoom('jjjj00');
    // Second call arrives immediately for a DIFFERENT room — must queue, not
    // interleave with the first cycle's disconnect/connect.
    const p2 = ensureConnectedForRoom('kkkk11');

    await Promise.all([p1, p2]);

    // The queued call for KKKK11 must run its own full disconnect→connect
    // cycle strictly AFTER the first cycle settled — never interleaved.
    expect(events).toEqual([
      'connect:JJJJ00',
      'disconnect:KKKK11',
      'connect:KKKK11',
    ]);
    expect(getActiveRoomCode()).toBe('KKKK11');
  });
});
