# Bug Fix — Session/Reconnect Data Leaks Across Room Codes

**Status:** Ready for Developer
**Priority:** High (data integrity / player-facing confusion)
**Reported by:** User, live testing
**Confirmed by:** Product Manager + Solution Architect (technical sign-off below)
**Revision:** v2 — revised after QA FAIL; see "QA Findings Addressed in v2" at the bottom for a change log against v1.

---

## 1. Problem Statement

A player finished a game in room `Y9E3XX`. The host then started a brand-new game, producing a new room code `ZZP7J6`. When the client navigated to `/game/ZZP7J6`, it still showed session/player identity data from the **previous** room (`Y9E3XX`) instead of a clean session for the new room.

Two independent root causes were confirmed (client and server):

1. **Client — stale Zustand store reused across rooms.** In `GamePage.tsx` (line 354), the mount effect does `if (store.room) return cleanup;` — it treats ANY non-null `store.room` as "already navigated here normally," regardless of whether `store.room.roomCode` matches the room code in the current URL. If the previous game's room was never explicitly closed (`ROOM_CLOSED`) or the player wasn't kicked, `useGameStore`'s `reset()` never fires, so the old room's players/character/vote state renders under the new room code.
2. **Client — global, unscoped cookies.** In `socket.ts`, `SESSION_TOKEN_KEY` (`bunker_session`) and `RECONNECT_TOKEN_KEY` (`bunker_reconnect`) are stored as flat cookies with `path=/`, not scoped to any room code. Any page in the app reads whatever token happens to be cached, regardless of which room the user is currently viewing.
3. **Server — reconnect path ignores requested room code.** In `roomHandlers.ts`, the `ROOM_JOIN` handler's reconnect branch (lines 92–177) resolves `existingPlayerId` from the `reconnectToken` and reconnects the socket into that player's existing room — **without ever checking that this room's `roomCode` matches the `roomCode` the client sent in the payload.** A stale reconnect token from `Y9E3XX` will silently reconnect the client into `Y9E3XX` even when the client explicitly requested `ZZP7J6`. This is the server-authoritative gap that the client hygiene fixes alone cannot fully close (e.g., manual URL edits, stale invite links, two tabs on different rooms).

## 1a. Complete Call-Site Inventory — `SESSION_TOKEN_KEY` / `RECONNECT_TOKEN_KEY`

QA correctly flagged that v1 of this spec only scoped `socket.ts`'s `auth` callback and `GamePage.tsx`'s mount effect, while three other files also read or write these two cookie keys. **All of the following call sites are explicitly in scope for this fix.** After the fix, every one of them MUST read and write the room-scoped cookie name (`bunker_session_<ROOMCODE>` / `bunker_reconnect_<ROOMCODE>`), computed from whatever room code is available in that call site's local scope (URL param, HTTP response, or ack payload) — never the flat legacy name. Missing even one call site reintroduces the bug for that flow.

