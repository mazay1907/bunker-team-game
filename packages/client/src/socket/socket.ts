/**
 * Socket.IO client singleton.
 * Not connected by default — call socket.connect() when needed.
 * Both tokens are stored in cookies (24 h TTL) and injected into the auth handshake.
 *
 * Multiple-tab detection (BACKLOG 3.1.3):
 * When a second tab opens with the same session token, the newest tab takes over
 * the active session. The old tab is notified via BroadcastChannel and displays
 * "Сесія перенесена" — it does not crash or throw.
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

function getStoredTokens(): { sessionToken: string | null; reconnectToken: string | null } {
  return {
    sessionToken: getCookie(SESSION_TOKEN_KEY),
    reconnectToken: getCookie(RECONNECT_TOKEN_KEY),
  };
}

// The socket instance — created once, reused across the app
// autoConnect: false — we control when to connect (after room creation or join)
const socket: Socket = io({
  autoConnect: false,
  // Auth is evaluated at connect() time — reads current cookie values
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
    const msg = event.data as { type: string; sessionToken: string };
    if (msg.type !== 'SESSION_CLAIMED') return;

    const { sessionToken } = getStoredTokens();
    // If a different tab claimed our session token → we've been displaced
    if (msg.sessionToken && sessionToken && msg.sessionToken === sessionToken) {
      socket.disconnect();
      // Mark session as transferred — UI checks for this specific value
      useGameStore.getState().setLastError('SESSION_TRANSFERRED');
    }
  };
}

/** Broadcast to other tabs that this tab has claimed the session */
export function claimSession(): void {
  if (!sessionChannel) return;
  const { sessionToken } = getStoredTokens();
  if (!sessionToken) return;
  sessionChannel.postMessage({ type: 'SESSION_CLAIMED', sessionToken });
}

export { socket };
