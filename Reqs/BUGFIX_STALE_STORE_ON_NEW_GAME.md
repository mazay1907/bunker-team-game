# BUGFIX SPEC — Stale Zustand store bleeds into a freshly created/joined room (BUG-3)

**Status:** Diagnosed only. No fix implemented. This is a "store the bug, don't fix it" document — a
separate PM/SA/Developer cycle designs and implements the remediation.

**Reported against:** branch `fix/bug-1-session-room-scoping` (commits `4ae02f2` BUG-1 +
`6291a5a` BUG-2), i.e. AFTER both prior room-scoping fixes landed. This is a regression/gap that
BUG-1 and BUG-2 did not cover — they fixed server/cookie/socket room-scoping, not the client's
in-memory Zustand store.

---

## Verbatim user report

> When I finish the game and start the new one it allows me to enter names and then shows me the
> last game. So the issue with caching data on the room level hasn't been fixed correctly.

## Confirmed repro steps

1. Create a room for 6 players (HomePage → "Create room").
2. Play the game to completion (all 3 rounds; `game:ended` fires; `GameOverScreen` renders because
   `gameEnded` is set in the store).
3. Host finishes the game (stays in the same browser tab/session — no reload).
4. In the SAME browser tab, host goes back to `/` and creates a brand-new room (new `roomCode`,
   6 players again).
5. A second tab/session (regular player) joins the NEW room via the join form.
6. Host starts the new game.

**Actual:** Immediately upon navigating into `/game/:newRoomCode`, the client renders the **previous
game's `GameOverScreen`** (old survivors/eliminated list, old outcome summary, old survival
prediction) instead of the new game's live REVEAL phase — because `gameEnded` from the finished
game was never cleared. Other previous-game fields (`ownCharacter`, `game`, `votes`, `voteTally`,
`revealSubmittedIds`, `debateSpeakingOrder`, `isRevealed`, `survivalPrediction`) are equally never
cleared and would surface as soon as any code path reads them before the new game's real-time
events overwrite each field individually.

**Expected:** On creating or joining a new room, the store must be fully reset before any new-room
state is written, so no field from the prior finished game is observable, even for a single render.

---

## Root cause

`useGameStore`'s `reset()` (full-state reset to `initialState`) exists and is correctly wired for:
- `player:kicked` (`packages/client/src/socket/listeners.ts:274`)
- `room:closed` (`packages/client/src/socket/listeners.ts:293`)
- `GamePage.tsx:363` — but ONLY inside a guard that compares
  `store.room.roomCode === upperRoomCode` (`GamePage.tsx:361-364`); reset only fires when the store
  already holds a *different* room code than the URL being mounted.

**The create-room and join-room flows never call `reset()` at all, and they write the new room's
code into the store *before* that mismatch check would ever see stale data:**

- `packages/client/src/pages/HomePage.tsx`, `handleCreateRoom` (lines 50-111): calls
  `setOwnPlayer(...)` (line 73), then on join-ack `setRoom(ack.room)` + `setPlayers([ack.player])`
  (lines 91-92) — all of which write the **new** room's data into the store while every other field
  from the previous game (`gameEnded`, `ownCharacter`, `game`, `votes`, `voteTally`, `tiebreaker`,
  `revealSubmittedIds`, `debateSpeakingOrder`, `isRevealed`, `survivalPrediction`, etc.) is left
  untouched from the prior game. No `reset()` call anywhere in this handler.
- `packages/client/src/pages/HomePage.tsx`, `handleJoinRoom` (lines 113-131): same gap — calls
  `setOwnPlayer('', nickname)` then navigates to `/r/:roomCode`, no `reset()`.
- `packages/client/src/pages/LobbyPage.tsx`: grepped for `reset` — zero matches. The join effect
  (~line 163-230) calls `setOwnPlayer(...)` on ack but never resets prior state either.