| # | File | Line(s) | Key(s) | What it does | Room code available from |
|---|---|---|---|---|---|
| 1 | `packages/client/src/socket/socket.ts` | 36-37 | both (read) | `auth` callback passed to `io()`, evaluated at `socket.connect()` time; injects tokens into the Socket.IO handshake | **No React/route context in this module** — see Section 4 for the resolution approach (`setActiveRoomCode()`) |
| 2 | `packages/client/src/pages/HomePage.tsx` | 71-72 | both (write) | After successful room creation (`POST /api/rooms`), before connecting the socket | `data.roomCode` (HTTP response body) |
| 3 | `packages/client/src/pages/HomePage.tsx` | 96 | reconnect (write) | Inside the `ROOM_JOIN` ack callback for the room-creation flow | `data.roomCode` (same scope as #2) |
| 4 | `packages/client/src/pages/LobbyPage.tsx` | 203 | session (read) | `doJoin()` — reads session token to attempt a join/reconnect as this room's existing player | `roomCode` (`useParams`) |
| 5 | `packages/client/src/pages/LobbyPage.tsx` | 214 | reconnect (write) | Inside the `ROOM_JOIN` ack callback in `doJoin()` | `roomCode` (`useParams`, same scope as #4) |
| 6 | `packages/client/src/pages/LobbyPage.tsx` | 244 | reconnect (read) | Mount effect — decides whether to treat this as "host already joined" vs. show the nickname form | `roomCode` (`useParams`) |
| 7 | `packages/client/src/pages/GamePage.tsx` | 357 | reconnect (read) | Reload/reconnect mount effect — decides whether a reconnect token exists for this room | `roomCode` (`useParams`) |
| 8 | `packages/client/src/pages/GamePage.tsx` | 381 | session (read) | Same mount effect — builds the `ROOM_JOIN` reconnect payload | `roomCode` (`useParams`, same effect as #7) |
| 9 | `packages/client/src/pages/GamePage.tsx` | 386 | reconnect (write) | Same mount effect — writes the fresh reconnect token from the ack | `roomCode` (`useParams`, same effect as #7) |
| 10 | `packages/client/src/pages/GamePage.tsx` | 556 | reconnect (write) | `handleManualReconnect()` — the manual "enter your name to rejoin" form used by kicked players or players who lost their cookie | `roomCode` (`useParams`) |

**Requirement:** all 10 call sites above must be updated together, in the same change, to use the room-scoped cookie name. Updating only `socket.ts` and `GamePage.tsx`'s mount effect (as v1 did) leaves `HomePage.tsx` and `LobbyPage.tsx` writing the flat legacy key while `GamePage.tsx`/`socket.ts` read the room-scoped key — this breaks the normal first-time create-room → lobby → game flow, not just the reported bug's edge case. If a code review finds any additional read/write of these two constants beyond this table (e.g., a future file added after this spec was written), it is also in scope; grep for `SESSION_TOKEN_KEY` and `RECONNECT_TOKEN_KEY` before marking BUG-1 done.

**Acceptance criterion for call site #1 specifically:** because `socket.ts`'s `auth` callback has no route/room context of its own, `socket.ts` must export a new `setActiveRoomCode(code: string | null): void` setter that stores the room code in a module-level variable; the `auth` callback reads that variable (not `window.location.pathname`) to compute the room-scoped keys at handshake time. Every call site that triggers `socket.connect()` or a reconnect emit (`HomePage.tsx`, `LobbyPage.tsx`, `GamePage.tsx` — sites #2-10) must call `setActiveRoomCode(roomCode)` with the room code already in its local scope before connecting/emitting. This is a required new piece of the fix, not an optional refactor — solution-architect-confirmed as the correct pattern (explicit dependency from each page, rather than socket.ts parsing the URL and implicitly coupling to the router's path scheme).

## 2. Expected Behavior (Acceptance Criteria)

**A. Fresh room, no session history**
Given a browser with no cookies for any room, when the player visits `/game/ZZP7J6` directly (e.g., a shared invite link opened in a fresh browser/incognito window, with no prior `store.room` and no reconnect cookie for `ZZP7J6`), then `GamePage`'s mount effect finds no reconnect token, sets `showReconnectForm = true`, and renders the existing manual reconnect-name form (`game.reconnect.title` / `game.reconnect.namePlaceholder` / `game.reconnect.button` — the same UI already implemented at `GamePage.tsx` lines 584-618) — not a vague "prompted for nickname" behavior, and with no reference to any other room's data. (Note: the ordinary first-time-join experience — nickname entry before a game exists — happens on `HomePage`/`LobbyPage`, not `GamePage`; a bare `/game/:roomCode` visit with no session is only reachable via a direct/shared link, which is why the reconnect-name form, not the lobby nickname form, is the correct expected UI here.)

**B. Same-room refresh still reconnects (must not regress S5-1)**
Given a player is active in room `Y9E3XX` and refreshes the browser on `/game/Y9E3XX`, when the page reloads, then the client automatically reconnects into `Y9E3XX` using the stored session/reconnect data for that room, exactly as today — no extra prompts, no loading freeze.

**C1. New room after finishing an old one — reached via normal navigation (host/player flow)**
Given a player finished (or is mid-game in) room `Y9E3XX`, and the host uses the in-app "Грати ще раз" / new-game flow which creates room `ZZP7J6` and calls `navigate()` to route players there through `HomePage`'s create-room flow or `LobbyPage`'s join flow (i.e., the client-side router transitions the SPA to `/game/ZZP7J6` or `/r/ZZP7J6` without a full page reload — `useGameStore` is NOT reset by a page reload), when the player lands on the new room's page, then:
 - The client does NOT render any player list, character card, vote state, or nickname left over from `Y9E3XX` (the stale-store guard in `GamePage.tsx` must detect `store.room.roomCode !== roomCode` from the URL and treat it as a fresh mount, clearing/ignoring the stale store).
 - The client does NOT send `Y9E3XX`'s session/reconnect tokens as if they belonged to `ZZP7J6` (each cookie read is scoped to `ZZP7J6`'s own key, per Section 1a).
 - The player goes through a clean join flow for `ZZP7J6` (or a legitimate reconnect into `ZZP7J6` if they are actually already a player in that room, per its own room-scoped cookie).

**C2. New room after finishing an old one — reached via direct URL / stale invite link**
Given a player has finished (or was mid-game in) room `Y9E3XX`, and the host has since started a new game producing room `ZZP7J6`, and the player instead arrives at `/game/ZZP7J6` via a **direct URL visit or a stale invite link** (full browser navigation — a fresh page load that hits `GamePage`'s mount effect directly, bypassing `HomePage`/`LobbyPage`'s `navigate()` calls entirely, so any in-memory `useGameStore` state from a prior SPA session in that same tab is irrelevant/already gone, but cookies persist across the full reload), when the mount effect runs, then:
 - It reads `Y9E3XX`'s cookies only if it (incorrectly) uses the flat/legacy key; with the fix, it reads the cookie key scoped to `ZZP7J6` and finds nothing (since the player has no `ZZP7J6`-scoped cookie yet), so it falls through to the manual reconnect-name form per Scenario A — it must NOT attempt to reconnect using `Y9E3XX`'s reconnect token.
 - Even in the defense-in-depth case where a client bug resends `Y9E3XX`'s token, the server's room-code-match check (Section 2E) rejects the mismatched reconnect and falls through to first-time-join, so the player never ends up inside `Y9E3XX`'s game state while the URL reads `ZZP7J6`.

**D. Old room data is preserved for its own reconnect**
Given a player has cookies/tokens associated with `Y9E3XX`, when they navigate back to `/game/Y9E3XX` later (within the existing 24h TTL), then they still reconnect successfully into `Y9E3XX` — old-room data is not deleted, only prevented from leaking into other rooms.

**E. Server rejects mismatched reconnect attempts (defense in depth)**
Given the server receives a `ROOM_JOIN` event with `roomCode: ZZP7J6` and a `reconnectToken` that resolves to a player whose actual room is `Y9E3XX`, when the server processes this event, then it must NOT reconnect the client into `Y9E3XX`. The server treats the mismatched token exactly as if it were absent and falls through to the first-time-join path for `ZZP7J6` — the ack returned to the client is the same shape/outcome as a first-time join with no reconnect token at all (i.e., either a successful first-time-join ack for `ZZP7J6`, or the standard `INVALID_NICKNAME`/nickname-required error if no nickname was supplied — never a reconnect into `Y9E3XX`, and never a distinct new error code invented for this case).

**F. Multi-tab session-claim still works (must not regress BACKLOG 3.1.3)**
Given two browser tabs are open on the SAME room with the same session, when one tab claims the session (via the existing `BroadcastChannel`), then the other tab is still correctly notified and shows "Сесія перенесена" — this behavior must not be broken by any change to how session tokens are stored or keyed. Tabs open on DIFFERENT room codes must never trigger a false "session transferred" notice for each other.

**G. Kicked-player reconnect still works post-fix**
Given a player was kicked from room `AAAA11` and lost (or never had) their reconnect cookie, when they use `GamePage.tsx`'s manual reconnect-name form (`handleManualReconnect`, line 556) to type their nickname and rejoin `AAAA11`, then the join succeeds exactly as it does today, and the fresh reconnect token returned in the ack is written under the `AAAA11`-scoped cookie key (call site #10 in Section 1a) — not the flat legacy key. A subsequent page reload on `/game/AAAA11` must then also succeed using that same room-scoped cookie (regression check against Scenario B's mechanism, applied to the kick-reconnect path specifically).

**H. Host-transfer timer/reconnect unaffected by room-scoping change**
Given the current host disconnects mid-game and the server's 60-second host-transfer timer elects a new host (per `hostHandlers.ts` / `TimerService.ts` — a purely server-side state change broadcast to clients via `room:state`, with no client-side cookie read or write involved in the transfer itself), when this happens, then: the room-scoping change to cookie keys must have zero effect on this flow, because host-transfer does not touch `SESSION_TOKEN_KEY`/`RECONNECT_TOKEN_KEY` on the client at all. The regression check is: (1) the disconnected original host, if they reconnect later using their own room-scoped cookie, reconnects as a regular (non-host) player, exactly as today; (2) the newly-elected host's session continues uninterrupted (their existing room-scoped cookie is untouched by the transfer); (3) no other player's cookie read/write is triggered by the transfer event itself.

## 3. Constraints

- Must NOT break **S5-1** (reconnect-on-refresh for the same room) — refreshing `/game/:roomCode` for a room the player is genuinely in must continue to reconnect automatically with no loading freeze.
- Must NOT break the existing **multi-tab session-claim** logic (`BroadcastChannel` in `socket.ts`) for two tabs on the same room.
- Must NOT weaken server-authoritative design — the server is the source of truth for which room a session/reconnect token is valid for; client-side scoping is hygiene/UX, not the sole safeguard.
- Old room's cached session data must remain retrievable (not deleted) for its own room code within the existing 24h TTL — this fix is about scoping/isolation, not clearing history.
- No change to the 24h cookie TTL policy or the `SameSite=Strict` cookie attributes unless the Solution Architect calls it out as necessary.
- **All 10 call sites listed in Section 1a must be updated in the same change** — partial migration (e.g., only `socket.ts` + `GamePage.tsx`) is not an acceptable implementation and will fail QA re-validation.

## 4. Solution Architect — Technical Sign-Off (for Developer reference)

The SA reviewed `socket.ts`, `HomePage.tsx`, `LobbyPage.tsx`, `GamePage.tsx`, `gameStore.ts`, `roomHandlers.ts`, and `SessionStore.ts` and confirmed the following approach is architecturally sound:

- **Client cookie namespacing:** Replace flat `bunker_session` / `bunker_reconnect` cookie names with per-room-code names, e.g. `bunker_session_<ROOMCODE>` / `bunker_reconnect_<ROOMCODE>`. `getCookie`/`setCookie` helpers stay generic; every one of the 10 call sites in Section 1a changes to build the room-scoped key from whichever room code is in scope there (URL param via `useParams`, or the HTTP/ack response's `roomCode` field) before reading/writing. No JSON blob or map needed — per-room cookie pairs self-expire via existing TTL.
- **`socket.ts`'s `auth` callback (call site #1) — no route context available:** add a module-level `setActiveRoomCode(code: string | null)` exported setter that each page (`HomePage`, `LobbyPage`, `GamePage`) calls with the room code it knows about *before* invoking `socket.connect()`. The `auth` callback closure reads this module-level variable (not `window.location.pathname` parsing, which is fragile against route changes) to compute the room-scoped cookie keys at handshake time. `getStoredTokens()` becomes a function of the currently-active room code rather than a fixed pair of keys. SA-confirmed: option (a), a module-level setter, is correct over parsing `window.location.pathname` — it keeps `socket.ts` agnostic of the router's URL scheme and makes each page's dependency on "which room is active" explicit rather than inferred.
- **Stale-store guard:** `GamePage.tsx`'s `if (store.room) return cleanup;` must be changed to also check `store.room.roomCode === roomCode` (URL param) — on mismatch, treat it as a fresh mount (clear/ignore the stale store data) and proceed through the normal join/reconnect path for the new room code.
- **BroadcastChannel payload:** Add `roomCode` to the `SESSION_CLAIMED` message; a tab only treats itself as displaced when both `roomCode` and `sessionToken` match the current tab's values. Flagged as a required sub-task, not optional — protects against edge cases where a user has cookies cached for two different rooms in two tabs.
- **Server-side fix (required, not optional):** In `roomHandlers.ts`'s `ROOM_JOIN` reconnect branch, after resolving `existingPlayerId` and `found`, add a check that `found.room.roomCode === roomCode` (the roomCode from the incoming payload) before treating it as a valid reconnect. On mismatch, fall through to the first-time-join path rather than reconnecting into the wrong room.
- **Host-transfer confirmed out of scope for cookie changes:** host-transfer-on-disconnect is implemented entirely server-side (`hostHandlers.ts` + `TimerService.ts`), broadcasting the new host via `room:state`. It does not read or write `SESSION_TOKEN_KEY`/`RECONNECT_TOKEN_KEY` on the client, so the cookie-scoping change carries no regression risk to that flow beyond the normal reconnect path already covered by Scenarios B/D/G.
- Confirmed: S5-1 same-room refresh continues to work under this approach (cookie key computed from the URL's room code is identical on both write and read for a genuine same-room refresh).
- Confirmed: multi-tab session-claim continues to work for same-room tabs once `roomCode` is added to the broadcast comparison.

This fix therefore spans **client** (`socket.ts`, `HomePage.tsx`, `LobbyPage.tsx`, `GamePage.tsx`) and **server** (`roomHandlers.ts`) — it is not a client-only change, and not a two-file client change.

## 5. Definition of Done (for QA)

- [ ] Scenario A verified: direct/fresh visit to `/game/:roomCode` with no cookies for that room → `showReconnectForm` renders the manual reconnect-name form (`game.reconnect.*` UI) — no stale data from any other room.
- [ ] Scenario B verified: refresh on the same room the player is active in → automatic reconnect, no freeze (S5-1 regression check).
- [ ] Scenario C1 verified: play a full game to completion in room X, host starts a new game producing room Y via the normal in-app flow (SPA navigation, no full reload), land on room Y → no leftover players/character/nickname/vote state from room X is visible at any point, and no `ROOM_JOIN` payload for room Y carries room X's tokens.
- [ ] Scenario C2 verified: with room Y already created (per above), open a fresh tab/incognito window and paste a stale invite link or manually typed URL for room Y (or, to specifically exercise the leak path, attempt with only room X's cookies present in the browser and no room-Y cookie) → no reconnect into room X occurs; client falls through to the reconnect-name form or a clean first-time join for Y.
- [ ] Scenario D verified: after Scenario C1, navigate back to room X's URL (still within 24h) → reconnect into room X still succeeds.
- [ ] Scenario E verified (server-level test): craft a `ROOM_JOIN` with a valid reconnectToken for room X but `roomCode: Y` in the payload → server does NOT reconnect into room X; falls through to the first-time-join path for Y (same ack shape as a first-time join with no reconnect token).
- [ ] Scenario F verified: two tabs on the same room — session-claim notice still fires correctly; two tabs on different rooms — no false session-claim notice between them.
- [ ] Scenario G verified: kicked player uses the manual reconnect-name form to rejoin their room → succeeds, and the fresh reconnect token is written under that room's scoped cookie key (confirmed via a subsequent same-room reload succeeding, per Scenario B's mechanism).
- [ ] Scenario H verified: host disconnects mid-game, 60s timer elects a new host → no client cookie side effects observed for any connected player; disconnected original host, if reconnecting later, comes back as a regular player using their own room-scoped cookie.
- [ ] All 10 call sites in Section 1a confirmed updated to use room-scoped cookie keys (code review / grep check — no remaining flat-key reads or writes).
- [ ] No regression in existing Vitest reconnect-resilience suite; new unit/integration tests added for the room-code-mismatch server check and the client stale-store guard.
- [ ] Manual smoke test of the full "finish game → host starts new game → join new room" flow performed against the live dev server, matching the user's original repro (`Y9E3XX` → `ZZP7J6`).

---

## QA Findings Addressed in v2

This revision closes the following gaps identified by QA's review of v1:

1. **Incomplete call-site inventory (FAIL item 1)** — Section 1a now enumerates all 10 read/write call sites across `socket.ts`, `HomePage.tsx`, `LobbyPage.tsx`, and `GamePage.tsx`, with the room-code source for each. Section 4 adds the `setActiveRoomCode()` mechanism to resolve `socket.ts`'s auth-callback gap (no route context available at that call site). Section 3 adds an explicit constraint that all 10 sites must move together.
2. **Ambiguous Scenario C repro mechanism (FAIL item 2)** — split into Scenario C1 (reached via normal `navigate()` from `HomePage`/`LobbyPage`, no full page reload, stale-store-guard code path) and Scenario C2 (reached via a direct URL visit / stale invite link, full page reload, mount-effect-and-cookie code path). Each has its own DoD checkbox.
3. **Missing host-transfer / kicked-player regression scenarios (FAIL item 3)** — added Scenario G (kicked-player reconnect via `handleManualReconnect`, call site #10) and Scenario H (host-transfer timer, confirmed server-only with no client cookie interaction) with matching DoD checkboxes.
4. **Two-way DoD branch on Scenario E (FAIL item 4)** — Scenario E's acceptance criteria and DoD checkbox now both state a single expected outcome: fall-through to the first-time-join path, ack shape identical to a first-time join with no reconnect token — no error/prompt branch is proposed as an alternative.
5. **Scenario A's expected UI didn't match current behavior (FAIL item 5)** — Scenario A now states precisely that the existing manual reconnect-name form (`game.reconnect.title`/`namePlaceholder`/`button`, `GamePage.tsx` lines 584-618) is the expected UI, not a vague "prompted for nickname or routed through normal join flow."
</content>
