/**
 * Socket.IO client singleton.
 * Not connected by default — call socket.connect() when needed.
 * Both tokens are read from localStorage and injected into the auth handshake.
 */

import { io, Socket } from 'socket.io-client';

const SESSION_TOKEN_KEY = 'bunker_session';
const RECONNECT_TOKEN_KEY = 'bunker_reconnect';

function getStoredTokens(): { sessionToken: string | null; reconnectToken: string | null } {
  return {
    sessionToken: localStorage.getItem(SESSION_TOKEN_KEY),
    reconnectToken: localStorage.getItem(RECONNECT_TOKEN_KEY),
  };
}

// The socket instance — created once, reused across the app
// autoConnect: false — we control when to connect (after room creation or join)
const socket: Socket = io({
  autoConnect: false,
  // Auth is evaluated at connect() time — reads current localStorage values
  auth: (cb) => {
    const { sessionToken, reconnectToken } = getStoredTokens();
    cb({ sessionToken, reconnectToken });
  },
  // Socket.IO will retry automatically on transient disconnects
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

export { socket, SESSION_TOKEN_KEY, RECONNECT_TOKEN_KEY };
