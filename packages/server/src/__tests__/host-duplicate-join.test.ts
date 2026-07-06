/**
 * BUGFIX_HOST_DUPLICATE_JOIN — Scenario D (server-level defense-in-depth):
 * a first-time-join ROOM_JOIN whose sessionToken matches an existing
 * un-socketed ACTIVE row in the SAME room (the HTTP-pre-inserted host row
 * from POST /api/rooms, before its real socket ever attaches) must be
 * attached to that existing row — never mint a second Player row via
 * uniqueNickname(), regardless of the nickname sent in the payload.
 *
 * Also covers Scenario E (regression safety): the check must be scoped
 * tightly enough that genuine nickname collisions between two DIFFERENT
 * humans still go through uniqueNickname() as before.
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

describe('room:join — orphaned-row sessionToken attach (Scenario D)', () => {
  it('attaches the incoming socket to the pre-inserted host row instead of minting a duplicate', async () => {
    // Simulates POST /api/rooms: host row inserted with socketId: null, never
    // yet attached to any socket — exactly the state left behind by the HTTP
    // room-creation call before the client's socket connects.
    const created = roomManager.createRoom('1111');

    const client = connectClient({ sessionToken: created.sessionToken, reconnectToken: null });
    await waitConnected(client);

    const ack = await new Promise<RoomJoinAck>((resolve) => {
      const payload: RoomJoinPayload = {
        roomCode: created.roomCode,
        nickname: '1111',
        sessionToken: created.sessionToken,
      };
      client.emit(EVENTS.ROOM_JOIN, payload, resolve);
    });

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      // Attached to the SAME playerId the HTTP call minted — not a new row.
      expect(ack.player.playerId).toBe(created.playerId);
      expect(ack.player.nickname).toBe('1111');
      expect(ack.player.isHost).toBe(true);
    }

    // Exactly one player row — no "1111 (2)" duplicate.
    const room = roomStore.getRoomByCode(created.roomCode);
    expect(room?.players.size).toBe(1);
    const soleRow = [...(room?.players.values() ?? [])][0];
    expect(soleRow?.nickname).toBe('1111');
    expect(soleRow?.playerId).toBe(created.playerId);

    client.disconnect();
  });

  it('attaches regardless of the nickname sent in the payload (identity is sessionToken-based, not nickname-based)', async () => {
    const created = roomManager.createRoom('OriginalHost');

    const client = connectClient({ sessionToken: created.sessionToken, reconnectToken: null });
    await waitConnected(client);

    const ack = await new Promise<RoomJoinAck>((resolve) => {
      const payload: RoomJoinPayload = {
        roomCode: created.roomCode,
        nickname: 'SomeOtherName',
        sessionToken: created.sessionToken,
      };
      client.emit(EVENTS.ROOM_JOIN, payload, resolve);
    });

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.player.playerId).toBe(created.playerId);
      // Attach path preserves the row's existing nickname — it does not
      // rename the row to whatever nickname happened to be sent.
      expect(ack.player.nickname).toBe('OriginalHost');
    }

    const room = roomStore.getRoomByCode(created.roomCode);
    expect(room?.players.size).toBe(1);

    client.disconnect();
  });

  it('does NOT intercept a genuine nickname collision between two different humans (Scenario E regression)', async () => {
    const created = roomManager.createRoom('Alice');

    // Host's own socket attaches normally first.
    const host = connectClient({ sessionToken: created.sessionToken, reconnectToken: null });
    await waitConnected(host);
    await new Promise<RoomJoinAck>((resolve) => {
      const payload: RoomJoinPayload = { roomCode: created.roomCode, nickname: 'Alice', sessionToken: created.sessionToken };
      host.emit(EVENTS.ROOM_JOIN, payload, resolve);
    });

    // A second, genuinely different human joins with a colliding nickname and
    // a brand-new (non-matching) sessionToken — must still go through
    // uniqueNickname(), producing "Alice (2)", not attach to the host's row.
    const guest = connectClient({ sessionToken: null, reconnectToken: null });
    await waitConnected(guest);
    const guestAck = await new Promise<RoomJoinAck>((resolve) => {
      const payload: RoomJoinPayload = { roomCode: created.roomCode, nickname: 'Alice', sessionToken: null };
      guest.emit(EVENTS.ROOM_JOIN, payload, resolve);
    });

    expect(guestAck.ok).toBe(true);
    if (guestAck.ok) {
      expect(guestAck.player.nickname).toBe('Alice (2)');
      expect(guestAck.player.playerId).not.toBe(created.playerId);
    }

    const room = roomStore.getRoomByCode(created.roomCode);
    expect(room?.players.size).toBe(2);

    host.disconnect();
    guest.disconnect();
  });

  it('does NOT attach to an orphaned row in a DIFFERENT room even with a matching sessionToken (Scenario G safety)', async () => {
    // Two separate rooms; room A's host sessionToken must never attach to
    // room B's pre-inserted host row (tokens are minted per room, never
    // reused — this simulates the hypothetical-bug case the spec calls out).
    const roomA = roomManager.createRoom('HostA');
    const roomB = roomManager.createRoom('HostB');

    const client = connectClient({ sessionToken: roomA.sessionToken, reconnectToken: null });
    await waitConnected(client);

    const ack = await new Promise<RoomJoinAck>((resolve) => {
      const payload: RoomJoinPayload = { roomCode: roomB.roomCode, nickname: 'Intruder', sessionToken: roomA.sessionToken };
      client.emit(EVENTS.ROOM_JOIN, payload, resolve);
    });

    // roomA's sessionToken doesn't match anything in roomB → ordinary
    // first-time join, brand-new row, room B's original host row untouched.
    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.player.playerId).not.toBe(roomB.playerId);
      expect(ack.player.nickname).toBe('Intruder');
    }

    const updatedRoomB = roomStore.getRoomByCode(roomB.roomCode);
    expect(updatedRoomB?.players.size).toBe(2);
    const originalHostRow = updatedRoomB?.players.get(roomB.playerId);
    expect(originalHostRow?.socketId).toBeNull();

    client.disconnect();
  });
});
