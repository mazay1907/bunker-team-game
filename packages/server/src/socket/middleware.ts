/**
 * Socket.IO middleware for session validation.
 * Reads sessionToken and reconnectToken from the handshake auth object.
 * Attaches playerId to socket.data if a session is found.
 * A missing token is allowed — the player hasn't joined a room yet.
 */

import type { Socket } from 'socket.io';
import type { ISessionStore } from '../store/SessionStore.js';

// Extend the socket data type to include our custom fields
declare module 'socket.io' {
  interface SocketData {
    playerId: string | null; // null until player joins a room
    sessionToken: string | null;
    reconnectToken: string | null;
  }
}

export function createSocketMiddleware(sessionStore: ISessionStore) {
  return (socket: Socket, next: (err?: Error) => void): void => {
    const auth = socket.handshake.auth as Record<string, unknown>;
    const sessionToken = typeof auth['sessionToken'] === 'string' ? auth['sessionToken'] : null;
    const reconnectToken =
      typeof auth['reconnectToken'] === 'string' ? auth['reconnectToken'] : null;

    socket.data.sessionToken = sessionToken;
    socket.data.reconnectToken = reconnectToken;

    // Try to resolve playerId from session token
    if (sessionToken) {
      const playerId = sessionStore.get(sessionToken);
      socket.data.playerId = playerId ?? null;
    } else {
      socket.data.playerId = null;
    }

    next();
  };
}