**Why GamePage's existing guard doesn't catch this:** `GamePage.tsx:361-364` only resets when
`store.room.roomCode !== upperRoomCode` on mount. But by the time GamePage mounts for the new room,
`HomePage.handleCreateRoom` (or `LobbyPage`'s join effect) has *already* called `setRoom(ack.room)`
with the **new** room's code. So `store.room.roomCode === upperRoomCode` is true, GamePage treats it
as "normal in-app navigation from LobbyPage," and skips reset entirely — even though every
non-room/non-player field in the store still belongs to the previous finished game.

**Confirmed rendering path that surfaces it:** `GamePage.tsx:586` —
`if (gameEnded) return <GameOverScreen />;` — this check runs unconditionally on every render
regardless of the current room/game/phase, so a stale `gameEnded` from a previous game takes
priority over rendering the new game's actual (REVEAL/DEBATE/VOTE) phase.

## Which role path is worse

Both the **host-creates-new-room** path (`HomePage.handleCreateRoom`) and the
**player-joins-new-room** path (`HomePage.handleJoinRoom` → `LobbyPage`) have the identical gap
(no `reset()` call). The host path is the one confirmed in the verbatim repro (steps 3-4 above:
same tab, finish game, immediately create new game) because it's the tab that's guaranteed to have
just rendered `GameOverScreen` and populated `gameEnded` before navigating away — so the regression
is most visibly reproducible there. The player-join path is equally vulnerable any time the same
browser tab was previously in a finished game session (e.g., a player who played a prior game in
that tab, then joins a new room without a full page reload).

## Files implicated (for the fix cycle, not fixed here)

- `packages/client/src/pages/HomePage.tsx` — `handleCreateRoom`, `handleJoinRoom` (no reset before writing new room state)
- `packages/client/src/pages/LobbyPage.tsx` — join effect (no reset before writing new room state)
- `packages/client/src/pages/GamePage.tsx:361-364` — reset guard only triggers on room-code mismatch, which create/join flows bypass by pre-populating the correct code
- `packages/client/src/store/gameStore.ts:225` — `reset()` itself is correct and sufficient once called at the right time; the bug is a missing call site, not a broken reset implementation

---

## Requirements — fix cycle (PM, after Solution Architect consult)

**Status:** Requirements defined below. Developer implements next; QA verifies against the acceptance
criteria and Definition of Done in this section.

### Fix shape (per Solution Architect review)

Do **not** patch `HomePage.handleCreateRoom`, `HomePage.handleJoinRoom`, and `LobbyPage`'s join effect
independently with three separate `reset()` calls. BUG-2's spec already established the precedent
that ad-hoc per-call-site patches are how "forgot one call site" gaps happen (this bug is itself an
instance of exactly that pattern, one bug fix removed) — a single choke point is required.

- Add one new store action, colocated with `reset()` in `packages/client/src/store/gameStore.ts`.
  **Corrected signature (v2): returns `boolean`, not `void`** — required to close Gap 2 (see below):
  ```ts
  enterRoom: (roomCode: string) => boolean;
  // implementation:
  enterRoom: (roomCode) => {
    const current = get().room?.roomCode;
    const upper = roomCode.toUpperCase();
    if (current && current.toUpperCase() === upper) {
      return false; // same room already active — no state change, caller should skip/early-return
    }
    set(initialState);
    return true; // a different room is now active (or none was) — caller should proceed with join/reconnect
  },
  ```
  (Requires switching the store's `create<GameState>((set) => ...)` to `create<GameState>((set, get) => ...)`
  if `get` is not already destructured — check current signature before implementing.)

  **Naming requirement:** the local variable/parameter holding this return value at each call site
  must be named neutrally — e.g. `didEnter` or `isNewRoom` — **never** `wasReset`. In the "no room at
  all" branch (full page reload, `store.room` is `null`), `enterRoom()` returns `true` even though
  nothing was actually reset (there was nothing to reset). The boolean's contract is **"a different
  room is now active — caller should proceed with join/reconnect,"** not "a reset occurred." Do not
  document, name, or reason about it as the latter — the two are not equivalent in the null-room
  branch, and a `wasReset`-style name would misdescribe that case to future readers/maintainers.

  Incidental fix (not a scope change, noted for the record): the comparison now uppercases **both**
  sides (`current.toUpperCase() === upper`) instead of relying on an exact-string match — a strict
  correctness improvement over the pre-existing inline guard, folded into this change since it's the
  same line of logic.

- Call `useGameStore.getState().enterRoom(roomCode)` at the precise placements below — one per call
  site. The unifying rule across all four: **`enterRoom()` must run before any other store write in
  its handler/effect, and — for effects that contain conditional early-return branches — before any
  of those branches evaluate**, not merely before the eventual join/ack callback:

  1. `HomePage.tsx` `handleCreateRoom` — call before its first `setOwnPlayer` call (~line 73). No
     conditional early-return precedes this call in the handler, so "before the first store write" is
     sufficient here.
  2. `HomePage.tsx` `handleJoinRoom` — call before its `setOwnPlayer('', nickname)` call (~line 124).
     Same reasoning as (1).
  3. `LobbyPage.tsx` join effect — **v2 correction, closes Gap 1:** call as the unconditional FIRST
     statement inside the mount `useEffect`, immediately after the `if (!roomCode) { navigate('/');
     return; }` guard (right after current line 233) and **before** `registerSocketListeners()` is
     called (before current line 235) — and therefore also before the two conditional early-return
     branches at lines 247-250 (host already joined) and 252-256 (no nickname/no token, show
     nickname form). Ignore the boolean return value at this call site: LobbyPage has its own
     separate `ownPlayerId`/`room` check at lines 247-250 that already serves its same-room-skip
     purpose, and that check is unrelated to and unaffected by this call.

     **Do not** place this call inside `doJoin`'s `ROOM_JOIN` ack callback (where the v1 spec
     incorrectly placed it, at former line 211) — see "Why this doesn't reintroduce BUG-1 or BUG-2"
     below for the exact race this placement avoids, and note the corrected rationale: it is not
     that `registerSocketListeners()`'s inbound handlers could somehow fire synchronously before
     they finish registering (Socket.IO always delivers inbound events, including `room:state`,
     asynchronously — at least one task/microtask after the synchronous `.on()` registration call
     completes, so no handler can fire during the same synchronous stretch of code that registers
     it, regardless of where in that stretch `enterRoom()` sits). What actually matters is that this
     effect has two conditional branches (247-250, 252-256) that `return cleanup` and never reach
     the async `doJoin` path at all — so a call placed inside `doJoin`'s ack callback simply never
     executes on those branches, and even on the branch that does reach `doJoin`, the ack callback
     fires only after the `ROOM_JOIN` emit's round trip, by which time `onRoomState` (registered
     earlier, at line 235) may have already run — since Socket.IO does not guarantee `room:state`
     arrives after the ack (CLAUDE.md's S5-1 note documents `room:state` arriving *before* the ack
     in the reconnect flow). Placing `enterRoom()` before all conditional branches, in the
     synchronous body of the effect, removes this ordering dependency entirely: the reset (if any)
     is guaranteed complete before a single store write of any kind — from any source — can occur
     for this mount.
  4. `GamePage.tsx:361-364` — **v2 correction, closes Gap 2:** replace the existing inline guard
     ```ts
     if (store.room) {
       if (store.room.roomCode === upperRoomCode) return cleanup;
       store.reset();
     }
     ```
     with:
     ```ts
     const isNewRoom = useGameStore.getState().enterRoom(upperRoomCode);
     if (!isNewRoom) return cleanup;
     ```
     This preserves the original control flow exactly: same room → `enterRoom()` returns `false` →
     `return cleanup` (matches old behavior at line 362); different room → store is reset internally
     and `enterRoom()` returns `true` → falls through to the reconnect/join logic below (matches old
     behavior at line 363 falling through); no room at all (full page reload) → `enterRoom()` returns
     `true` → falls through directly to the reconnect-token lookup (matches old behavior where
     `if (store.room)` was `false` and execution fell through to line 366 directly). There is now
     exactly one implementation of the "same room vs. different room" comparison in the codebase
     (`enterRoom()` itself), not two independently-maintained copies.
