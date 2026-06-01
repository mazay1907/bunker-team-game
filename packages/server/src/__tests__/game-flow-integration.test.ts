/**
 * Integration tests for the full game flow via socket events.
 * Tests: startGame, pickScenario, reveal:submit, vote:submit, elimination.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket } from 'socket.io-client';
import { EVENTS } from '@bunker/shared';
import type {
  RoomJoinPayload,
  RoomJoinAck,
  HostStartGameAck,
  HostPickScenarioAck,
  RevealSubmitAck,
  VoteSubmitAck,
} from '@bunker/shared';
import { InMemoryRoomStore } from '../store/RoomStore.js';
import { InMemorySessionStore } from '../store/SessionStore.js';
import { InMemoryReconnectStore } from '../store/ReconnectStore.js';
import { RoomManager } from '../services/RoomManager.js';
import { GameStateMachine } from '../services/GameStateMachine.js';
import { TimerService } from '../services/TimerService.js';
import { VoteEngine } from '../services/VoteEngine.js';
import { CharacterDealer } from '../services/CharacterDealer.js';
import { ContentData } from '../content/ContentData.js';
import { createSocketMiddleware } from '../socket/middleware.js';
import { registerRoomHandlers } from '../socket/handlers/roomHandlers.js';
import { registerHostHandlers } from '../socket/handlers/hostHandlers.js';
import { registerRevealHandlers } from '../socket/handlers/revealHandlers.js';
import { registerVoteHandlers } from '../socket/handlers/voteHandlers.js';

let io: SocketIOServer;
let serverPort: number;
let roomStore: InMemoryRoomStore;
let sessionStore: InMemorySessionStore;
let reconnectStore: InMemoryReconnectStore;
let roomManager: RoomManager;
let gsm: GameStateMachine;
let timerService: TimerService;
let voteEngine: VoteEngine;
let dealer: CharacterDealer;
let contentData: ContentData;

beforeEach(async () => {
  roomStore = new InMemoryRoomStore();
  sessionStore = new InMemorySessionStore();
  reconnectStore = new InMemoryReconnectStore();
  contentData = new ContentData();
  roomManager = new RoomManager(roomStore, sessionStore, reconnectStore);

  const httpServer = createServer();
  io = new SocketIOServer(httpServer, { cors: { origin: '*' } });
  gsm = new GameStateMachine(roomStore, io);
  timerService = new TimerService(io);
  voteEngine = new VoteEngine();
  dealer = new CharacterDealer();

  io.use(createSocketMiddleware(sessionStore));

  io.on('connection', (socket) => {
    const deps = { io, roomStore, sessionStore, reconnectStore, roomManager, contentData, gsm, timerService, voteEngine, dealer };
    registerRoomHandlers(socket, deps);
    registerHostHandlers(socket, deps);
    registerRevealHandlers(socket, deps);
    registerVoteHandlers(socket, deps);
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
  timerService.clearAll('*'); // best-effort cleanup
  io.close();
});

function connectClient(auth?: Record<string, string | null>): Socket {
  return ioClient(`http://localhost:${serverPort}`, {
    auth: auth ?? {},
    autoConnect: true,
  });
}

async function waitConnected(socket: Socket): Promise<void> {
  if (socket.connected) return;
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 3000);
  });
}

async function joinRoom(client: Socket, roomCode: string, nickname: string, sessionToken: string | null = null): Promise<RoomJoinAck> {
  return new Promise((resolve) => {
    const payload: RoomJoinPayload = { roomCode, nickname, sessionToken };
    client.emit(EVENTS.ROOM_JOIN, payload, resolve);
  });
}

/** Creates N clients all connected and joined to the same room */
async function setupGame(playerCount: number): Promise<{
  clients: Socket[];
  roomCode: string;
  roomId: string;
  playerIds: string[];
}> {
  const hostResp = roomManager.createRoom('Host0');
  const { roomCode, roomId } = hostResp;

  const clients: Socket[] = [];
  const playerIds: string[] = [];

  for (let i = 0; i < playerCount; i++) {
    const client = connectClient(
      i === 0 ? { sessionToken: hostResp.sessionToken, reconnectToken: hostResp.reconnectToken } : {},
    );
    await waitConnected(client);
    const nickname = i === 0 ? 'Host0' : `Player${i}`;
    const st = i === 0 ? hostResp.sessionToken : null;
    const ack = await joinRoom(client, roomCode, nickname, st);
    expect(ack.ok).toBe(true);
    if (ack.ok) playerIds.push(ack.player.playerId);
    clients.push(client);
  }

  return { clients, roomCode, roomId, playerIds };
}

