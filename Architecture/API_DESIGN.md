# API Design — Bunker Team Game

**Project:** bunker-team-game
**Version:** 0.1
**Quality Mode:** MVP
**Last Updated:** 2026-05-31
**Author:** Solution Architect Agent

---

## Overview

The API has two layers:
1. **HTTP REST** — two thin endpoints for room creation and health check. Everything else is WebSocket.
2. **Socket.IO events** — the real-time protocol for all game actions, state updates, and notifications.

All payloads are JSON. All user-facing strings in events are Ukrainian unless otherwise noted. TypeScript types for all payloads live in `packages/shared/src/events.ts` and are imported by both client and server.

---

## HTTP Endpoints

### POST /api/rooms

Creates a new room and the host's player slot.

**Request body:**
```json
{
  "nickname": "Аня"
}
```

**Validation:**
- `nickname`: string, 2-20 characters, required

**Success response — 201 Created:**
```json
{
  "roomId": "uuid-v4",
  "roomCode": "BNK7R2",
  "roomUrl": "/r/BNK7R2",
  "playerId": "uuid-v4",
  "sessionToken": "random-64-char-hex",
  "reconnectToken": "random-64-char-hex"
}
```

**Room code format:** 6 uppercase alphanumeric characters drawn from the set `[A-Z0-9]`. No ambiguous characters (O, I) are used. Examples: `BNK7R2`, `X4QM9A`. Generated server-side with `crypto.randomBytes`; on collision with an existing active room code the server retries up to 10 times before returning 500.

**Error responses:**
- `400` — invalid nickname (includes Ukrainian error message in `{ error: "..." }`)
- `500` — room code collision after max retries

**Design note:** Room creation is HTTP, not Socket.IO, because the client needs the room code before establishing a persistent connection. After receiving the 201, the client stores the session token in localStorage and immediately opens a Socket.IO connection.

---

### GET /health

Standard health check endpoint.

**Response — 200 OK:**
```json
{
  "status": "ok",
  "uptime": 12345,
  "activeRooms": 3
}
```

---

### GET /r/:roomCode

SPA fallback route. Fastify serves the React `index.html` for this path so that players who open an invite URL get the React app (which then reads the room code from the URL and shows the join form).

---

## Socket.IO Events

Convention: `domain:action` naming. Client-emitted events end in a verb (`:submit`, `:join`, `:kick`). Server-emitted events end in a noun or past-tense verb (`:state`, `:joined`, `:updated`, `:changed`).

All client events that mutate server state use **acknowledgements** — the callback receives `{ ok: true }` or `{ ok: false, error: string }`. This is critical for vote submission and reveal submission, where the client needs to know if the server accepted the action.

---

### Connection & Room Events

#### Client → Server: `room:join`

Emitted immediately after socket connects. Used both for initial join and reconnect.

```typescript
// Client emits
interface RoomJoinPayload {
  roomCode: string;
  nickname: string;    // required on first join; ignored on reconnect
  sessionToken: string | null;  // null on first join; provided on reconnect
}

// Acknowledgement
type RoomJoinAck =
  | { ok: true; player: PlayerView; room: RoomView; reconnectToken: string }
  | { ok: false; error: "ROOM_NOT_FOUND" | "ROOM_FULL" | "GAME_IN_PROGRESS" | "INVALID_NICKNAME" };

// Note: reconnectToken is issued on first join and must be stored in localStorage.
// It is distinct from sessionToken — see DATA_MODEL.md Player section for the security rationale.
```

#### Server → Room: `room:state`

Sent to a single player after they successfully join. Contains the full current state — used for initial load and full re-sync after reconnect.

```typescript
interface RoomStatePayload {
  room: RoomView;
  players: PlayerView[];
  ownCharacter: CharacterCard | null;  // null in lobby before game starts
  game: GameView | null;               // null in lobby
}
```

#### Server → Room: `player:joined`

Broadcast to all other room members when a new player joins.

```typescript
interface PlayerJoinedPayload {
  player: PlayerView;
}
```

#### Server → Room: `player:left`

Broadcast when a player leaves the lobby voluntarily.

```typescript
interface PlayerLeftPayload {
  playerId: string;
  newHostId: string | null;  // set if host transferred
}
```

#### Server → Room: `player:reconnecting`

Broadcast when a player's socket drops mid-game (within the 5-min window).

```typescript
interface PlayerReconnectingPayload {
  playerId: string;
}
```

#### Server → Room: `player:reconnected`

Broadcast when the player reconnects within the window.

```typescript
interface PlayerReconnectedPayload {
  playerId: string;
}
```

---

### Host Events

#### Client → Server: `host:kick`

Host-only. Kicks a player from the lobby (pre-game only).

```typescript
interface HostKickPayload {
  targetPlayerId: string;
}
type HostKickAck = { ok: true } | { ok: false; error: "NOT_HOST" | "GAME_STARTED" | "PLAYER_NOT_FOUND" };
```

