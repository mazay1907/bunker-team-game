/**
 * Socket.IO middleware for session validation.
 * Reads sessionToken and reconnectToken from the handshake auth object.
 * Attaches playerId to socket.data if a session is found.
 * A missing token is allowed — the player hasn't joined a room yet.
 */

import type { DefaultEventsMap, Socket } from 'socket.io';
import type { ISessionStore } from '../store/SessionStore.js';

/**
 * Shape of `socket.data` for every connection in this app.
 *
 * NOTE: `Socket`'s `SocketData` type param defaults to `any` — there is no
 * ambient interface in the 'socket.io' package that a `declare module`
 * augmentation could merge into, so augmenting the module does nothing here.
 * Instead we define our own interface and thread it through an `AppSocket`
 * alias that every handler imports and uses in place of the bare `Socket`
 * type, which is what actually gives `socket.data.playerId` etc. a real type.
 */
export interface SocketData {
  playerId: string | null; // null until player joins a room
  sessionToken: string | null;
  reconnectToken: string | null;
}

/** The fully-typed Socket used throughout server handlers. */
export type AppSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

export function createSocketMiddleware(sessionStore: ISessionStore) {
  return (socket: AppSocket, next: (err?: Error) => void): void => {
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
