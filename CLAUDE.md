# Bunker Team Game — CLAUDE.md

Real-time browser-based multiplayer discussion/survival game for 6–10 players. Each player gets a secret character card with 7 traits; over 3 rounds they reveal traits, debate on Zoom/Meet, and vote one player out each round. Ukrainian language throughout. Built for the owner's team first, designed to publish later.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + TypeScript + React Router v6 + Zustand + Tailwind CSS v4 + Lucide React |
| Backend | Node.js 22 LTS + Fastify + TypeScript + Socket.IO 4 |
| Monorepo | pnpm workspaces (`packages/client`, `packages/server`, `packages/shared`) |
| State | In-memory (no database in MVP) |
| Content | JSON files (`content/scenarios/`, `content/traits/`) |
| Deployment | Docker (local dev now; any Docker host later) |
| Version control | GitHub — `mazay1907/bunker-team-game` |

---

## Folder Structure

```
bunker-team-game/
├── packages/
│   ├── shared/src/         # Socket.IO payload types + shared models (imported by both sides)
│   │   ├── events.ts       # All event payload interfaces + EVENTS constants
│   │   ├── models.ts       # Room, Player, CharacterCard, Round, Vote, Scenario, Trait
│   │   └── index.ts
│   ├── server/src/
│   │   ├── index.ts        # Entry point
│   │   ├── http/           # Fastify routes + JSON schemas
│   │   ├── socket/handlers/ # One file per event domain (room, host, reveal, vote, game)
│   │   ├── services/       # RoomManager, GameStateMachine, SessionManager,
│   │   │                   # CharacterDealer, VoteEngine, TimerService
│   │   ├── store/          # RoomStore.ts + SessionStore.ts (interface + in-memory impl)
│   │   └── content/        # ContentData.ts — loads JSON at startup
│   └── client/src/
│       ├── App.tsx          # createBrowserRouter + socket provider
│       ├── socket/          # socket.ts instance + useSocket.ts hook
│       ├── pages/           # HomePage, LobbyPage, GamePage
│       ├── components/      # lobby/, game/, shared/
│       ├── store/gameStore.ts  # Zustand store — ALL client game state
│       ├── i18n/uk.json     # Every user-facing Ukrainian string
│       └── hooks/           # useRoom.ts, useGame.ts
├── content/
│   ├── scenarios/scenarios.json
│   └── traits/             # gender_age.json, profession.json, health.json,
│                           # hobby.json, phobia.json, baggage.json, secret_fact.json
├── Architecture/           # SA documents (TECH_STACK, SYSTEM_DESIGN, DATA_MODEL,
│                           # API_DESIGN, CODE_STANDARDS, DEPLOYMENT)
├── Reqs/                   # PM documents (PRODUCT_VISION, EPICS, SCENARIOS,
│                           # BACKLOG, MVP_BACKLOG)
├── GAME_RULES.md           # SOURCE OF TRUTH for all game mechanics
├── Dockerfile              # Multi-stage, node:22-alpine
├── docker-compose.yml
├── package.json            # pnpm workspace root
└── tsconfig.base.json
```

---

## How to Run

```bash
# Install
pnpm install

# Local dev (starts server :3000 + Vite dev server :5173 concurrently)
pnpm dev

# Production build + preview
pnpm build && pnpm start

# Docker (production image, port 3000)
docker compose up --build
```

Vite proxies `/api` and `/socket.io` to port 3000 in dev — no CORS config needed.

**Env vars** (defaults work out of the box locally):

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Fastify listen port |
| `NODE_ENV` | `development` | Set to `production` on any hosted env |

---

## Key Rules & Conventions

### Architecture
- **Server-authoritative.** All game logic lives on the server. The client is a dumb view. Never calculate round results, vote tallies, or phase transitions on the client.
- **No database in MVP.** In-memory `Map` only. `RoomStore` interface exists for Phase 2 Redis/Postgres swap.
- **Shared types are the contract.** All Socket.IO payloads are typed in `packages/shared`. A type mismatch is a compile error, not a runtime bug.

### TypeScript
- `strict: true` everywhere. No `any`. No `!` without a proof comment.
- `interface` for object shapes, `type` for unions/aliases.
- All exported functions must have explicit return types.

### Naming
- React components: `PascalCase.tsx`
- Services / stores: `PascalCase.ts`
- Everything else: `camelCase.ts`
- Constants: `SCREAMING_SNAKE_CASE`
- Socket events: `domain:action` (e.g., `reveal:submit`, `phase:changed`) — defined as constants in `packages/shared/src/events.ts`

### Client State
- **Zustand is mandatory** — not optional. Socket.IO handlers update the store directly outside React's render cycle.
- One store: `packages/client/src/store/gameStore.ts`. No additional top-level stores without SA approval.
- Derived values (e.g., "can I vote?") are computed on read from store — not stored as separate slices.

### i18n
- **No hard-coded Ukrainian strings in code.** All user-facing text comes from `uk.json`.
- Server error responses return error codes (e.g., `"ROOM_NOT_FOUND"`); client resolves them to display strings via `uk.json`.

### Size limits
- Functions: max 40 lines. Files: max 250 lines.

### Commits
Format: `type(scope): description`
Scopes: `server` | `client` | `shared` | `content` | `infra`
Example: `feat(server): implement VoteEngine with tie resolution`

---

## Available Agents