#### Server → kicked player: `player:kicked`

```typescript
interface PlayerKickedPayload {
  message: string;  // "Вас видалено з кімнати"
}
```

#### Client → Server: `host:startGame`

Host triggers scenario picker flow.

```typescript
// No payload — server validates host identity via socket
type HostStartGameAck = { ok: true } | { ok: false; error: "NOT_HOST" | "TOO_FEW_PLAYERS" | "TOO_MANY_PLAYERS" };
```

#### Client → Server: `host:pickScenario`

```typescript
interface HostPickScenarioPayload {
  scenarioId: string | "RANDOM";
}
type HostPickScenarioAck = { ok: true } | { ok: false; error: "NOT_HOST" | "INVALID_SCENARIO" };
```

#### Client → Server: `host:extendTimer`

Adds 60 seconds to the debate timer.

```typescript
// No payload
type HostExtendTimerAck = { ok: true; newRemaining: number } | { ok: false; error: "NOT_HOST" | "WRONG_PHASE" };
```

#### Client → Server: `host:forceVote`

Skips debate timer and opens voting immediately.

```typescript
// No payload
type HostForceVoteAck = { ok: true } | { ok: false; error: "NOT_HOST" | "WRONG_PHASE" };
```

#### Client → Server: `host:endGame`

Force-ends the game (host confirms in UI before emitting this).

```typescript
// No payload
type HostEndGameAck = { ok: true } | { ok: false; error: "NOT_HOST" | "WRONG_PHASE" };
```

#### Client → Server: `host:playAgain`

Starts a new game with the same lobby.

```typescript
// No payload
type HostPlayAgainAck = { ok: true } | { ok: false; error: "NOT_HOST" | "WRONG_PHASE" };
```

**Play Again flow (confirmed):**
1. Host emits `host:playAgain` from the `ENDED` state.
2. Server resets game state to `SCENARIO_PICK`.
3. Server emits `phase:changed { state: "SCENARIO_PICK" }` to all room members.
4. Server emits `scenarios:list` to all room members — the scenario picker modal opens unconditionally. The previous scenario is never carried over automatically.
5. All players retain their room slots and nicknames. Character cards are cleared; new cards are dealt after the host picks a scenario.
6. There is no "rematch with same scenario" shortcut in MVP.

#### Server → Room: `host:transferred`

Broadcast when host status changes (disconnect auto-transfer or reconnect restoration).

```typescript
interface HostTransferredPayload {
  newHostId: string;
  reason: "DISCONNECT_TIMEOUT" | "ORIGINAL_RECONNECTED";
}
```

---

### Game Phase Events

#### Server → Room: `phase:changed`

The most important server event. Triggers client re-render for the new phase.

```typescript
interface PhaseChangedPayload {
  state: RoomState;         // e.g. "R1_REVEAL"
  round: 1 | 2 | 3 | null;
  phase: "REVEAL" | "DEBATE" | "VOTE" | null;
  revealQuota: number | null;   // 2, 2, or 1 depending on round
  timerSeconds: number | null;  // set for DEBATE phase
}
```

#### Server → Room: `scenarios:list`

Sent when host triggers game start. Clients render the scenario picker.

```typescript
interface ScenariosListPayload {
  scenarios: Scenario[];
}
```

#### Server → Room: `game:started`

Sent after host picks a scenario. All players receive their character.

```typescript
interface GameStartedPayload {
  scenario: Scenario;
  ownCharacter: CharacterCard;  // each player receives their own card only
  players: PlayerView[];
}
```

---

### Reveal Events

#### Client → Server: `reveal:submit`

```typescript
interface RevealSubmitPayload {
  categories: TraitCategory[];  // must match round quota exactly
}
type RevealSubmitAck =
  | { ok: true }
  | { ok: false; error: "WRONG_PHASE" | "WRONG_COUNT" | "ALREADY_REVEALED" | "ALREADY_SUBMITTED" };
```

#### Server → Room: `reveal:update`

Broadcast immediately when any player submits reveals.

```typescript
interface RevealUpdatePayload {
  playerId: string;
  revealedTraits: TraitSlot[];
  waitingFor: number;  // number of players who haven't submitted yet (0 means all done)
}
```

**Rolling reveal sequence (confirmed):**

```
Client A  →  Server:  reveal:submit  { categories: ["PROFESSION", "HEALTH"] }
Server    →  Room:    reveal:update  { playerId: A, revealedTraits: [...], waitingFor: 3 }

Client B  →  Server:  reveal:submit  { categories: [...] }
Server    →  Room:    reveal:update  { playerId: B, revealedTraits: [...], waitingFor: 2 }

... (C and D submit) ...

Server    →  Room:    reveal:update  { playerId: D, revealedTraits: [...], waitingFor: 0 }
Server    →  Room:    phase:changed  { state: "R1_DEBATE", phase: "DEBATE", timerSeconds: 300, ... }
```