- **Do not** put this logic inside `ensureConnectedForRoom()` (`socket.ts`) — that function is
  socket-transport bookkeeping only (connect/handshake state) with no knowledge of Zustand;
  overloading it with store side-effects would fire on every reconnect retry/race, not just genuine
  room entry, and breaks the existing separation of concerns between `socket.ts` and `gameStore.ts`.
  Note also that `setActiveRoomCode()` (`socket.ts`, ~line 243) is a module-level variable in
  `socket.ts`, entirely separate from the Zustand store — no listener writes through it, and it is
  unaffected by and irrelevant to this fix.
- **Optional, non-blocking hardening (not required to close either gap):** `listeners.ts`'s
  `onRoomState` (lines 49-55) could additionally guard itself — e.g.
  `if (store.room && store.room.roomCode !== payload.room.roomCode) store.reset();` before
  `store.setRoom(payload.room)` — as defense-in-depth against a similar race being reintroduced
  elsewhere in the future. This is explicitly **optional**: the call-site placement fix in (3) above
  is sufficient on its own to close Gap 1. Developer should treat this as a nice-to-have, not a
  Definition-of-Done item, and may skip it without QA blocking on its absence.

### Why this doesn't reintroduce BUG-1 or BUG-2

- `gameStore.ts`'s `reset()`/`enterRoom()` only touches Zustand fields (`room`, `players`,
  `ownCharacter`, `game`, `votes`, `gameEnded`, etc., including `connectionState`, which `initialState`
  sets to `'disconnected'`). It does **not** touch `socket.ts` module state (`activeRoomCode`,
  `lastHandshakedRoomCode`, `inFlight`/`inFlightRoom`), cookies, or the live socket connection —
  those are entirely separate from Zustand and are what BUG-1 (cookie scoping) and BUG-2
  (handshake/duplicate-join races) actually fixed. `enterRoom()` cannot corrupt that state.
