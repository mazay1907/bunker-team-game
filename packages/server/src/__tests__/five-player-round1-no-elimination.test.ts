/**
 * GAME_RULES.md "Виняток для 5 гравців": in a 5-player game, round 1's vote
 * resolves normally (players vote, ties re-vote as usual) but NOBODY is
 * eliminated. Rounds 2 and 3 each eliminate 1 player normally, leaving 3
 * survivors total (vs. the usual 3-elimination / down-to-N-3 rule for 6-10
 * players).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server as SocketIOServer, type DefaultEventsMap } from 'socket.io';
import { io as ioClient, type Socket } from 'socket.io-client';
import { EVENTS } from '@bunker/shared';
import type {
  RoomJoinPayload,
  RoomJoinAck,
  HostStartGameAck,
  HostPickScenarioAck,
  RevealSubmitAck,
  VoteSubmitAck,
  HostForceVoteAck,
  PlayerEliminatedPayload,
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
import { createSocketMiddleware, type SocketData } from '../socket/middleware.js';
import { registerRoomHandlers } from '../socket/handlers/roomHandlers.js';
import { registerHostHandlers } from '../socket/handlers/hostHandlers.js';
import { registerRevealHandlers } from '../socket/handlers/revealHandlers.js';
import { registerVoteHandlers } from '../socket/handlers/voteHandlers.js';

let io: SocketIOServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
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
  io = new SocketIOServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>(httpServer, { cors: { origin: '*' } });
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
  void io.close();
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

async function waitForState(roomId: string, state: string, timeoutMs = 3000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${state}`)), timeoutMs);
    const check = (): void => {
      const r = roomStore.getRoom(roomId);
      if (r?.state === state) { clearTimeout(timeout); resolve(); return; }
      setTimeout(check, 25);
    };
    check();
  });
}

/** Submits reveals for every client for the current round, then force-votes into VOTE phase. */
async function revealThenForceVote(clients: Socket[], roomId: string): Promise<void> {
  // Capture the round/target debate state BEFORE submitting — reveal:submit can
  // synchronously advance the phase once the last quota is met, so reading
  // room.state after Promise.all resolves would race with that transition.
  const roomBefore = roomStore.getRoom(roomId)!;
  const roundNumber = roomBefore.currentRound!;
  const targetDebateState = `R${roundNumber}_DEBATE`;

  const revealPromises = clients.map((client, i) => {
    return new Promise<RevealSubmitAck>((resolve) => {
      const room = roomStore.getRoom(roomId)!;
      const allPlayers = [...room.players.values()];
      const player = allPlayers[i];
      if (!player?.character || player.status === 'SPECTATOR' || player.status === 'KICKED') {
        resolve({ ok: true });
        return;
      }
      const quota = room.game!.rounds[room.currentRound! - 1]!.revealQuota;
      const cats = Object.values(player.character.traits)
        .filter((t) => !t.isRevealed)
        .slice(0, quota)
        .map((t) => t.category);
      client.emit(EVENTS.REVEAL_SUBMIT, { categories: cats }, resolve);
    });
  });
  const results = await Promise.all(revealPromises);
  for (const r of results) expect(r.ok).toBe(true);

  await waitForState(roomId, targetDebateState);

  const host = clients[0]!;
  const forceAck = await new Promise<HostForceVoteAck>((resolve) => {
    host.emit(EVENTS.HOST_FORCE_VOTE, resolve);
  });
  expect(forceAck.ok).toBe(true);
}

/**
 * Every active (non-eliminated) client votes — all but the target vote FOR the
 * target (a clear majority winner); the target itself must still cast a vote
 * (self-votes are rejected) so it votes for the first other active player,
 * which doesn't change the outcome as long as it's a minority vote.
 */
