/**
 * Integration test for the room:join socket event.
 * Tests: first-time join, room not found, room full.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, Socket } from 'socket.io-client';
import { EVENTS } from '@bunker/shared';
import type { RoomJoinPayload, RoomJoinAck } from '@bunker/shared';
import { InMemoryRoomStore } from '../store/RoomStore.js';
import { InMemorySessionStore } from '../store/SessionStore.js';
import { InMemoryReconnectStore } from '../store/ReconnectStore.js';
import { RoomManager } from '../services/RoomManager.js';
import { GameStateMachine } from '../services/GameStateMachine.js';
import { TimerService } from '../services/TimerService.js';
import { createSocketMiddleware } from '../socket/middleware.js';
import { registerRoomHandlers } from '../socket/handlers/roomHandlers.js';

let io: SocketIOServer;
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
  io = new SocketIOServer(httpServer, { cors: { origin: '*' } });
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
  io.close();
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

describe('room:join socket handler', () => {
  it('first-time join: player added to room', async () => {
    const { roomCode } = roomManager.createRoom('Host');

    const client = connectClient();
    await waitConnected(client);

    const ack = await new Promise<RoomJoinAck>((resolve) => {
      const payload: RoomJoinPayload = { roomCode, nickname: 'Гравець', sessionToken: null };
      client.emit(EVENTS.ROOM_JOIN, payload, resolve);
    });

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.player.nickname).toBe('Гравець');
      expect(ack.room.state).toBe('LOBBY');
      expect(ack.reconnectToken).toHaveLength(64);
    }

    client.disconnect();
  });

  it('returns ROOM_NOT_FOUND for non-existent room', async () => {
    const client = connectClient();
    await waitConnected(client);

    const ack = await new Promise<RoomJoinAck>((resolve) => {
      const payload: RoomJoinPayload = { roomCode: 'ZZZZZZ', nickname: 'Гравець', sessionToken: null };
      client.emit(EVENTS.ROOM_JOIN, payload, resolve);
    });

    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.error).toBe('ROOM_NOT_FOUND');

    client.disconnect();
  });

  it('other players receive player:joined event', async () => {
    const { roomCode, sessionToken } = roomManager.createRoom('Host');

    // Host joins via socket first
    const host = connectClient({ sessionToken, reconnectToken: null });
    await waitConnected(host);

    await new Promise<RoomJoinAck>((resolve) => {
      host.emit(EVENTS.ROOM_JOIN, { roomCode, nickname: 'Host', sessionToken }, resolve);
    });

    // Set up listener for player:joined on host
    const joinedPromise = new Promise<{ player: { nickname: string } }>((resolve) => {
      host.once(EVENTS.PLAYER_JOINED, resolve);
    });

    // Second player joins
    const player2 = connectClient();
    await waitConnected(player2);
    await new Promise<RoomJoinAck>((resolve) => {
      player2.emit(EVENTS.ROOM_JOIN, { roomCode, nickname: 'Другий', sessionToken: null }, resolve);
    });

    const joined = await joinedPromise;
    expect(joined.player.nickname).toBe('Другий');

    host.disconnect();
    player2.disconnect();
  });
});