- **One ordering constraint applies:** because `reset()` sets `connectionState` back to
  `'disconnected'`, `enterRoom(roomCode)` must always run as the *first* mutation in each handler,
  strictly before `setOwnPlayer`/`setRoom`/`setConnectionState` in that same flow — never after. If
  it ran after those setters it would wipe the very room/player/connection data just written. This is
  satisfied by construction if the call is placed as instructed above (first line of each handler,
  before any other store write), and does not need to be sequenced with `ensureConnectedForRoom()`'s
  async connect/handshake cycle — `enterRoom()` is a synchronous, independent store mutation.
- **v2 refinement (LobbyPage specifically):** "first mutation in the handler" is necessary but not
  sufficient for effects that contain conditional early-return branches before the handler's async
  join path — see call site (3) above. For `LobbyPage.tsx`'s join effect, the binding constraint is
  "before any conditional early-return in this effect," which is strictly earlier than "first
  mutation inside `doJoin`." A call placed inside `doJoin`'s ack callback satisfies "first mutation
  in the async join path" while still failing to run at all on the two early branches, and even on
  the branch it does reach, it can run too late relative to `onRoomState` (see the corrected
  rationale in call site (3)). `HomePage.tsx`'s two handlers and `GamePage.tsx`'s effect have no such
  early-return-before-store-write hazard, so "first store write in the handler" remains the correct
  and sufficient framing for those three call sites.

### Acceptance criteria

**A. Host creates a new room after finishing a previous game (same tab, no reload)**
1. Host completes a game in tab T (`gameEnded` populated, `GameOverScreen` visible).
2. Host clicks "Створити кімнату" / submits `handleCreateRoom` for a brand-new room.
3. Immediately after the join-ack populates the store for the new room, `useGameStore.getState()`
   must show `gameEnded === null`, `ownCharacter === null`, `game === null`, `votes === []`,
   `voteTally === {}`, `revealSubmittedIds === []`, `debateSpeakingOrder === []`,
   `isRevealed === false`, `survivalPrediction === null` — every field from the prior game is gone,
   not just eventually overwritten.
