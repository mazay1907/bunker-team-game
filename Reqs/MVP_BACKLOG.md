# MVP Work Breakdown Structure — Bunker Team Game

**Project:** bunker-team-game
**Version:** 0.1
**Created:** 2026-05-31
**Source of truth for game mechanics:** GAME_RULES.md
**Source of truth for product scope:** PRODUCT_VISION.md, EPICS.md, SCENARIOS.md, BACKLOG.md

**Priority legend:**
- P0 — Launch blocker. Game cannot ship without this.
- P1 — Core experience. Game is incomplete or broken in a key scenario without this.
- P2 — Nice-to-have for MVP. Improves quality; can ship with a workaround.

**Scope note:** "Spectator" in this document refers exclusively to the in-game spectator state of an already-eliminated player (per GAME_RULES.md). It does NOT mean a public spectator / late-join feature, which is explicitly out of scope for MVP (see PRODUCT_VISION.md Out of Scope).

---

## 1.0 Project Foundation & Infrastructure

### 1.1 Repository & Project Setup

#### 1.1.1 Initialize repository
Set up git repository with .gitignore, README, and license file; project must be commitable from day one.
**Priority:** P0

#### 1.1.2 Define and scaffold project structure
Create top-level folders for front-end app, back-end server, and content (cards / scenarios); structure must match Solution Architect's approved tech stack.
**Priority:** P0

#### 1.1.3 Configure development environment
Add scripts for local dev start, build, and lint; any developer should be able to run the project with one command after cloning.
**Priority:** P0

### 1.2 Real-Time Transport

#### 1.2.1 Implement WebSocket server
Stand up the chosen real-time library (e.g., Socket.IO or native WS per SA decision); server accepts connections and logs connect/disconnect events.
**Priority:** P0

#### 1.2.2 Implement client WebSocket connection
Front-end connects to the WS server on load; reconnects automatically on transient drop; connection status is observable by the application layer.
**Priority:** P0

#### 1.2.3 Define event naming convention and message schema
Document (in code comments or a schema file) all WS event names and payload shapes used across the system; prevents drift between client and server.
**Priority:** P0

### 1.3 Deployment & Monitoring

#### 1.3.1 Implement /health endpoint
Server exposes a GET /health endpoint returning HTTP 200 and uptime info; required for hosting-platform health checks.
**Priority:** P1

#### 1.3.2 Configure local dev environment
Ensure any developer can clone the repo and run the full app with `pnpm install && pnpm dev`. Docker scaffolding (Dockerfile + docker-compose.yml) is included from Sprint 0 so the app can be deployed to any Docker-compatible host (Railway, Render, Fly.io, bare VPS) without code changes. No domain, TLS, or hosting account is required for MVP. Invite links use `localhost` in dev.
**Priority:** P0

#### 1.3.3 Add basic analytics event emission
Emit non-PII events (room_created, game_started, game_completed, player_joined) to a simple in-memory log or lightweight analytics sink; no third-party tracker required.
**Priority:** P2

---

## 2.0 Room Management

### 2.1 Room Creation

#### 2.1.1 Implement room code generation
Generate a unique 6-character alphanumeric room code on request; collision-safe (retry on duplicate); code stored in room state.
**Priority:** P0

#### 2.1.2 Implement shareable room URL construction
Construct a full invite URL from the room code (e.g., /r/BUNKER42); URL must be copyable and open the join flow when visited.
**Priority:** P0

#### 2.1.3 Build "Create Room" home page action
Host enters a nickname (2-20 characters), clicks "Створити кімнату"; inline validation blocks empty or out-of-range nicknames; on success, room is created and host is redirected to lobby.
**Priority:** P0

#### 2.1.4 Build "Join by Code" home page action
Player enters a room code manually on the home page; navigates to the join flow; shows "Room not found" if code is invalid.
**Priority:** P1

### 2.2 Lobby & Player List

#### 2.2.1 Build lobby UI shell
Display room code, copy-invite-link button, real-time player list with host badge, and "Почати гру" button; all strings in Ukrainian.
**Priority:** P0

#### 2.2.2 Implement real-time player list updates
Broadcast player-joined and player-left events to all lobby members; player list updates without a page refresh.
**Priority:** P0

#### 2.2.3 Implement player count enforcement
Disable the Start button when fewer than 6 or more than 10 players are present; show a tooltip with the specific reason; button enables automatically when count enters the valid range.
**Priority:** P0

#### 2.2.4 Implement host kick from lobby
Host-only "Видалити" control appears on each non-host player row; on click, that player is removed from the room and redirected to the home page with the message "Вас видалено з кімнати"; kick is disabled after the game has started.
**Priority:** P1

#### 2.2.5 Implement duplicate nickname handling in same lobby
If a joining player's nickname matches an existing player's, auto-append a numeric suffix (e.g., "Аня (2)"); do not reject the join.
**Priority:** P1

### 2.3 Room State & Lifecycle

#### 2.3.1 Implement room state model
Persist room entity with fields: room_id, host_player_id, state (LOBBY / IN_GAME / ENDED), players[], created_at, host_user_id (nullable FK placeholder for Phase 2).
**Priority:** P0

#### 2.3.2 Implement empty-room auto-expiry
A background job or scheduled check removes rooms with zero connected players that have been inactive for 30 minutes; prevents memory/storage leaks.
**Priority:** P1

#### 2.3.3 Show error pages for invalid room states
Render appropriate Ukrainian error messages for: room not found, room full (10 players), game already in progress; each error offers a clear next action (e.g., "Створити нову кімнату").
**Priority:** P1

---

## 3.0 Player Session & Identity

### 3.1 Anonymous Session Management

#### 3.1.1 Implement anonymous session token
Generate and store a session token in localStorage on first visit; token links a browser to a player slot (room_id + nickname + player_id); survives page refresh.
**Priority:** P0

#### 3.1.2 Implement session-to-room binding
When a player joins a room, their session token is bound to their player record; used to identify them on reconnect without requiring a password or login.
**Priority:** P0