| Agent | When to use | Trigger |
|---|---|---|
| `product-manager` | Plan features, update backlog, write requirements | "Product!" / "PM, ..." |
| `solution-architect` | Architecture decisions, code review, tech stack questions | "Start project!" / post-feature review |
| `developer` | Implement features from backlog | "Developer, start implementation" |
| `scenario-formatter-sub` | Reformat features into A-Z scenarios for `Reqs/SCENARIOS.md` | Called by PM |
| `market-research-sub` | Market size, trends, pricing benchmarks | Called by PM (parallel with competitor-analysis-sub) |
| `competitor-analysis-sub` | Competitor profiles, feature gaps, positioning | Called by PM (parallel with market-research-sub) |
| `master-of-agents` | Create or update agent definitions in `.claude/agents/` | "Jarvis, create/update agent..." |

---

## Current Status

**Phase:** MVP — full game loop live and battle-tested

| Area | Status |
|---|---|
| Game rules | Complete — `GAME_RULES.md` |
| Product requirements | Complete — `Reqs/` |
| Architecture docs | Complete — `Architecture/` |
| Shared types | `packages/shared/src/events.ts` + `models.ts` — source of truth for all Socket.IO contracts |
| Server | Fastify + Socket.IO, all handlers live, `tsx watch` auto-reload in dev |
| Client | React 18 + Vite + Zustand, all pages + components, mobile layout |
| i18n | 100% Ukrainian — zero hardcoded strings, all keys in `uk.json` |
| Tests | Vitest — VoteEngine, TimerService, reconnect resilience, room expiry |
| Docker | `Dockerfile` + `docker-compose.yml` ready |

**Full game loop delivered:**
- Room create (HTTP) + join/reconnect (Socket.IO) with cookies (24h TTL, not localStorage)
- 3-round game: REVEAL → DEBATE → VOTE × 3
- Bunker capacity always = `totalPlayers − 3` (displayed dynamically, not from scenario JSON)
- REVEAL: rolling reveal; auto-submit on 2-min timeout; own card shows only revealed traits in DEBATE/VOTE; already-revealed traits blocked from reselection in subsequent rounds
- DEBATE: **host manually starts timer** via "Запустити таймер" button; timer is display-only (no auto-advance); speaking order shown in circular rotation (shifts by 1 each round); host advances speaker with "Наступний →"; timer-ended signal with no side effects; host clicks "Голосувати зараз" to start voting manually
- VOTE: vote tallies hidden until all players have voted; each player may change vote once; tiebreak modal shown only to living players with per-player voted feedback
- Elimination: eliminated player's full card (all 7 traits) shown immediately; own card visible in left column even as spectator
- Host: can kick players mid-game (KICKED status); kicked players can reconnect via cookies; if host disconnects → 60s timer → host transferred; own nickname shown in header

**Resilience:**
- 5-min reconnect hold before auto-elimination (single-elimination rule per round)
- Host-transfer timer (60s) on host disconnect mid-game
- React StrictMode double-mount guard (`joinCalledRef`) prevents duplicate `player:joined`
- Room expiry sweep (30 min idle, no connected players)
- `admin-status.json` written every 5s with live room/player state (separate from `admin.json` to avoid file-watcher loop)

**Source of truth priority:** `GAME_RULES.md` > `Architecture/` > `Reqs/` > `Design/` > this file.

**Design:** before implementing any page/component, read `Design/DESIGN_SYSTEM.md` (tokens, typography, buttons, cards, animations) and the corresponding `Design/*_PAGE_FIGMA_BRIEF.md`. Never use raw hex or pixel values — only the `bunker-*` Tailwind tokens defined there.

**Known game-mechanic decisions (not in GAME_RULES.md):**
- Kicked players can rejoin via reconnect token in cookies (host can kick again to remove permanently)
- Tiebreak vote resets `hasVoted` client-side so the modal buttons work without re-entering
- Speaking order in DEBATE is server-computed: players sorted by `joinedAt`, circular-shifted by `(round − 1)` positions; host broadcasts `debate:order` + `debate:speakerChanged` events

---

## Document Map

| File | Owner | Purpose |
|---|---|---|
| `GAME_RULES.md` | PM | Game mechanics — always the final word on rules |
| `Reqs/PRODUCT_VISION.md` | PM | Goals, audience, success metrics, out-of-scope |
| `Reqs/EPICS.md` | PM | Feature groups by phase (MVP vs Phase 2/3) |
| `Reqs/SCENARIOS.md` | PM | A-Z step-by-step scenarios per use case |
| `Reqs/BACKLOG.md` | PM | Feature backlog |
| `Reqs/MVP_BACKLOG.md` | PM + SA | WBS (96 tasks, 13 areas) + Sprint 0 kick-off tasks |
| `Architecture/TECH_STACK.md` | SA | Stack choices + decision log |
| `Architecture/SYSTEM_DESIGN.md` | SA | Component diagram, event flow, module responsibilities |
| `Architecture/DATA_MODEL.md` | SA | All TypeScript types (Room, Player, CharacterCard, Round, Vote) |
| `Architecture/API_DESIGN.md` | SA | All Socket.IO events + HTTP endpoints |
| `Architecture/CODE_STANDARDS.md` | SA | Conventions, folder structure, testing requirements |
| `Architecture/DEPLOYMENT.md` | SA | Local dev + Docker + hosting platform instructions |
| `Design/DESIGN_SYSTEM.md` | Design | **Read first** — color tokens, typography, buttons, inputs, cards, animations |
| `Design/HOME_PAGE_FIGMA_BRIEF.md` | Design | HomePage layout + component specs (already implemented) |
| `Design/LOBBY_PAGE_FIGMA_BRIEF.md` | Design | LobbyPage layout + component specs |
| `Design/GAME_PAGE_FIGMA_BRIEF.md` | Design | GamePage layout, all phases (reveal/discuss/vote), game-over screen, tie-break modal |