4. Navigating into `/r/:newRoomCode` (lobby) never flashes or renders `GameOverScreen` or any other
   stale-game UI at any point, including the very first render.

**B. Player joins a new room after finishing a previous game in the same tab**
1. Player finishes a game in tab T (`gameEnded` populated).
2. Player returns to `/`, enters a different room code via "Приєднатися за кодом" /
   `handleJoinRoom`, and submits a nickname for the new room in `LobbyPage`.
3. Same store-clean assertions as Scenario A, step 3, apply once the join-ack lands.
4. Navigating from `LobbyPage` into `/game/:newRoomCode` when the host starts the new game renders
   the new game's actual current phase (REVEAL/DEBATE/VOTE), never the previous game's
   `GameOverScreen`.

**C. LobbyPage join effect specifically (covers the case where HomePage and LobbyPage are separate
mounts, e.g. direct navigation to an invite link `/r/:roomCode` in a tab that still holds a finished
game's state)**
1. Tab T holds `gameEnded` from a finished game (no reload since).
2. User (in the same tab) opens a fresh invite link URL directly (`/r/:newRoomCode`), enters a
   nickname, and the join effect's ack fires.
3. Same store-clean assertions as Scenario A, step 3, apply.

### Constraints — must not regress BUG-1, BUG-2, or S5-1

- **Same-room refresh reconnect (S5-1) must still preserve/resync state, not reset it.** On a full
  page reload of `/game/:roomCode`, Zustand's in-memory store is always wiped by the browser (this is
  not the bug being fixed — it's expected browser behavior), so `store.room` is `null` when
  `enterRoom()`'s check runs; `current` is falsy, the reset branch is skipped, and `GamePage`'s
  existing reconnect flow (cookie lookup → `ensureConnectedForRoom` → `ROOM_JOIN` emit → `room:state`
  resync) proceeds exactly as it does today. `enterRoom()` must never fire a reset when
  `store.room === null` — only when it holds a *different* room's code.
- **BUG-1 (room-scoped cookies) and BUG-2 (connection hygiene / no duplicate join) must remain
  intact.** `enterRoom()`/`reset()` must not call, wrap, or otherwise interact with
  `ensureConnectedForRoom()`, `setActiveRoomCode()`, `claimSession()`, or any cookie read/write.
  These remain fully independent of the Zustand reset.
- **In-app normal navigation within the SAME room** (e.g. `LobbyPage` → `GamePage` when the host
  starts the game, both for the same `roomCode`) must not reset — `enterRoom()`'s comparison
  (uppercased on both sides: `current && current.toUpperCase() === upper`) already guards this:
  a match returns `false` and skips the reset branch, so `GamePage`'s
  `if (!isNewRoom) return cleanup;` correctly stops before the reconnect/join logic.
- No new lint/typecheck/test/build regressions. Existing Vitest suites covering BUG-1/BUG-2
  (`ensureConnectedForRoom` tests, reconnect resilience tests) must still pass unmodified.

### Definition of Done (QA-verifiable)

1. `enterRoom(roomCode)` action exists in `gameStore.ts`, returns `boolean` (`true` = a different
   room is now active, caller should proceed with join/reconnect; `false` = same room, caller should
   skip), and is the single implementation of the "reset on new room, preserve on same room"
   decision — grep confirms no second inline `roomCode !== ... ? reset() : ...` comparison remains
   anywhere in the client codebase. Any local variable capturing this return value is named
   neutrally (e.g. `didEnter`/`isNewRoom`) — grep confirms no call site names it `wasReset` or
   otherwise implies "a reset occurred," since that is not true in the null-`store.room` branch.
2. All four call sites listed above call `enterRoom()` before any other store write in their
   respective handler/effect. For `LobbyPage.tsx` specifically, the call additionally precedes
   `registerSocketListeners()` and both conditional early-return branches (lines 247-250, 252-256) —
   not merely `doJoin`'s ack callback. For `GamePage.tsx`, the replacement reads
   `const isNewRoom = useGameStore.getState().enterRoom(upperRoomCode); if (!isNewRoom) return
   cleanup;`, preserving the original same-room early-return control flow exactly.
3. Scenarios A, B, and C above are manually walked through (or covered by a new
   Vitest/integration test exercising `useGameStore` + the handler functions) with the exact
   store-field assertions in Scenario A step 3 passing — zero stale fields survive into the new
   room's first render.
4. A regression pass confirms: S5-1 same-room page-reload reconnect still resyncs correctly (no
   reset, no loading-spinner hang); BUG-2's host-quick-restart flow (finish game → immediately
   create new room, same tab) no longer produces either a duplicate player row (BUG-2) or a stale
   `GameOverScreen` (BUG-3) — both fixes verified together in one pass since they share the same
   repro steps.