async function voteAllFor(clients: Socket[], roomId: string, targetId: string): Promise<void> {
  const room = roomStore.getRoom(roomId)!;
  const allPlayers = [...room.players.values()];
  const activeClientIndices = allPlayers
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p.status === 'ACTIVE')
    .map(({ idx }) => idx);

  const fallbackTarget = allPlayers.find(
    (p) => p.status === 'ACTIVE' && p.playerId !== targetId,
  )!.playerId;

  const votePromises = activeClientIndices.map((idx) => {
    const client = clients[idx]!;
    const voterId = allPlayers[idx]!.playerId;
    const voteTarget = voterId === targetId ? fallbackTarget : targetId;
    return new Promise<VoteSubmitAck>((resolve) => {
      client.emit(EVENTS.VOTE_SUBMIT, { targetId: voteTarget }, resolve);
    });
  });
  const results = await Promise.all(votePromises);
  for (const r of results) expect(r.ok).toBe(true);
}

describe('5-player game — round 1 no-elimination exception', () => {
  it('resolves round 1 vote without eliminating anyone, then eliminates normally in rounds 2-3', async () => {
    const { clients, roomId, playerIds } = await setupGame(5);
    const host = clients[0]!;

    await new Promise<HostStartGameAck>((resolve) => host.emit(EVENTS.HOST_START_GAME, resolve));
    await new Promise<HostPickScenarioAck>((resolve) => {
      host.emit(EVENTS.HOST_PICK_SCENARIO, { scenarioId: 'RANDOM' }, resolve);
    });
    await waitForState(roomId, 'R1_REVEAL');

    // Sanity: startingPlayerCount captured correctly
    expect(roomStore.getRoom(roomId)!.game!.startingPlayerCount).toBe(5);

    // ── Round 1: vote happens, but nobody should be eliminated ──────────────
    await revealThenForceVote(clients, roomId);
    await waitForState(roomId, 'R1_VOTE');

    let eliminatedEventFired = false;
    const onEliminated = (_p: PlayerEliminatedPayload): void => { eliminatedEventFired = true; };
    clients.forEach((c) => c.on(EVENTS.PLAYER_ELIMINATED, onEliminated));

    // Everyone votes for playerIds[1] — clear winner, but round 1 exception applies
    await voteAllFor(clients, roomId, playerIds[1]!);

    // Round should advance straight to R2_REVEAL without an elimination
    await waitForState(roomId, 'R2_REVEAL');
    clients.forEach((c) => c.off(EVENTS.PLAYER_ELIMINATED, onEliminated));

    expect(eliminatedEventFired).toBe(false);
    const afterRound1 = roomStore.getRoom(roomId)!;
    const activeAfterRound1 = [...afterRound1.players.values()].filter((p) => p.status === 'ACTIVE');
    expect(activeAfterRound1.length).toBe(5);
    expect(afterRound1.game!.rounds[0].eliminatedPlayerId).toBeNull();

    // ── Round 2: normal elimination resumes ──────────────────────────────────
    await revealThenForceVote(clients, roomId);
    await waitForState(roomId, 'R2_VOTE');
    await voteAllFor(clients, roomId, playerIds[2]!);
    await waitForState(roomId, 'R3_REVEAL');

    const afterRound2 = roomStore.getRoom(roomId)!;
    expect(afterRound2.game!.rounds[1].eliminatedPlayerId).toBe(playerIds[2]);
    const activeAfterRound2 = [...afterRound2.players.values()].filter((p) => p.status === 'ACTIVE');
    expect(activeAfterRound2.length).toBe(4);

    // ── Round 3: normal elimination, game ends with 3 survivors ─────────────
    await revealThenForceVote(clients, roomId);
    await waitForState(roomId, 'R3_VOTE');
    await voteAllFor(clients, roomId, playerIds[3]!);
    await waitForState(roomId, 'ENDED');

    const finalRoom = roomStore.getRoom(roomId)!;
    expect(finalRoom.game!.rounds[2].eliminatedPlayerId).toBe(playerIds[3]);
    const survivors = [...finalRoom.players.values()].filter(
      (p) => p.status !== 'SPECTATOR' && p.status !== 'KICKED',
    );
    expect(survivors.length).toBe(3);

    clients.forEach((c) => c.disconnect());
  });
});