#### 3.1.3 Handle multiple tabs of the same player
Detect when a player opens a second tab with the same session token; the newest tab takes over the active session; the old tab shows "Сесія перенесена" message.
**Priority:** P1

---

## 4.0 Apocalypse Scenario System

### 4.1 Scenario Content

#### 4.1.1 Author 3-5 Ukrainian apocalypse scenarios
Write scenario content (in a separate JSON/YAML data file, not in code) for 3-5 scenarios, each with: title, description text, and bunker conditions (size, supply duration, outside environment).
**Priority:** P0

#### 4.1.2 Structure scenario data model
Define the schema for a scenario record (id, title, description, bunker_conditions, is_premium: always false in MVP); store in a structured content file separate from application code.
**Priority:** P0

### 4.2 Scenario Selection

#### 4.2.1 Build scenario picker modal
At game start, host sees a modal listing all available scenarios plus a "Випадково" option; host must make a selection before proceeding; players see a "waiting for host to pick scenario" state.
**Priority:** P0

#### 4.2.2 Implement random scenario selection
"Випадково" picks a scenario uniformly at random from the available set and proceeds identically to a manual pick.
**Priority:** P0

#### 4.2.3 Display scenario card during the game
Show the selected scenario's title, description, and bunker conditions in a persistent panel visible to all players throughout all rounds; panel does not interfere with the main game actions.
**Priority:** P0

---

## 5.0 Character Card System

### 5.1 Character Content