Rules enforced server-side:
1. A player who has already submitted receives `{ ok: false, error: "ALREADY_SUBMITTED" }` on a second `reveal:submit`.
2. `waitingFor` counts only players with `status === "ACTIVE" || status === "RECONNECTING"` (eliminated and kicked players are excluded).
3. The phase advances to DEBATE automatically when `waitingFor` reaches 0 — no separate `reveal:phase_complete` event is emitted; the `phase:changed` event serves that role.
4. There is no reveal timer at MVP. `TimerService` has a placeholder for a reveal countdown (P2) that can be wired without architecture changes.

---

### Debate Events

#### Server → Room: `timer:tick`

Emitted every second during debate phase.

```typescript
interface TimerTickPayload {
  remaining: number;  // seconds remaining
}
```

#### Server → Room: `timer:extended`

Emitted when host adds time.

```typescript
interface TimerExtendedPayload {
  newRemaining: number;
}
```

---

### Vote Events

#### Client → Server: `vote:submit`

```typescript
interface VoteSubmitPayload {
  targetId: string;
}
type VoteSubmitAck =
  | { ok: true }
  | { ok: false; error: "WRONG_PHASE" | "SELF_VOTE" | "ALREADY_VOTED" | "INVALID_TARGET" };
```

#### Server → Room: `vote:update`

Broadcast immediately when any player votes (open vote).

```typescript
interface VoteUpdatePayload {
  voterId: string;
  targetId: string;
  tally: Record<string, number>;  // targetId → vote count
}
```

#### Server → Room: `vote:tiebreaker`

Emitted when re-vote is triggered.

```typescript
interface VoteTiebreakerPayload {
  tiedPlayerIds: string[];
  isHostDeciding: boolean;  // true when re-vote also tied and only host votes
  decidingPlayerId: string | null;  // the player who casts the host tiebreaker vote
}
```

#### Server → Room: `player:eliminated`

Emitted after vote tally resolves.

```typescript
interface PlayerEliminatedPayload {
  playerId: string;
  eliminatedInRound: 1 | 2 | 3;
  fullCharacter: CharacterCard;   // all traits revealed
  reason: "VOTE" | "AUTO_TIMEOUT";
}
```

---

### Host Voting Controls

#### Client → Server: `host:skipVote`

Host decides to skip a disconnected voter's slot.

```typescript
interface HostSkipVotePayload {
  disconnectedPlayerId: string;
}
type HostSkipVoteAck = { ok: true } | { ok: false; error: "NOT_HOST" | "WRONG_PHASE" };
```

#### Server → Host: `host:disconnectedVoterPrompt`

Prompt shown to host when a voter has been disconnected for 30s.

```typescript
interface HostDisconnectedVoterPromptPayload {
  disconnectedPlayerId: string;
  disconnectedNickname: string;
}
```

---

### Game End Events

#### Server → Room: `game:ended`

```typescript
interface GameEndedPayload {
  reason: "COMPLETED" | "HOST_ENDED_EARLY";
  survivors: PlayerView[];              // with full character cards
  eliminated: PlayerView[];             // in elimination order, with full cards
  outcomeSummary: string;               // Ukrainian template text
}
```

---

## View Types (Shared Client/Server)

These are the "safe" shapes sent to clients — they enforce visibility rules (opponents see only revealed traits).

```typescript
interface PlayerView {
  playerId: string;
  nickname: string;
  status: PlayerStatus;
  isHost: boolean;
  eliminatedInRound: 1 | 2 | 3 | null;
  visibleTraits: TraitSlot[];   // only revealed traits; full card only if self or eliminated
}

interface RoomView {
  roomCode: string;
  state: RoomState;
  currentRound: 1 | 2 | 3 | null;
  currentPhase: "REVEAL" | "DEBATE" | "VOTE" | null;
  scenario: Scenario | null;
  playerCount: number;
}

interface GameView {
  round: 1 | 2 | 3;
  phase: "REVEAL" | "DEBATE" | "VOTE";
  revealQuota: number;
  debateTimerRemaining: number | null;
  votes: VoteRecord[];
}
```

---

## Security Notes

- The server identifies the acting player by their Socket.IO socket ID mapped to a player slot — never by a client-supplied `playerId` in the payload. This prevents impersonation.
- Host actions are validated server-side: `player.playerId === room.hostPlayerId`. Emitting a host event from a non-host socket returns `{ ok: false, error: "NOT_HOST" }`.
- All incoming event payloads are validated with a schema check (Zod recommended) before processing.
- Session tokens are cryptographically random (64-char hex). They are not JWT; they do not encode any claims. They are opaque identifiers stored server-side.
