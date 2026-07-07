/**
 * Connection hygiene (BUGFIX_HOST_DUPLICATE_JOIN) — extracted from socket.ts to
 * keep that file under the project's 250-line file cap (CLAUDE.md).
 *
 * `createConnectionHygiene()` takes the live socket instance and the
 * `setActiveRoomCode` setter as parameters (rather than importing socket.ts
 * directly) so this module has no dependency on socket.ts — socket.ts is the
 * only thing that imports this module, avoiding a circular import between
 * the two files.
 */

import type { Socket } from 'socket.io-client';

/** ~5s timeout for the connect()/connect_error race — matches prior inline call-site behavior. */
const CONNECT_TIMEOUT_MS = 5000;

/** ~500ms fallback if the 'disconnect' event never fires (Scenario F). */
const DISCONNECT_AWAIT_TIMEOUT_MS = 500;

export interface ConnectionHygiene {
  ensureConnectedForRoom: (roomCode: string) => Promise<void>;
  __resetConnectionHygieneForTests: () => void;
}

/**
 * Builds the `ensureConnectedForRoom` state machine bound to a specific
 * socket instance and room-code setter.
 *
 * Contract (BUGFIX_HOST_DUPLICATE_JOIN, Section 3):
 * - No-op if already connected and last handshaked for this exact room.
 * - Fresh `connect()` if not connected at all.
 * - Disconnect-then-reconnect if connected but handshaked for a different room
 *   (awaits the 'disconnect' event or a ~500ms timeout before reconnecting).
 * - Same-room concurrent calls collapse onto one in-flight promise; a call for
 *   a DIFFERENT room while one is in-flight is queued behind it, never run
 *   concurrently.
 */
export function createConnectionHygiene(
  socket: Socket,
  setActiveRoomCode: (code: string | null) => void,
): ConnectionHygiene {
  // The room code the live connection last actually completed a handshake for.
  // The caller's "active" room code is "intent" (set before we try); this is
  // "fact" (set only after a connect/handshake cycle has actually succeeded).
  let lastHandshakedRoomCode: string | null = null;

  // In-flight cycle guard — collapses concurrent same-room calls (React StrictMode
  // double-invoke) onto one promise, and serializes different-room calls so at most
  // one disconnect/connect cycle ever runs at a time (see module doc + spec Section 3).
  let inFlight: Promise<void> | null = null;
  let inFlightRoom: string | null = null;

  function awaitConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (socket.connected) { resolve(); return; }
      const timeout = setTimeout(() => reject(new Error('connect timeout')), CONNECT_TIMEOUT_MS);
      socket.once('connect', () => { clearTimeout(timeout); resolve(); });
      socket.once('connect_error', (err) => { clearTimeout(timeout); reject(err); });
    });
  }

  /**
   * Awaits either the socket's own 'disconnect' event or a ~500ms timeout fallback,
   * whichever fires first (Scenario F) — never resolves synchronously, so callers
   * never call connect() back-to-back with disconnect() in the same tick.
   */
  function awaitDisconnect(): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const onDisconnect = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.off('disconnect', onDisconnect);
        resolve();
      }, DISCONNECT_AWAIT_TIMEOUT_MS);
      socket.once('disconnect', onDisconnect);
    });
  }

  /** Runs exactly one no-op/fresh-connect/force-rehandshake cycle for `roomCode` (already uppercased). */
  async function runCycle(roomCode: string): Promise<void> {
    // Re-check fresh — for queued different-room calls this must reflect the
    // state AFTER the prior in-flight cycle has settled, not when queued.
    if (socket.connected && lastHandshakedRoomCode === roomCode) {
      return;
    }

    if (!socket.connected) {
      // Fresh-connect branch: first mount, or the socket already dropped.
      setActiveRoomCode(roomCode);
      socket.connect();
      await awaitConnect();
      lastHandshakedRoomCode = roomCode;
      return;
    }

    // Force-rehandshake branch (the actual BUG-2 fix): socket is connected but
    // its last real handshake was for a different room. Never call connect()
    // synchronously back-to-back with disconnect() — await teardown first.
    setActiveRoomCode(roomCode);
    socket.disconnect();
    await awaitDisconnect();
    socket.connect();
    await awaitConnect();
    lastHandshakedRoomCode = roomCode;
  }

  /**
   * Ensures the socket singleton is connected AND has completed its most recent
   * handshake for `roomCode` — the single mandated replacement for every call
   * site's own inline `if (!socket.connected) { connect() }` guard.
   */
  function ensureConnectedForRoom(roomCode: string): Promise<void> {
    const upper = roomCode.toUpperCase();

    if (inFlight && inFlightRoom === upper) {
      return inFlight;
    }

    const prior = inFlight;
    const next: Promise<void> = prior
      ? prior.catch(() => undefined).then(() => runCycle(upper))
      : runCycle(upper);

    inFlight = next;
    inFlightRoom = upper;

    next.finally(() => {
      // Only clear if we're still the current cycle — a newer queued call may
      // have already replaced us while we were pending.
      if (inFlight === next) {
        inFlight = null;
        inFlightRoom = null;
      }
    }).catch(() => undefined);

    return next;
  }

  /** Test-only escape hatch to reset module state between test cases. */
  function __resetConnectionHygieneForTests(): void {
    lastHandshakedRoomCode = null;
    inFlight = null;
    inFlightRoom = null;
  }

  return { ensureConnectedForRoom, __resetConnectionHygieneForTests };
}
