# Data Model — Bunker Team Game

**Project:** bunker-team-game
**Version:** 0.1
**Quality Mode:** MVP
**Last Updated:** 2026-05-31
**Author:** Solution Architect Agent

---

## Overview

All runtime state is held in memory as TypeScript objects. There is no database in MVP. The types below define the exact shape of data as it lives in the server's in-memory store. They are exported from `packages/shared` so the client can use the same definitions.

Phase 2 note: Every entity has been designed so a Prisma/Postgres schema can be derived from it directly. The nullable `hostUserId` field is the explicit Phase 2 hook.

---

## Core Types

### Room

```typescript
type RoomState =
  | "LOBBY"
  | "SCENARIO_PICK"
  | "R1_REVEAL" | "R1_DEBATE" | "R1_VOTE"
  | "R2_REVEAL" | "R2_DEBATE" | "R2_VOTE"
  | "R3_REVEAL" | "R3_DEBATE" | "R3_VOTE"
  | "ENDED";

interface Room {
  roomId: string;          // UUID v4
  roomCode: string;        // 6-char uppercase alphanumeric, e.g. "BNK7R2"
  hostPlayerId: string;    // player.playerId of current host (changes on transfer)
  state: RoomState;
  currentRound: 1 | 2 | 3 | null;   // null when LOBBY/SCENARIO_PICK/ENDED
  currentPhase: "REVEAL" | "DEBATE" | "VOTE" | null;
  scenarioId: string | null;         // null until scenario picked
  players: Map<string, Player>;      // keyed by playerId
  createdAt: Date;
  lastActivityAt: Date;
  hostUserId: string | null;         // nullable — Phase 2 FK to user account
}
```

**Notes:**
- `roomCode` is the human-visible code players type or see in the URL. `roomId` is the internal UUID used in server logic and event payloads.
- `hostPlayerId` is mutable — it changes when the host disconnects and the role transfers.
- `lastActivityAt` is updated on every event; used by the 30-minute empty-room expiry job.

---

### Player

```typescript
type PlayerStatus = "ACTIVE" | "RECONNECTING" | "SPECTATOR" | "KICKED";

interface Player {
  playerId: string;           // UUID v4
  roomId: string;             // back-reference to the containing room
  nickname: string;           // 2-20 characters, unique within room (suffixed if collision)
  sessionToken: string;       // random 64-char hex stored in client localStorage; used for reconnect identity
  reconnectToken: string;     // separate random 64-char hex issued at join; client sends this in socket handshake auth to restore room membership after a drop
  socketId: string | null;    // current Socket.IO socket ID; null when disconnected
  status: PlayerStatus;
  joinedAt: Date;             // used for longest-connected tiebreaker logic
  disconnectedAt: Date | null; // set when socket drops; cleared on reconnect
  eliminatedInRound: 1 | 2 | 3 | null;  // null if still active
  character: CharacterCard | null;       // null until game starts
  revealHistory: RevealSubmission[];     // all reveal submissions across all rounds; preserved on reconnect
}
```

**Status transitions:**
```
ACTIVE → RECONNECTING  (socket disconnect detected)
RECONNECTING → ACTIVE  (reconnect within 5 min)
RECONNECTING → SPECTATOR  (5-min timeout auto-elimination)
ACTIVE → SPECTATOR     (voted out by peers)
ACTIVE → KICKED        (host kicks from lobby, pre-game only)
```

**Note on SPECTATOR:** In this codebase "spectator" means an already-eliminated player who remains connected as a watcher. It does NOT mean a late-joiner or public observer (that is Phase 2, explicitly out of scope per PRODUCT_VISION.md).

**Active player definition (for reveal and vote completion checks):** A player counts as "active" in the waiting pool if `status === "ACTIVE" || status === "RECONNECTING"`. A `RECONNECTING` player who disconnects within the 5-minute window is still counted in the denominator when the server checks "has everyone submitted?" — their slot stays open. Auto-elimination to `SPECTATOR` is what removes them from the active pool.

**Reconnect token vs session token:**
- `sessionToken` — identifies the browser/device. Stored in `localStorage`. Sent on every socket handshake. Used by `SessionStore` to look up the player's record.
- `reconnectToken` — a second independent token, also stored in `localStorage`, used specifically to restore a player to their room slot after a mid-game disconnect. Keeping them separate means a session token compromise does not allow room slot takeover without also knowing the reconnect token. Both are 64-char cryptographically random hex strings.

**Reveal history preservation on reconnect:** `player.revealHistory` stores all `RevealSubmission` objects from previous rounds. When the server re-syncs a reconnecting player (emits `room:state`), the full history is included so the client can correctly render which traits have already been revealed in prior rounds.

---

### CharacterCard

```typescript
interface TraitSlot {
  category: TraitCategory;
  traitId: string;         // references a trait entry in the content JSON
  value: string;           // denormalized display string (Ukrainian)
  isRevealed: boolean;     // false until player reveals or player is eliminated
}

type TraitCategory =
  | "GENDER_AGE"      // Стать / вік
  | "PROFESSION"      // Професія
  | "HEALTH"          // Здоров'я
  | "HOBBY"           // Хобі
  | "PHOBIA"          // Фобія
  | "BAGGAGE"         // Багаж
  | "SECRET_FACT";    // Факт

interface CharacterCard {
  playerId: string;
  traits: Record<TraitCategory, TraitSlot>;  // exactly 7 entries, one per category
}
```