5. `pnpm lint`, `pnpm typecheck`, existing `pnpm test` suite, and `pnpm build` all pass green.
6. QA signs off; Solution Architect reviews the `enterRoom()` implementation and call-site diffs
   before Developer marks BUG-3 `[x]` in `Reqs/BACKLOG.md`.

---

### Changelog — fix-cycle spec revisions

**v2 (this revision) — corrections after QA FAIL, Solution Architect re-consulted on both gaps:**

1. **Gap 1 (LobbyPage ordering race) — closed.** v1 placed `enterRoom()` inside `doJoin`'s
   `ROOM_JOIN` ack callback (former line 211). QA found this let `onRoomState` (wired up earlier via
   `registerSocketListeners()` at line 235, and per CLAUDE.md's S5-1 note capable of firing *before*
   the ack) write the new room's code into `store.room` first, making `enterRoom()`'s mismatch check
   a no-op by the time it ran — the same bug class, unfixed. Corrected placement: `enterRoom()` now
   runs as the unconditional first statement of LobbyPage's mount effect, before
   `registerSocketListeners()` and before both of the effect's conditional early-return branches
   (lines 247-250, 252-256). Solution Architect corrected the underlying rationale during review:
   the fix works not because it precedes listener *registration* (Socket.IO can't deliver an event
   synchronously during the same stretch of code that registers the listener, so registration order
   alone was never the hazard) but because it precedes the effect's conditional branches, which
   `doJoin`'s ack-callback placement never did. SA flagged an optional (non-blocking) hardening —
   a defensive same-room check inside `onRoomState` itself — added to the spec as a nice-to-have,
   not a Definition-of-Done item.
2. **Gap 2 (GamePage control-flow loss) — closed.** v1's `enterRoom()` returned `void`, which would
   have discarded `GamePage.tsx:361-364`'s existing early-return behavior (skip the rest of the
   reconnect/join effect body on same-room in-app navigation) if swapped in as-is. Corrected:
   `enterRoom()` now returns `boolean` (`true` = a different room is now active, proceed with
   join/reconnect; `false` = same room, caller should `return cleanup`), and `GamePage`'s call site
   becomes `const isNewRoom = useGameStore.getState().enterRoom(upperRoomCode); if (!isNewRoom)
   return cleanup;` — verified by SA to reproduce the old guard's behavior in all three original
   branches (same room / different room / no room at all on full reload). SA also required the
   return value never be named/documented as "reset occurred" (e.g. `wasReset`) since it can be
   `true` in the null-`store.room` branch where nothing was reset; the doc now mandates neutral
   naming (`didEnter`/`isNewRoom`).
3. Incidental fix folded in during the signature correction: the room-code comparison inside
   `enterRoom()` now uppercases both sides, not just the incoming argument.

**v1 — initial requirements** (superseded by the corrections above): `enterRoom(roomCode): void`,
called inside `doJoin`'s ack callback in `LobbyPage.tsx`, direct swap-in at `GamePage.tsx:361-364`
with no return-value handling. Failed QA review on both points.