#### 5.1.1 Author Ukrainian character trait pool
Write ~30 distinct values per trait category × 7 categories (Стать/вік, Професія, Здоров'я, Хобі, Фобія, Багаж, Факт); all content in Ukrainian; stored in a structured data file separate from code.
**Priority:** P0

#### 5.1.2 Structure character card data model
Define schema for a character card: player_id, and 7 trait fields each having value and is_revealed (boolean); is_revealed defaults to false at deal time.
**Priority:** P0

### 5.2 Character Dealing

#### 5.2.1 Implement unique character dealing per session
At game start, randomly assign one character card to each player; no two players in the same session receive a character with an identical combination of traits; deal is deterministic once triggered (no re-deal mid-game).
**Priority:** P0

#### 5.2.2 Implement character pool reset on "Play Again"
When the host starts a new game from the end screen (same lobby), generate a completely new set of character cards for all players; do not reuse the previous session's assignments.
**Priority:** P1

### 5.3 Character Card Visibility

#### 5.3.1 Implement own card full-visibility rule
A player always sees all 7 traits of their own character card in full, regardless of which traits they have or have not revealed to others.
**Priority:** P0

#### 5.3.2 Implement opponent card partial-visibility rule
A player sees another player's character card showing only the traits that player has revealed; unrevealed slots show a placeholder (e.g., "???"); the revealed data is the same for all observers.
**Priority:** P0

#### 5.3.3 Implement eliminated player full-reveal
When a player is eliminated (by vote or by auto-elimination), all 7 traits on their card are marked is_revealed = true and broadcast to all connected clients immediately.
**Priority:** P0

---

## 6.0 Round & Phase Engine

### 6.1 Game State Machine

#### 6.1.1 Implement game state machine
Define and enforce the state sequence: LOBBY → SCENARIO_PICK → R1_REVEAL → R1_DEBATE → R1_VOTE → R2_REVEAL → R2_DEBATE → R2_VOTE → R3_REVEAL → R3_DEBATE → R3_VOTE → ENDED; transitions are server-authoritative, not client-driven.
**Priority:** P0

#### 6.1.2 Broadcast state transitions to all clients
On every state transition, server emits an event to all room members; each client re-renders its view to match the new phase; no client should be left in a stale phase.
**Priority:** P0

#### 6.1.3 Persist current round and phase in room state
Room state stores current_round (1-3) and current_phase (REVEAL/DEBATE/VOTE/ENDED); used for reconnect re-sync and for validating action legality.
**Priority:** P0

### 6.2 Reveal Phase

#### 6.2.1 Implement per-round reveal quota
Enforce reveal counts per round: Round 1 = 2 traits, Round 2 = 2 traits, Round 3 = 1 trait; confirm button is disabled until exactly the required number of traits is selected.
**Priority:** P0

#### 6.2.2 Prevent re-reveal of already-revealed traits
In the trait selection UI, traits already revealed in previous rounds are visually marked and not selectable; the server rejects any attempt to reveal a previously revealed trait.
**Priority:** P0

#### 6.2.3 Implement simultaneous reveal submission
Players select and confirm their traits independently; the server collects submissions and advances to debate phase only when every active (non-eliminated, connected) player has submitted; a "waiting for [N] players" indicator is shown.
**Priority:** P0

#### 6.2.4 Broadcast revealed traits to all players in real time
When a player submits their reveals, the newly revealed traits are immediately visible to all connected clients; no page refresh required.
**Priority:** P0

#### 6.2.5 Implement reveal timeout with auto-selection
If a configurable reveal timer expires and a player has not submitted, the server automatically selects the required number of traits at random from their unrevealed pool and submits on their behalf; player is notified.
**Priority:** P2

### 6.3 Debate Phase

#### 6.3.1 Implement debate phase timer
Start a server-side countdown of 5 minutes (configurable) when debate phase begins; timer value is broadcast to all clients for display; voting phase opens automatically when timer reaches zero.
**Priority:** P0

#### 6.3.2 Implement host "+1 minute" extension
Host can click "+1 хв" during debate to add 60 seconds to the current timer; extension is broadcast to all clients immediately; can be used multiple times.
**Priority:** P1

#### 6.3.3 Implement host force-advance to voting
Host can click "Голосувати зараз" during debate to cancel the timer and open voting immediately; change is broadcast to all clients; action requires no confirmation.
**Priority:** P1

---

## 7.0 Voting & Elimination

### 7.1 Voting Mechanics

#### 7.1.1 Implement open voting UI
Display a voting panel listing all non-eliminated players except the voting player themselves; each voter selects exactly one target and confirms; self-voting is disabled at the UI and server levels.
**Priority:** P0

#### 7.1.2 Implement real-time vote display
As each player submits their vote, broadcast the vote (voter → target) to all connected clients; the live tally is visible to everyone during the voting phase (open vote, per GAME_RULES.md).
**Priority:** P0

#### 7.1.3 Implement vote-completion detection
Voting phase ends when all active players have voted; server tallies votes and determines the player with the highest count.
**Priority:** P0

#### 7.1.4 Enforce one-vote-per-player-per-round
Server validates that a player has not already submitted a vote in the current round before accepting a new vote submission; duplicate vote submissions are rejected.
**Priority:** P0

### 7.2 Tie Resolution

#### 7.2.1 Implement re-vote on first-round tie
If two or more players are tied for the highest vote count, server automatically initiates a re-vote limited to only the tied players as candidates; all active players vote again.
**Priority:** P0

#### 7.2.2 Implement host tiebreaker after persistent tie
If the re-vote also results in a tie, only the current host is presented with a deciding vote between the still-tied players; their choice is final and eliminates the selected player.
**Priority:** P0

#### 7.2.3 Implement fallback tiebreaker when host is eliminated
If the host has been eliminated before the tiebreaker moment, the deciding vote is given to the longest-connected non-eliminated player; this player is identified server-side by join timestamp.
**Priority:** P1

### 7.3 Disconnected Voter Handling

#### 7.3.1 Implement 30-second reconnect window during voting
If a player disconnects during the voting phase, the server holds their vote slot open for 30 seconds; other players see a "[name] перепідключається…" indicator.
**Priority:** P1

#### 7.3.2 Implement host prompt for extended voting wait
After the 30-second window elapses for a disconnected voter, present the host with two options: "Зачекати ще хвилину" (adds 60 seconds and repeats the prompt if still disconnected) or "Пропустити голос" (removes that player's vote slot from the tally, reducing the active pool by 1); this matches the exact mechanic in GAME_RULES.md.
**Priority:** P1

#### 7.3.3 Implement vote abstention after host decision to skip
If the host chooses "Пропустити голос", mark that player's vote as abstained; reduce the total active vote pool by 1 for tally purposes; proceed with remaining votes.
**Priority:** P1

### 7.4 Elimination

#### 7.4.1 Implement player elimination state
Mark eliminated players with status = ELIMINATED; store elimination round; they no longer appear as voteable targets in subsequent rounds and cannot submit votes.
**Priority:** P0

#### 7.4.2 Implement eliminated player spectator view
An eliminated player's UI transitions to a spectator view: they see the full game state (all revealed traits, votes, scenario) in read-only mode; the vote panel and reveal panel are replaced with a spectator label; they remain connected.
**Priority:** P0

#### 7.4.3 Enforce one elimination per round
Server validates that exactly one player is eliminated per round before advancing the state machine; no round can be skipped or produce more than one elimination by voting (auto-elimination from disconnect follows a separate path defined in section 9).
**Priority:** P0

---

## 8.0 Game End & Replay

### 8.1 Game End Screen

#### 8.1.1 Build game end screen
After Round 3 elimination, transition all clients to the ENDED view showing: survivors panel (full character cards of all non-eliminated players), eliminated panel (all eliminated players in elimination order with full cards), and outcome summary text (e.g., "У бункері залишились…").
**Priority:** P0

#### 8.1.2 Implement outcome summary text generation
Generate template-based outcome text listing survivors by profession and/or other traits; text is in Ukrainian; no AI required — string templates are sufficient for MVP.
**Priority:** P1

#### 8.1.3 Confirm correct survivor count range
Survivor count is 3-7 (not 4-7 as stated in EPICS.md and SCENARIOS.md — with 6 players and 3 eliminations the minimum is 3 survivors per GAME_RULES.md). Acceptance criteria: end screen correctly shows 3 survivors when starting with 6 players.
**Priority:** P0

### 8.2 Replay & Room Close

#### 8.2.1 Implement "Play Again" flow
Host clicks "Грати ще раз"; same room and same player slots are preserved; a new scenario picker opens; new character cards are dealt to all players; game restarts at SCENARIO_PICK state.
**Priority:** P1

#### 8.2.2 Implement "End Session" flow
Host clicks "Завершити"; room is closed; all connected players see "Дякуємо за гру" with a link to create a new room; room is removed from active state.
**Priority:** P1

### 8.3 Host Early End

#### 8.3.1 Implement host force-end with confirmation
Host can click "Завершити гру" from the host actions panel at any point during an active game; a confirmation dialog appears; on confirm, all remaining cards are fully revealed and the game transitions to a modified end screen showing "Гру завершено достроково".
**Priority:** P1

---

## 9.0 Reconnection & Resilience

### 9.1 Reconnect Flow

#### 9.1.1 Implement 5-minute player session hold
When a player's WebSocket disconnects during an active game, the server preserves their player record and game state for 5 minutes; the player is not eliminated immediately.
**Priority:** P1

#### 9.1.2 Implement "reconnecting" indicator for other players
While a player is disconnected (within the 5-minute window), all other clients see a "[name] перепідключається…" indicator next to that player's name in the player list.
**Priority:** P1

#### 9.1.3 Implement full state re-sync on reconnect
When a player reconnects within the window, the server sends them the complete current game state: scenario, all revealed traits, current phase, voting state if active, and their own card; client renders the correct view without a manual refresh.
**Priority:** P1

#### 9.1.4 Implement session matching by token on reconnect
On reconnect, the server matches the incoming connection to an existing player slot using the session token from localStorage; if the token matches a live (not yet auto-eliminated) player slot in the room, the reconnect is accepted.
**Priority:** P1

### 9.2 Auto-Elimination on Timeout

#### 9.2.1 Implement auto-elimination after 5-minute timeout
If a player does not reconnect within 5 minutes, the server auto-eliminates them: their card is fully revealed, they are set to ELIMINATED status, and all clients are notified; this auto-elimination serves as the round's elimination — normal voting for that round is cancelled.
**Priority:** P1

#### 9.2.2 Implement single-elimination rule for simultaneous disconnects
If multiple players disconnect in the same round and all exceed the 5-minute timeout, only the first player to exceed the limit is auto-eliminated; the remaining timed-out players are returned to active (live) status for the next round or re-evaluated; this matches the edge case in GAME_RULES.md.
**Priority:** P1

#### 9.2.3 Exempt spectators from auto-elimination
Eliminated players (spectators) who disconnect are not subject to the 5-minute auto-elimination rule; their disconnect has no effect on the game state.
**Priority:** P1

### 9.3 Host Disconnect & Transfer

#### 9.3.1 Implement host disconnect detection
When the host's connection drops during an active game, all players see "Ведучий не на зв'язку…" indicator; a 60-second countdown begins before host transfer.
**Priority:** P1

#### 9.3.2 Implement host auto-transfer after 60 seconds
If the original host does not reconnect within 60 seconds, server assigns host status to the player with the earliest join timestamp who is still connected and non-eliminated; the new host is notified; all clients see the updated host badge.
**Priority:** P1

#### 9.3.3 Implement host status restoration on early return
If the original host reconnects within the 60-second window, they automatically regain host status without any manual action; no transfer occurs.
**Priority:** P1

#### 9.3.4 Handle host disconnect in lobby (pre-game)
If the host disconnects in the lobby (before game start), their player record is removed after standard disconnect detection (~10 seconds); host status transfers immediately to the longest-connected player remaining; if no players remain, the room is marked inactive.
**Priority:** P1

---

## 10.0 Host Controls Panel

### 10.1 Host UI

#### 10.1.1 Build host actions panel
Render a "Дії ведучого" panel visible only to the current host; contains action buttons appropriate to the current phase; panel is hidden from non-host players.
**Priority:** P1

#### 10.1.2 Display host badge
Show a visible host badge (e.g., crown icon or "(ведучий)" label) next to the current host's name in the player list; badge updates in real time if host status transfers.
**Priority:** P1

#### 10.1.3 Restrict host actions by game phase
Each host action button is enabled only in the phase where it is valid: kick is lobby-only; extend timer and force-vote are debate-phase-only; force-end is available in any in-game phase; no host action can fire in an invalid phase.
**Priority:** P0

---

## 11.0 Ukrainian Content & i18n Foundation

### 11.1 i18n Architecture

#### 11.1.1 Implement i18n string file
Extract all UI strings into a single Ukrainian-language i18n source file (e.g., uk.json or uk.ts); no hard-coded strings in component or server code; file structure allows adding other locales in Phase 4 without code changes.
**Priority:** P0

#### 11.1.2 Apply Ukrainian locale to date/time formatting
All timestamps and timer displays use Ukrainian locale formatting (Intl.DateTimeFormat or equivalent); no English-locale date strings appear in the UI.
**Priority:** P1

#### 11.1.3 Translate all error messages to Ukrainian
Every user-facing error (network errors, validation errors, room errors, vote errors) uses strings from the i18n file; no English or raw error codes shown to players.
**Priority:** P1

### 11.2 Content Files

#### 11.2.1 Separate all content from application code
Character trait pools, apocalypse scenarios, and UI copy are stored in data files (JSON or YAML) in a dedicated /content directory; changing content does not require modifying application logic.
**Priority:** P0

---

## 12.0 User Interface & Experience

### 12.1 Core Game Views

#### 12.1.1 Build home page
Page with "Створити кімнату" and "Приєднатися за кодом" actions; clean, minimal layout; all text in Ukrainian.
**Priority:** P0

#### 12.1.2 Build game view layout
Persistent layout with: scenario card panel (top or sidebar), player list with revealed traits, own character card panel (always visible to self), and action area (changes per phase); layout works at 1024px+ desktop widths.
**Priority:** P0

#### 12.1.3 Build player list component
Display each player's name, host badge if applicable, revealed trait chips, and status (active / reconnecting / eliminated-spectator); updates reactively on any player state change.
**Priority:** P0

#### 12.1.4 Build own character card component
Show all 7 traits of the player's own character; visually distinguish revealed traits (shown to others) from unrevealed traits; uses Ukrainian labels for each category.
**Priority:** P0

#### 12.1.5 Build reveal selection UI
For the reveal phase: show selectable trait list with correct quota displayed (e.g., "Оберіть 2 характеристики"); confirm button disabled until quota is met; already-revealed traits are non-selectable.
**Priority:** P0

#### 12.1.6 Build voting UI
Show list of valid vote targets (non-self, non-eliminated players); allow selecting one; show live vote counts as other players submit; confirm button; self is excluded.
**Priority:** P0

#### 12.1.7 Build debate phase timer display
Show a countdown timer during debate phase visible to all players; host controls (extend, skip) appear alongside for host only.
**Priority:** P0

### 12.2 Onboarding & Help

#### 12.2.1 Build "How to play" overlay
First-time-player overlay or tooltip summarizing the game structure (3 rounds, reveal / debate / vote, survival goal) in Ukrainian; dismissable; can be reopened from a help icon.
**Priority:** P1

### 12.3 Responsive & Visual Polish

#### 12.3.1 Implement mobile-browser-friendly responsive layout
Game UI is usable on mobile browsers in landscape mode (no horizontal scroll, tap targets adequately sized); no native app required.
**Priority:** P1

#### 12.3.2 Apply base visual style
Consistent typography, color palette, and spacing that ensures comfortable reading and adequate contrast (WCAG AA minimum); no heavy theming or illustrations required for MVP.
**Priority:** P1

#### 12.3.3 Add favicon and Open Graph meta tags
Page has a favicon and OG title/description/image tags so that the shared invite link renders a preview card in Slack, Telegram, and social platforms.
**Priority:** P2

---

## 13.0 Operations & Developer Experience

### 13.1 Logging & Debugging

#### 13.1.1 Implement server-side session event log
Log key events per room (room_created, player_joined, game_started, round_advanced, player_eliminated, game_ended) to an in-memory or simple persistent log; used for debugging during early plays.
**Priority:** P2

### 13.2 Documentation

#### 13.2.1 Write setup and run instructions in README
README covers: prerequisites, how to install dependencies, how to start dev server, how to run any tests, and how to deploy; any developer should be able to onboard without verbal instructions.
**Priority:** P1

---

## WBS Summary

| Section | Area | P0 Tasks | P1 Tasks | P2 Tasks | Total |
|---|---|---|---|---|---|
| 1.0 | Foundation & Infrastructure | 5 | 1 | 1 | 7 |
| 2.0 | Room Management | 6 | 4 | 0 | 10 |
| 3.0 | Player Session & Identity | 2 | 1 | 0 | 3 |
| 4.0 | Apocalypse Scenario System | 5 | 0 | 0 | 5 |
| 5.0 | Character Card System | 5 | 1 | 0 | 6 |
| 6.0 | Round & Phase Engine | 8 | 3 | 1 | 12 |
| 7.0 | Voting & Elimination | 8 | 6 | 0 | 14 |
| 8.0 | Game End & Replay | 2 | 5 | 0 | 7 |
| 9.0 | Reconnection & Resilience | 0 | 11 | 0 | 11 |
| 10.0 | Host Controls Panel | 1 | 2 | 0 | 3 |
| 11.0 | Ukrainian Content & i18n | 2 | 2 | 0 | 4 |
| 12.0 | UI & Experience | 7 | 3 | 2 | 12 |
| 13.0 | Operations & Dev Experience | 0 | 1 | 1 | 2 |
| **Total** | | **51** | **40** | **5** | **96** |

**P0 tasks: 51** — game cannot ship without all of these.
**P1 tasks: 40** — game is incomplete or brittle without these; should all land before any non-owner team plays.
**P2 tasks: 5** — polish items; can ship with workarounds.
**Grand total: 96 tasks.**

---

## Sprint 0 — Developer Kick-off Tasks

**Added by:** Solution Architect Agent
**Date:** 2026-05-31
**Purpose:** Concrete, immediately actionable tasks to begin coding. Ordered by hard dependency. Complete all S0 tasks before starting any other WBS item. These tasks correspond to WBS sections 1.0, 2.0, 3.0, and 5.0 (partial) but are broken into the smallest independently-deliverable slices with explicit acceptance criteria.

**Tech stack reference:** See `Architecture/TECH_STACK.md`, `Architecture/CODE_STANDARDS.md`, `Architecture/DATA_MODEL.md`, `Architecture/API_DESIGN.md`.

---

### S0-1 — Monorepo Scaffold

**Title:** Initialize pnpm workspace monorepo with three packages

**Description:**
Create the project skeleton exactly as defined in `Architecture/CODE_STANDARDS.md`. The result is a runnable (though empty) monorepo where all three packages (`client`, `server`, `shared`) can be built and type-checked from the root.

Steps:
1. `git init` with a `.gitignore` that covers `node_modules/`, `dist/`, `.env`, `*.local`
2. Create `pnpm-workspace.yaml` listing `packages/*`
3. Create `packages/shared/` with `package.json` (name: `@bunker/shared`), `tsconfig.json`, and `src/index.ts` (empty export)
4. Create `packages/server/` with `package.json` (name: `@bunker/server`), `tsconfig.json` extending `tsconfig.base.json`, and `src/index.ts` (prints "Server starting")
5. Create `packages/client/` using `pnpm create vite` with React + TypeScript template; delete the default boilerplate content (keep only the Vite config and empty `App.tsx`)
6. Add `tsconfig.base.json` at root with `strict: true` and path alias `@bunker/shared` → `packages/shared/src`
7. Add root-level `pnpm lint` script wiring ESLint and Prettier across all packages
8. Add root-level `pnpm dev` script that starts both server and client with `concurrently`
9. Add placeholder `Dockerfile` and `docker-compose.yml` at the repo root (stubs are fine at S0-1; the full implementation is S0-9)

**Acceptance Criteria:**
- [ ] `pnpm install` succeeds from root with no errors
- [ ] `pnpm -r build` (or equivalent) type-checks all three packages without TypeScript errors
- [ ] `packages/client` imports a type from `packages/shared` successfully (add one dummy type to shared to verify)
- [ ] `packages/server` imports a type from `packages/shared` successfully
- [ ] `pnpm lint` runs without configuration errors (no lint violations required yet — just the command must work)
- [ ] `.gitignore` covers `node_modules/`, `dist/`, `.env`
- [ ] A `README.md` at root lists the prerequisites and the commands to install and run

**Complexity:** M

---

### S0-2 — Shared Event Type Definitions

**Title:** Define all Socket.IO event payload types in `packages/shared`

**Description:**
Create the canonical TypeScript types for every Socket.IO event the game will use. This is the single most important task for preventing client/server drift. All subsequent server and client tasks import from this file.

Create `packages/shared/src/events.ts` with:
- All payload interfaces as listed in `Architecture/API_DESIGN.md`
- The `EVENTS` constant object mapping event name keys to string literals
- Re-export everything from `packages/shared/src/index.ts`

Create `packages/shared/src/models.ts` with:
- `Room`, `Player`, `CharacterCard`, `TraitSlot`, `TraitCategory`, `Round`, `Game`, `Scenario`, `Trait`
- `PlayerView`, `RoomView`, `GameView` (the "safe" client-facing shapes)
- `RoomState`, `PlayerStatus` union types

**Acceptance Criteria:**
- [ ] All types compile with `strict: true` and zero errors
- [ ] The `EVENTS` constant is used in both a server handler file and a client emit call (even a placeholder) — no raw string event names anywhere else in the codebase
- [ ] `PlayerView.visibleTraits` only contains revealed traits when constructed (enforce via type — the server-side builder must filter before constructing this shape)
- [ ] Every acknowledgement type is defined (e.g., `RoomJoinAck`, `RevealSubmitAck`, `VoteSubmitAck`) as a discriminated union `{ ok: true; ... } | { ok: false; error: ErrorCode }`
- [ ] Error codes are typed string literals, not plain `string`

**Complexity:** M

---

### S0-3 — WebSocket Server Foundation

**Title:** Stand up Fastify server with Socket.IO and verified connect/disconnect handling

**Description:**
Create the running server process with:
1. Fastify instance on port from `process.env.PORT` (default 3000)
2. Socket.IO attached to the Fastify HTTP server (use `@fastify/websocket` adapter or the standard `socket.io` attach method)
3. `GET /health` returning `{ status: "ok", uptime: process.uptime(), activeRooms: 0 }`
4. Socket.IO middleware that reads the session token from the socket handshake auth (`socket.handshake.auth.sessionToken`) — store it on the socket object for use by handlers
5. `connection` event handler that logs `[connect] socketId` and sets up the `disconnect` handler that logs `[disconnect] socketId reason`
6. All Socket.IO event names must come from the `EVENTS` constant imported from `@bunker/shared`
7. Fastify serves the React `dist/` folder as static files with a catch-all returning `index.html` (SPA fallback) — the static folder may be empty for now

**Acceptance Criteria:**
- [ ] `pnpm dev` starts the server and it listens on the configured port
- [ ] `GET /health` returns HTTP 200 with the JSON body described above
- [ ] A Socket.IO client connecting from a test script (or browser) triggers the connect log line
- [ ] Disconnecting the client triggers the disconnect log line
- [ ] No TypeScript errors
- [ ] Port is read from `process.env.PORT` with fallback to 3000 — no hard-coded ports

**Complexity:** S

---

### S0-4 — In-Memory Room Store and Session Store

**Title:** Implement `RoomStore` and `SessionStore` interfaces with in-memory implementations

**Description:**
Create the storage layer as described in `Architecture/DATA_MODEL.md` and `Architecture/TECH_STACK.md`. The store must be behind an interface so Phase 2 can swap to Redis without touching game logic.

`packages/server/src/store/RoomStore.ts`:
- Interface `IRoomStore` with methods: `createRoom(room: Room): void`, `getRoom(roomId: string): Room | undefined`, `getRoomByCode(code: string): Room | undefined`, `updateRoom(roomId: string, updater: (r: Room) => Room): void`, `deleteRoom(roomId: string): void`, `getAllRooms(): Room[]`
- Class `InMemoryRoomStore` implementing the interface using a `Map<string, Room>`

`packages/server/src/store/SessionStore.ts`:
- Interface `ISessionStore` with methods: `set(sessionToken: string, playerId: string): void`, `get(sessionToken: string): string | undefined`, `delete(sessionToken: string): void`
- Class `InMemorySessionStore` implementing the interface using a `Map<string, string>`

Both stores are instantiated once in `src/index.ts` and injected into services via constructor arguments (no singleton pattern, no global variables).

**Acceptance Criteria:**
- [ ] `IRoomStore` and `ISessionStore` interfaces are defined and exported from `packages/shared` or from the server's store files (SA preference: define interfaces in `packages/shared` and implementations in `packages/server`)
- [ ] `InMemoryRoomStore.getRoomByCode` correctly returns the room matching a given room code
- [ ] `InMemoryRoomStore.updateRoom` applies the updater function and stores the result atomically (no partial update)
- [ ] Both stores are fully unit-tested: each method has at least one happy-path test and one not-found/edge case test (use Vitest)
- [ ] No TypeScript errors
- [ ] Neither store has any side effects (no timers, no Socket.IO calls) — they are pure data containers

**Complexity:** S

---

### S0-5 — Room Creation HTTP Endpoint and Room Code Generator

**Title:** Implement `POST /api/rooms` and the room code generation utility

**Description:**
Implement the only HTTP mutation endpoint in the system, as specified in `Architecture/API_DESIGN.md`.

1. `generateRoomCode()` utility in `packages/server/src/services/RoomManager.ts`:
   - Generates a 6-character code using the character set `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (uppercase Latin A-Z and digits 0-9; ambiguous characters O, I, 0, 1 are excluded to prevent player confusion when reading codes aloud)
   - Characters are ASCII only — no Cyrillic, no Unicode, no lowercase
   - Uses `crypto.randomBytes` for randomness (not `Math.random`)
   - On collision with an existing room code, retries up to 10 times then throws a typed error
   - Example valid codes: `BNK7R2`, `X4QM9A`, `GHVP3K`

2. `POST /api/rooms` Fastify route:
   - Validates body: `{ nickname: string }` — nickname 2-20 characters, trimmed
   - Calls `generateRoomCode()` to get a unique code
   - Creates a `Room` object with `state: "LOBBY"`, `hostPlayerId` set to the new player's ID, `players` map containing the host player
   - Creates a `Player` object for the host: `status: "ACTIVE"`, `sessionToken` = 64-char random hex (`crypto.randomBytes(32).toString('hex')`), `socketId: null` (set later when socket connects)
   - Stores the room via `IRoomStore`
   - Stores the session token → player ID mapping via `ISessionStore`
   - Returns 201 with `{ roomId, roomCode, roomUrl, playerId, sessionToken }`

3. Nickname collision handling: if the nickname already exists in the room, append `(2)`, `(3)`, etc.

**Acceptance Criteria:**
- [ ] `POST /api/rooms` with `{ "nickname": "Аня" }` returns 201 with all five fields
- [ ] `POST /api/rooms` with a nickname shorter than 2 characters returns 400 with a Ukrainian error message
- [ ] `POST /api/rooms` with a nickname longer than 20 characters returns 400
- [ ] The generated room code is exactly 6 characters, all uppercase ASCII alphanumeric (A-Z + 0-9), with O, I, 0, and 1 excluded from the character set
- [ ] The room is retrievable from `IRoomStore` immediately after the POST returns
- [ ] The session token is retrievable from `ISessionStore` immediately after the POST returns
- [ ] Session token is 64 characters of hex
- [ ] Unit test: `generateRoomCode` returns unique codes on repeated calls against a store with existing codes

**Complexity:** M

---

### S0-6 — Room Join Socket.IO Handler

**Title:** Implement `room:join` Socket.IO event handler (initial join and reconnect)

**Description:**
This is the entry point for all players. The same handler serves both first-time join and reconnect, distinguished by whether a valid `sessionToken` is provided.

Implement in `packages/server/src/socket/handlers/roomHandlers.ts`:

**First-time join path** (no session token, or token not found in store):
1. Validate room exists (look up by `roomCode`) — if not found, ack `ROOM_NOT_FOUND`
2. Validate room state is `LOBBY` — if `IN_GAME`, ack `GAME_IN_PROGRESS`; if `ENDED`, ack `ROOM_NOT_FOUND`
3. Validate player count < 10 — if 10 already, ack `ROOM_FULL`
4. Handle nickname collision: if nickname exists in room, auto-suffix `(2)`, `(3)`, etc.
5. Create `Player` object, store session token, add to room
6. Join the Socket.IO room (socket.join(roomId))
7. Ack with `{ ok: true, player: PlayerView, room: RoomView }`
8. Emit `player:joined` to all other sockets in the room

**Reconnect path** (session token found in store, player slot exists, player is `RECONNECTING`):
1. Look up player by session token
2. Verify the player's room is still active
3. Update `player.socketId` to the new socket ID
4. Set `player.status` to `ACTIVE`
5. Clear `player.disconnectedAt`
6. Join the Socket.IO room
7. Emit `room:state` (full state) to the reconnecting player only
8. Emit `player:reconnected` to all other sockets in the room

**Disconnect handler** (registered when any socket connects):
1. Look up player by `socket.id`
2. If found and game is in progress: set `player.status = "RECONNECTING"`, set `player.disconnectedAt = now()`, emit `player:reconnecting` to room
3. If found and game is in lobby: remove player from room, emit `player:left` to room
4. Start reconnect/host-transfer timers (these are implemented in later tasks — for now, just log a TODO comment)

**Acceptance Criteria:**
- [ ] First-time join: player appears in the room's player map with correct fields
- [ ] First-time join: all other connected sockets in the room receive `player:joined`
- [ ] Reconnect: the reconnecting player receives `room:state` with full game state
- [ ] Reconnect: all other sockets receive `player:reconnected`
- [ ] Room-full rejection returns `{ ok: false, error: "ROOM_FULL" }` ack
- [ ] Room-not-found rejection returns `{ ok: false, error: "ROOM_NOT_FOUND" }` ack
- [ ] Game-in-progress rejection returns `{ ok: false, error: "GAME_IN_PROGRESS" }` ack
- [ ] Disconnect mid-lobby removes player and broadcasts `player:left`
- [ ] Disconnect mid-game sets status to `RECONNECTING` and broadcasts `player:reconnecting`
- [ ] No TypeScript errors
- [ ] Event name comes from the `EVENTS` constant, not a raw string

**Complexity:** L

---

### S0-7 — React Client Foundation and Socket Connection

**Title:** Build React app shell with React Router v6, Zustand store, Socket.IO client, and session token management

**Required dependencies (install these; no alternatives):**
- `react-router-dom` v6 (routing)
- `zustand` v4 (client state — mandatory per CODE_STANDARDS.md; do not use useReducer + Context)
- `socket.io-client` v4 (real-time transport)

**Description:**
Implement the client-side socket and state infrastructure that all game views will depend on.

1. `packages/client/src/socket/socket.ts`:
   - Create a single Socket.IO client instance (not connected by default — `autoConnect: false`)
   - Configure with `auth: { sessionToken, reconnectToken }` where both tokens are read from localStorage
   - Export the singleton instance

2. `packages/client/src/socket/useSocket.ts`:
   - React hook that manages connection state: `"disconnected" | "connecting" | "connected" | "error"`
   - Exposes `connect()`, `disconnect()`, and `connectionState`
   - Handles `connect`, `disconnect`, and `connect_error` socket events

3. Session and reconnect token management:
   - On app load, read `sessionToken` from `localStorage.getItem("bunker_session")` and `reconnectToken` from `localStorage.getItem("bunker_reconnect")`
   - When server returns tokens (from `POST /api/rooms` response or `room:join` ack), store both:
     - `localStorage.setItem("bunker_session", sessionToken)`
     - `localStorage.setItem("bunker_reconnect", reconnectToken)`
   - Inject both tokens into the socket's `auth` before connecting

4. `packages/client/src/store/gameStore.ts` — Zustand store:
   - Initial slices: `room: RoomView | null`, `players: PlayerView[]`, `ownCharacter: CharacterCard | null`, `connectionState`
   - Socket event handlers import this store and call its setters directly (outside React)
   - Components import store values via Zustand selectors — not via props or context

5. `packages/client/src/App.tsx`:
   - React Router v6 (`createBrowserRouter`): routes for `/` (HomePage), `/r/:roomCode` (LobbyPage or GamePage depending on room state)
   - Wrap app in a socket context provider that provides the socket instance and connection state

6. `packages/client/src/pages/HomePage.tsx`:
   - Two action areas: "Створити кімнату" and "Приєднатися за кодом"
   - "Створити кімнату" shows a nickname input + button; on submit, calls `POST /api/rooms` and redirects to `/r/:roomCode`
   - "Приєднатися за кодом" shows a room code input + nickname input; on submit, navigates to `/r/:roomCode` where the join flow completes
   - All strings from `i18n/uk.json`
   - Inline validation: nickname 2-20 chars, show error if violated

**Acceptance Criteria:**
- [ ] `react-router-dom@6`, `zustand@4`, and `socket.io-client@4` are installed as dependencies in `packages/client/package.json`
- [ ] App starts with `pnpm dev` and is accessible at `localhost:5173` (or configured port)
- [ ] Home page renders with two action areas in Ukrainian
- [ ] Nickname validation shows an inline error for names shorter than 2 characters before any network call
- [ ] "Створити кімнату" calls `POST /api/rooms` and on success navigates to `/r/:roomCode`
- [ ] Both `sessionToken` and `reconnectToken` returned by `POST /api/rooms` are stored in `localStorage`
- [ ] After navigation, the socket connects with both tokens in `socket.handshake.auth` and emits `room:join`
- [ ] `gameStore.ts` is a Zustand store; no `useReducer` + Context pattern is used for game state
- [ ] A socket event handler (even a stub for `room:state`) updates the Zustand store directly without going through React dispatch
- [ ] The app recovers gracefully if the server is unreachable (shows a network error message from uk.json, does not crash)
- [ ] No TypeScript errors
- [ ] No hard-coded Ukrainian strings in component files (all come from uk.json)
- [ ] Routing uses React Router v6 `createBrowserRouter` API; no class components or old `<Switch>` API

**Complexity:** L

---

### S0-8 — Character Dealing Engine

**Title:** Implement `CharacterDealer` service (data only, no UI)

**Description:**
This is a pure data-transformation service. It takes the full trait pool and produces a set of `CharacterCard` objects for a given number of players. It has no Socket.IO or Fastify dependencies.

Implement `packages/server/src/services/CharacterDealer.ts`:

1. `ContentData` loader (if not already done): reads all 7 `content/traits/*.json` files at startup and indexes them by `TraitCategory`. Exposes `getTraitsByCategory(category: TraitCategory): Trait[]`.

2. `CharacterDealer.deal(playerIds: string[], contentData: ContentData): Map<string, CharacterCard>`:
   - For each `TraitCategory`, shuffle the trait array using Fisher-Yates
   - Assign trait[0] to player[0], trait[1] to player[1], etc.
   - This guarantees no two players share the same trait in the same category
   - `isRevealed` is `false` for all traits at deal time
   - `value` is denormalized from the trait's Ukrainian string
   - Returns a `Map<playerId, CharacterCard>`
   - Throws if `playerIds.length > traitPool.minCategorySize` (prevents dealing more players than traits in the smallest category — in practice, each category has ~30 entries and max players is 10, so this should never throw)

**Acceptance Criteria:**
- [ ] `CharacterDealer.deal(["p1","p2","p3","p4","p5","p6"], contentData)` returns 6 cards with no shared trait values in any category
- [ ] All 7 trait categories are populated in every returned card
- [ ] `isRevealed` is `false` for all traits in all returned cards
- [ ] Running `deal` twice with the same playerIds returns different assignments (probabilistic — test that 10 consecutive deals are not all identical)
- [ ] Unit tests cover: 6 players, 10 players, and the error case (too many players for pool size — mock a content pool with only 5 entries per category and request 6 players)
- [ ] Service has no side effects (no IO, no socket calls) — it is a pure function

**Complexity:** M

---

---

### S0-9 — Docker Setup

**Title:** Add Dockerfile and docker-compose.yml for local dev parity and one-command future deployment

**Description:**
Add Docker scaffolding to the repository so the app can be deployed to any Docker-compatible host (Railway, Render, Fly.io, bare VPS) without code changes. This task does not affect the local `pnpm dev` workflow — it is an additional deployment path.

1. `Dockerfile` at the repo root:
   - **Stage 1 (builder):** `node:22-alpine`; copies workspace files; runs `pnpm install` and `pnpm build` across all three packages
   - **Stage 2 (production):** `node:22-alpine`; copies only built server artifacts, compiled React `dist/`, and `content/` JSON files from stage 1; no dev dependencies in the final image
   - `EXPOSE 3000`
   - `CMD ["node", "packages/server/dist/index.js"]`

2. `docker-compose.yml` at the repo root:
   - Single service `app`
   - Builds from the `Dockerfile`
   - Maps port `3000:3000`
   - Mounts `./content:/app/content` as a volume so JSON content edits do not require a full image rebuild
   - Sets `NODE_ENV=production` and `PORT=3000`

3. Add `docker compose up --build` instructions to `README.md` under a "Docker deployment" section.

**Acceptance Criteria:**
- [ ] `docker compose up --build` completes without errors from the repo root
- [ ] The app is accessible at `http://localhost:3000` after `docker compose up`
- [ ] `GET /health` returns HTTP 200 inside the Docker container
- [ ] The React app loads in the browser (no 404 on `/`)
- [ ] Editing a file in `content/` and restarting the container (without rebuilding the image) picks up the change
- [ ] The final Docker image size is under 500 MB
- [ ] No secrets, `.env` files, or `node_modules` from the host are copied into the image (verify via `docker run --rm bunker-game ls /app/node_modules` shows only prod deps)
- [ ] `pnpm dev` on the local machine is unaffected by these files

**Complexity:** M

---

## Sprint 0 Dependency Order

```
S0-1 (scaffold)
  └── S0-2 (shared types)
        ├── S0-3 (server foundation)
        │     └── S0-4 (stores)
        │           └── S0-5 (room creation HTTP)
        │                 └── S0-6 (room join socket)
        └── S0-7 (client foundation)    ← can start in parallel with S0-3 after S0-2
S0-8 (character dealing)                ← can start after S0-1; no S0-3 dependency
S0-9 (Docker setup)                     ← can start after S0-1; depends only on the repo scaffold
```

S0-7 (client) and S0-3 through S0-6 (server) can proceed in parallel once S0-1 and S0-2 are complete.
S0-8 can start immediately after S0-1 — it has no server or client dependency.
S0-9 can start after S0-1 — it only needs the monorepo structure to exist. It can be completed in parallel with S0-3 through S0-8, but its acceptance criteria require a working build, so in practice it is easiest to validate after S0-3 through S0-7 are done.

**Definition of Done for Sprint 0:**
After all 9 tasks are complete and SA-approved, a developer should be able to:
1. Open the home page (`pnpm dev` path via `localhost:5173`, or Docker path via `localhost:3000`)
2. Enter a nickname and create a room
3. Copy the invite link, open it in a second browser tab, enter a second nickname, and join
4. See both players in the lobby in real time
5. Disconnect one tab and see the reconnecting indicator in the other tab
6. Run `docker compose up --build` and reach the same app at `localhost:3000` (Docker path)