**Why `value` is denormalized:** The client needs the display string without a content-file lookup. The server denormalizes at deal time. If a trait label is edited in the JSON, existing in-progress games are unaffected.

**Reveal tracking:** `isRevealed` on each `TraitSlot` is the single source of truth. The server validates on every `reveal:submit` that:
1. The number of traits selected equals the round quota (2 / 2 / 1)
2. None of the selected traits were already `isRevealed = true`

---

### Round

```typescript
interface RevealSubmission {
  playerId: string;
  revealedCategories: TraitCategory[];
  submittedAt: Date;
}

interface VoteRecord {
  voterId: string;
  targetId: string;
  submittedAt: Date;
  isAbstention: boolean;  // true when host skipped a disconnected voter
}

interface Round {
  roundNumber: 1 | 2 | 3;
  revealQuota: 2 | 2 | 1;          // reveals required per player in this round
  revealSubmissions: Map<string, RevealSubmission>;  // keyed by playerId
  votes: Map<string, VoteRecord>;                   // keyed by voterId
  tiebreakVotes: Map<string, VoteRecord> | null;     // populated on first tie
  eliminatedPlayerId: string | null;
  autoEliminationTriggered: boolean;  // true if a disconnect timeout caused elimination
}
```

**Why Round is separate from Room:** The round object accumulates submissions and votes incrementally. Keeping it separate from Room prevents the Room object from growing unbounded. The active round is accessed via `room.currentRound` (index) pointing into `game.rounds`.

---

### Game (aggregates rounds, attached to Room when in-game)

```typescript
interface Game {
  roomId: string;
  scenarioId: string;
  rounds: [Round, Round, Round];   // exactly 3 rounds, pre-allocated
  startedAt: Date;
  endedAt: Date | null;
  endReason: "COMPLETED" | "HOST_ENDED_EARLY" | null;
}
```

---

### Scenario (content, loaded from JSON)

```typescript
interface BunkerConditions {
  capacity: number;         // bunker size in people
  supplyDuration: string;   // e.g. "2 роки"
  outsideEnvironment: string; // e.g. "радіоактивна пустеля"
}

interface Scenario {
  id: string;               // slug, e.g. "nuclear-war"
  title: string;            // Ukrainian
  description: string;      // Ukrainian narrative, 2-4 sentences
  bunkerConditions: BunkerConditions;
  isPremium: boolean;       // always false in MVP; Phase 2 filter
}
```

---

### Trait (content, loaded from JSON)

```typescript
interface Trait {
  id: string;               // e.g. "prof-surgeon"
  category: TraitCategory;
  value: string;            // Ukrainian display string
}
```

---

## In-Memory Store Shape

```typescript
// The three top-level Maps on the server — the entire runtime state

const rooms = new Map<string, Room>();               // key: roomId
const sessionIndex = new Map<string, string>();       // key: sessionToken → value: playerId
const reconnectIndex = new Map<string, string>();     // key: reconnectToken → value: playerId
```

Room lookup by code (for joins) uses a linear scan of the `rooms` Map on room code. At MVP scale (fewer than 100 active rooms) this is O(n) and negligible. Phase 2 adds a secondary `Map<roomCode, roomId>` index.

`reconnectIndex` is populated at join time alongside `sessionIndex`. On socket reconnect, the server first checks `reconnectIndex`; if a match is found and the player's status is `RECONNECTING`, the slot is restored. If no match, the connection is treated as a fresh join.

---

## Data Flow: Character Dealing

```
ContentData.traits (all ~210 entries)
  → group by category (7 groups × ~30 entries each)
  → for each category, Fisher-Yates shuffle
  → for each player (6-10), take the Nth entry from each category
  → assemble CharacterCard with isRevealed = false for all traits
  → assign to player.character
```

Uniqueness guarantee: each category's shuffled slice assigns a different trait to each player. Two players cannot share the same trait in the same category within a session. This satisfies GAME_RULES.md: "всі персонажі в одній грі унікальні".

---

## Phase 2 Extension Points

| Current field | Phase 2 meaning |
|---|---|
| `Room.hostUserId` | FK to `users.id` (Postgres) |
| `Scenario.isPremium` | Filter by subscription tier |
| `Player.sessionToken` | Can be replaced by OAuth sub when user signs in |
| `Player.reconnectToken` | Can be derived from a signed session cookie in Phase 2 |
| `Player.revealHistory` | Queryable from DB in Phase 2 for post-game stats |

No schema changes required in MVP code to accommodate these — the fields exist as null/false placeholders.

---

## Data Volumes (MVP)

| Entity | Max count in memory |
|---|---|
| Active rooms | ~10 (owner's team use) |
| Players per room | 10 |
| Traits in content | ~210 (7 categories × 30) |
| Scenarios in content | 3-5 |
| RevealSubmissions per game | 10 players × 3 rounds = 30 |
| VoteRecords per game | 10 players × 3 rounds = 30 |

Total in-memory footprint per room: well under 1 MB. No memory pressure at MVP scale.
