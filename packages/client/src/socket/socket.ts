/**
 * Socket.IO client singleton.
 * Not connected by default — call socket.connect() when needed.
 * Both tokens are stored in cookies (24 h TTL) and injected into the auth handshake.
 *
 * Room-scoped cookies (BUGFIX_SESSION_ROOM_SCOPING):
 * Session/reconnect cookies are namespaced per room code (`bunker_session_<ROOMCODE>` /
 * `bunker_reconnect_<ROOMCODE>`) so a leftover token from a finished game never leaks
 * into a newly-created/joined room. Every page that connects or reconnects the socket
 * must call `setActiveRoomCode(roomCode)` with the room code it knows about (from
 * `useParams` or an HTTP/ack response) BEFORE calling `socket.connect()` or emitting a
 * reconnect — this module has no route context of its own, so the `auth` callback reads
 * the module-level `activeRoomCode` variable to compute the scoped keys at handshake time.
 *
 * Multiple-tab detection (BACKLOG 3.1.3):
 * When a second tab opens with the same session token FOR THE SAME ROOM, the newest tab
 * takes over the active session. The old tab is notified via BroadcastChannel and displays
 * "Сесія перенесена" — it does not crash or throw. Tabs on different rooms never trigger
 * a false transfer notice for each other (the `roomCode` is part of the broadcast payload).
 */

import { io, Socket } from 'socket.io-client';
import { useGameStore } from '../store/gameStore.js';

export const SESSION_TOKEN_KEY = 'bunker_session';
export const RECONNECT_TOKEN_KEY = 'bunker_reconnect';

/** BroadcastChannel name — must match across all tabs */
const SESSION_CHANNEL = 'bunker_session_claim';

/** Cookie TTL: 24 hours */
const COOKIE_TTL_HOURS = 24;

export function setCookie(name: string, value: string, hours = COOKIE_TTL_HOURS): void {
  const expires = new Date(Date.now() + hours * 3_600_000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Strict`;
}

export function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${encodeURIComponent(name)}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Builds the room-scoped session cookie name for a given room code. */
export function sessionKey(roomCode: string): string {
  return `${SESSION_TOKEN_KEY}_${roomCode.toUpperCase()}`;
}

/** Builds the room-scoped reconnect cookie name for a given room code. */
export function reconnectKey(roomCode: string): string {
  return `${RECONNECT_TOKEN_KEY}_${roomCode.toUpperCase()}`;
}

// The room code the app is currently "active" on — set explicitly by each page
// before connecting/reconnecting the socket (see module doc above). This module
// has no router access of its own, so it cannot infer this from the URL.
let activeRoomCode: string | null = null;

/** Sets (or clears, with null) the room code the `auth` callback should scope cookies to. */
export function setActiveRoomCode(code: string | null): void {
  activeRoomCode = code ? code.toUpperCase() : null;
}

/** Returns the room code most recently set via `setActiveRoomCode` (for tests/debugging). */
export function getActiveRoomCode(): string | null {
  return activeRoomCode;
}

function getStoredTokens(): { sessionToken: string | null; reconnectToken: string | null } {
  if (!activeRoomCode) return { sessionToken: null, reconnectToken: null };
  return {
    sessionToken: getCookie(sessionKey(activeRoomCode)),
    reconnectToken: getCookie(reconnectKey(activeRoomCode)),
  };
}

// The socket instance — created once, reused across the app
// autoConnect: false — we control when to connect (after room creation or join)
const socket: Socket = io({
  autoConnect: false,
  // Auth is evaluated at connect() time — reads current cookie values,
  // scoped to whatever room code was last set via setActiveRoomCode()
  auth: (cb: (data: Record<string, string | null>) => void) => {
    const { sessionToken, reconnectToken } = getStoredTokens();
    cb({ sessionToken, reconnectToken });
  },
  // Socket.IO will retry automatically on transient disconnects
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

// ── Multiple-tab detection ───────────────────────────────────────────────────
// BroadcastChannel is widely supported (all modern browsers).
// When this tab claims the session (on connect), all other tabs with the same
// session token are told to yield — they update state to show a transfer notice.

let sessionChannel: BroadcastChannel | null = null;

try {
  sessionChannel = new BroadcastChannel(SESSION_CHANNEL);
} catch {
  // BroadcastChannel not supported — graceful degradation; no multi-tab detection
}

if (sessionChannel) {
  sessionChannel.onmessage = (event: MessageEvent) => {
    const msg = event.data as { type: string; sessionToken: string; roomCode?: string };
    if (msg.type !== 'SESSION_CLAIMED') return;

    // Ignore claims for a different room — two tabs on different rooms must never
    // display a false "session transferred" notice for each other.
    if (!activeRoomCode || msg.roomCode !== activeRoomCode) return;

    const { sessionToken } = getStoredTokens();
    // If a different tab claimed our session token (same room) → we've been displaced
    if (msg.sessionToken && sessionToken && msg.sessionToken === sessionToken) {
      socket.disconnect();
      // Mark session as transferred — UI checks for this specific value
      useGameStore.getState().setLastError('SESSION_TRANSFERRED');
    }
  };
}

/**
 * Broadcast to other tabs that this tab has claimed the session for the given room.
 * `roomCode` must be the room the caller is currently active on — the receiving tabs
 * only react if their own `activeRoomCode` matches (see onmessage handler above).
 */
export function claimSession(roomCode: string): void {
  if (!sessionChannel) return;
  const { sessionToken } = getStoredTokens();
  if (!sessionToken) return;
  sessionChannel.postMessage({ type: 'SESSION_CLAIMED', sessionToken, roomCode: roomCode.toUpperCase() });
}

export { socket };