describe('host:startGame + host:pickScenario', () => {
  it('transitions room to R1_REVEAL after scenario picked', async () => {
    const { clients } = await setupGame(6);
    const [host] = clients;

    // Start game
    const startAck = await new Promise<HostStartGameAck>((resolve) => {
      host!.emit(EVENTS.HOST_START_GAME, resolve);
    });
    expect(startAck.ok).toBe(true);

    // Pick scenario
    const pickAck = await new Promise<HostPickScenarioAck>((resolve) => {
      host!.emit(EVENTS.HOST_PICK_SCENARIO, { scenarioId: 'RANDOM' }, resolve);
    });
    expect(pickAck.ok).toBe(true);

    // Room should be in R1_REVEAL
    const room = roomStore.getRoomByCode((await new Promise<string>((resolve) => {
      // Get room code by checking the store
      const allRooms = roomStore.getAllRooms();
      resolve(allRooms[0]?.roomCode ?? '');
    })))!;
    expect(room.state).toBe('R1_REVEAL');
    expect(room.currentRound).toBe(1);

    clients.forEach((c) => c.disconnect());
  });

  it('rejects startGame from non-host', async () => {
    const { clients } = await setupGame(6);
    const [, player2] = clients;

    const ack = await new Promise<HostStartGameAck>((resolve) => {
      player2!.emit(EVENTS.HOST_START_GAME, resolve);
    });
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.error).toBe('NOT_HOST');

    clients.forEach((c) => c.disconnect());
  });

  it('rejects startGame with too few players', async () => {
    const { clients } = await setupGame(3);
    const [host] = clients;

    const ack = await new Promise<HostStartGameAck>((resolve) => {
      host!.emit(EVENTS.HOST_START_GAME, resolve);
    });
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.error).toBe('TOO_FEW_PLAYERS');

    clients.forEach((c) => c.disconnect());
  });
});

describe('reveal:submit', () => {
  it('accepts valid reveal and advances to debate when all submit', async () => {
    const { clients, roomId } = await setupGame(6);
    const [host] = clients;

    // Start game and pick scenario
    await new Promise<HostStartGameAck>((resolve) => host!.emit(EVENTS.HOST_START_GAME, resolve));
    await new Promise<HostPickScenarioAck>((resolve) => {
      host!.emit(EVENTS.HOST_PICK_SCENARIO, { scenarioId: 'RANDOM' }, resolve);
    });

    // Wait for phase:changed to R1_REVEAL
    await new Promise<void>((resolve) => {
      const check = (): void => {
        const r = roomStore.getRoom(roomId);
        if (r?.state === 'R1_REVEAL') { resolve(); return; }
        setTimeout(check, 50);
      };
      check();
    });

    // Each player submits 2 reveals
    const revealPromises = clients.map((client, i) => {
      return new Promise<RevealSubmitAck>((resolve) => {
        // Get the player's character to find unRevealed cats
        const room = roomStore.getRoom(roomId)!;
        const allPlayers = [...room.players.values()];
        const player = allPlayers[i];
        if (!player?.character) { resolve({ ok: false, error: 'WRONG_PHASE' }); return; }
        const cats = Object.values(player.character.traits)
          .filter((t) => !t.isRevealed)
          .slice(0, 2)
          .map((t) => t.category);
        client.emit(EVENTS.REVEAL_SUBMIT, { categories: cats }, resolve);
      });
    });

    const results = await Promise.all(revealPromises);
    // All should succeed
    for (const r of results) {
      expect(r.ok).toBe(true);
    }

    // Wait for R1_DEBATE
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for R1_DEBATE')), 3000);
      const check = (): void => {
        const r = roomStore.getRoom(roomId);
        if (r?.state === 'R1_DEBATE') { clearTimeout(timeout); resolve(); return; }
        setTimeout(check, 50);
      };
      check();
    });

    const room = roomStore.getRoom(roomId)!;
    expect(room.state).toBe('R1_DEBATE');

    clients.forEach((c) => c.disconnect());
    timerService.cancelTimer(roomId);
  });

  it('rejects duplicate reveal submission', async () => {
    const { clients, roomId } = await setupGame(6);
    const [host] = clients;

    await new Promise<HostStartGameAck>((resolve) => host!.emit(EVENTS.HOST_START_GAME, resolve));
    await new Promise<HostPickScenarioAck>((resolve) => {
      host!.emit(EVENTS.HOST_PICK_SCENARIO, { scenarioId: 'RANDOM' }, resolve);
    });

    await new Promise<void>((resolve) => {
      const check = (): void => {
        const r = roomStore.getRoom(roomId);
        if (r?.state === 'R1_REVEAL') { resolve(); return; }
        setTimeout(check, 50);
      };
      check();
    });

    // Get host's player
    const room = roomStore.getRoom(roomId)!;
    const hostPlayer = [...room.players.values()].find((p) => p.playerId === room.hostPlayerId)!;
    const cats = Object.values(hostPlayer.character!.traits).slice(0, 2).map((t) => t.category);

    // First submit — should succeed
    const ack1 = await new Promise<RevealSubmitAck>((resolve) => {
      host!.emit(EVENTS.REVEAL_SUBMIT, { categories: cats }, resolve);
    });
    expect(ack1.ok).toBe(true);

    // Second submit — should fail
    const ack2 = await new Promise<RevealSubmitAck>((resolve) => {
      host!.emit(EVENTS.REVEAL_SUBMIT, { categories: cats }, resolve);
    });
    expect(ack2.ok).toBe(false);
    if (!ack2.ok) expect(ack2.error).toBe('ALREADY_SUBMITTED');

    clients.forEach((c) => c.disconnect());
  });
});
