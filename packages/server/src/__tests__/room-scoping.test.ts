/**
 * BUGFIX_SESSION_ROOM_SCOPING — Scenario E (server-level defense-in-depth):
 * a reconnect token that resolves to a player in room X must NOT be honored
 * when the client's ROOM_JOIN payload requests room Y. The server must fall
 * through to the first-time-join path for Y — same ack shape as a first-time
 * join with no reconnect token at all (never a distinct error, never a
 * reconnect into X).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server as SocketIOServer, type DefaultEventsMap } from 'socket.io';
import { io as ioClient, Socket } from 'socket.io-client';
import { EVENTS } from '@bunker/shared';
import type { RoomJoinPayload, RoomJoinAck } from '@bunker/shared';
import { InMemoryRoomStore } from '../store/RoomStore.js';
import { InMemorySessionStore } from '../store/SessionStore.js';
import { InMemoryReconnectStore } from '../store/ReconnectStore.js';
import { RoomManager } from '../services/RoomManager.js';
import { GameStateMachine } from '../services/GameStateMachine.js';
import { TimerService } from '../services/TimerService.js';
import { createSocketMiddleware, type SocketData } from '../socket/middleware.js';
import { registerRoomHandlers } from '../socket/handlers/roomHandlers.js';

let io: SocketIOServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
let serverPort: number;
let roomStore: InMemoryRoomStore;
let sessionStore: InMemorySessionStore;
let reconnectStore: InMemoryReconnectStore;
let roomManager: RoomManager;

beforeEach(async () => {
  roomStore = new InMemoryRoomStore();
  sessionStore = new InMemorySessionStore();
  reconnectStore = new InMemoryReconnectStore();
  roomManager = new RoomManager(roomStore, sessionStore, reconnectStore);

  const httpServer = createServer();
  io = new SocketIOServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>(httpServer, { cors: { origin: '*' } });
  io.use(createSocketMiddleware(sessionStore));

  const gsm = new GameStateMachine(roomStore, io);
  const timerService = new TimerService(io);

  io.on('connection', (socket) => {
    registerRoomHandlers(socket, { io, roomStore, sessionStore, reconnectStore, roomManager, gsm, timerService });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      serverPort = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
});

afterEach(() => {
  void io.close();
});

function connectClient(auth?: Record<string, string | null>): Socket {
  return ioClient(`http://localhost:${serverPort}`, {
    auth: auth ?? {},
    autoConnect: true,
  });
}

async function waitConnected(socket: Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (socket.connected) { resolve(); return; }
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 3000);
  });
}

describe('room:join — cross-room reconnect token rejection (Scenario E)', () => {
  it('does NOT reconnect into room X when payload requests room Y with a room-X reconnect token', async () => {
    // Room X — an established player with a valid reconnect token
    const { roomCode: roomXCode, sessionToken: hostSessionToken } = roomManager.createRoom('HostX');
    const hostX = connectClient({ sessionToken: hostSessionToken, reconnectToken: null });
    await waitConnected(hostX);
    const hostXAck = await new Promise<RoomJoinAck>((resolve) => {
      hostX.emit(EVENTS.ROOM_JOIN, { roomCode: roomXCode, nickname: 'HostX', sessionToken: hostSessionToken }, resolve);
    });
    expect(hostXAck.ok).toBe(true);
    const roomXReconnectToken = hostXAck.ok ? hostXAck.reconnectToken : '';
    hostX.disconnect();
    // The server processes the disconnect asynchronously over the wire — give
    // it a tick to run handleLobbyDisconnect before snapshotting room X's size.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // hostX was room X's sole player, so their own disconnect in LOBBY removes
    // their row immediately (handleLobbyDisconnect) — this happens regardless
    // of anything the second client below does. Snapshot the post-disconnect
    // size here so we can assert room X is untouched BY THE SECOND CLIENT,
    // independent of hostX's own unrelated disconnect cleanup.
    const roomXSizeAfterHostDisconnect = roomStore.getRoomByCode(roomXCode)?.players.size;

    // Room Y — a brand-new, unrelated room
    const { roomCode: roomYCode } = roomManager.createRoom('HostY');

    // A client connects with room X's reconnect token in auth, but explicitly
    // requests to join room Y with a fresh nickname (first-time-join shape).
    const client = connectClient({ sessionToken: null, reconnectToken: roomXReconnectToken });
    await waitConnected(client);

    const ack = await new Promise<RoomJoinAck>((resolve) => {
      const payload: RoomJoinPayload = { roomCode: roomYCode, nickname: 'Гравець', sessionToken: null };
      client.emit(EVENTS.ROOM_JOIN, payload, resolve);
    });

    // Must succeed as a first-time join into Y, not a reconnect into X.
    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.room.roomCode).toBe(roomYCode);
      expect(ack.player.nickname).toBe('Гравець');
      // A fresh reconnect token distinct from room X's — proof this was a
      // first-time join, not the reconnect branch reusing the old token.
      expect(ack.reconnectToken).not.toBe(roomXReconnectToken);
    }

    // Room X must be untouched by the second client's join attempt — no new
    // row added, no change to its player count from what it was right after
    // hostX's own (unrelated) disconnect.
    const roomXAfter = roomStore.getRoomByCode(roomXCode);
    expect(roomXAfter?.players.size).toBe(roomXSizeAfterHostDisconnect);

    client.disconnect();
  });

  it('falls through to INVALID_NICKNAME (not a distinct error) when no nickname is supplied for the new room', async () => {
    const { roomCode: roomXCode, sessionToken: hostSessionToken } = roomManager.createRoom('HostX');
    const hostX = connectClient({ sessionToken: hostSessionToken, reconnectToken: null });
    await waitConnected(hostX);
    const hostXAck = await new Promise<RoomJoinAck>((resolve) => {
      hostX.emit(EVENTS.ROOM_JOIN, { roomCode: roomXCode, nickname: 'HostX', sessionToken: hostSessionToken }, resolve);
    });
    const roomXReconnectToken = hostXAck.ok ? hostXAck.reconnectToken : '';
    hostX.disconnect();

    const { roomCode: roomYCode } = roomManager.createRoom('HostY');

    const client = connectClient({ sessionToken: null, reconnectToken: roomXReconnectToken });
    await waitConnected(client);

    // Reconnect-style payload (empty nickname) as GamePage's reload effect would send —
    // since the token doesn't match room Y, this must behave exactly like a first-time
    // join attempt with an empty nickname: INVALID_NICKNAME, never a reconnect into X.
    const ack = await new Promise<RoomJoinAck>((resolve) => {
      const payload: RoomJoinPayload = { roomCode: roomYCode, nickname: '', sessionToken: null };
      client.emit(EVENTS.ROOM_JOIN, payload, resolve);
    });

    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.error).toBe('INVALID_NICKNAME');

    client.disconnect();
  });
});
