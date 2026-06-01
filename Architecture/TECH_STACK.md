# Tech Stack — Bunker Team Game

**Project:** bunker-team-game
**Version:** 0.1
**Quality Mode:** MVP
**Last Updated:** 2026-05-31
**Author:** Solution Architect Agent

---

## Summary

| Layer | Choice | Version target |
|---|---|---|
| Frontend framework | React 18 | 18.x |
| Frontend build tool | Vite | 5.x |
| Frontend language | TypeScript | 5.x |
| Frontend routing | React Router | v6 |
| Client state management | Zustand | 4.x |
| Backend runtime | Node.js | 22 LTS |
| Backend framework | Fastify | 4.x |
| Backend language | TypeScript | 5.x |
| Real-time transport | Socket.IO | 4.x |
| State storage | In-memory (server process) | — |
| Content storage | JSON files | — |
| Package manager | pnpm | 9.x |
| Monorepo tooling | pnpm workspaces | — |
| Linting | ESLint + Prettier | — |
| Containerisation | Docker + docker-compose | — |
| Hosting (current) | Local machine | — |
| Hosting (future) | Any Docker-compatible host | — |

---

## Decision Log

### Frontend: React 18 + Vite + TypeScript

**Why React:**
- Large ecosystem; Socket.IO React patterns are well-documented
- Component model maps well to the game's discrete UI panels (lobby, character card, voting, scenario card)
- The solo developer is most likely to be productive in React vs. a smaller framework
- Easy to onboard contributors in Phase 2

**Why Vite:**
- Near-instant dev server hot-reload; no webpack complexity
- Native TypeScript support; no extra configuration
- Standard choice for new React projects in 2025-2026

**Why TypeScript (full-stack):**
- Shared types between client and server eliminate an entire class of real-time event drift bugs
- A `packages/shared` workspace exports the WebSocket event payload types used by both sides
- Critical for a WebSocket-heavy game where client/server must agree on every message shape

**Why React Router v6:**
- Standard routing solution for React SPAs; declarative route definitions in `App.tsx`
- URL-based routing allows players to share `/r/:roomCode` invite links that open the join flow directly
- v6 (with `createBrowserRouter`) is the current stable API; no migration risk

**Why Zustand for client state:**
- Socket.IO event handlers fire outside React's render cycle. Zustand's store can be updated from socket listeners without prop drilling or context re-renders.
- This is critical for real-time game state: phase changes, vote updates, and reveal events must update the UI without going through a React context dispatch chain.
- Minimal boilerplate: a store slice is a plain object with setter functions; no reducers, no action creators.
- Alternative considered: `useReducer` + Context. Rejected because a deeply nested context provider still re-renders the entire tree on every event, and the game has a high event rate during voting and reveal phases.

**Rejected alternatives:**
- Next.js — SSR provides no benefit for a real-time game; adds complexity with no payoff
- Vue / Svelte — React is more likely to match the developer's experience and Phase 2 hiring pool
- Plain JS — TypeScript pays for itself on the first day with shared event types

---

### Backend: Node.js 22 LTS + Fastify + TypeScript

**Why Node.js:**
- Same language as frontend; shared TypeScript types across the monorepo
- Excellent Socket.IO support (Socket.IO was written for Node)
- Lightweight enough for a game with 6-10 concurrent users per room
- Simple deployment: one Node.js process, containerised with Docker for platform-agnostic hosting

**Why Fastify over Express:**
- Faster request handling (not that it matters at this scale, but no reason to pick the slower one)
- First-class TypeScript support with typed request/reply objects
- Plugin system is cleaner than Express middleware chains
- Health endpoint and static file serving are trivial to add

**Why not Bun / Deno:**
- Socket.IO official support is still primarily Node-first
- Ecosystem maturity matters when reconnect/disconnect edge cases need to be debugged quickly

---

### Containerisation: Docker

**Why Docker:**
- The app runs locally for now (no hosting required). A `Dockerfile` and `docker-compose.yml` are added to Sprint 0 so the exact same environment can be deployed to Railway, Render, Fly.io, or any other Docker-compatible host with a single command — no platform-specific configuration required.
- Provides dev-prod parity: the developer's local environment and any future hosting environment run identical images.
- GitHub account `mazay1907` is the source of truth; a Docker image built from that repo is deployable anywhere.

**Why not a platform-native deploy (e.g., Railway's Git integration without Docker):**
- Platform-native deploys lock the project to one provider's build toolchain. Docker keeps the project portable.
- No domain or TLS setup is needed for the current phase; invite links use `localhost` in dev. When the project moves to a hosted environment, the Docker image is already ready.

**Docker strategy:**
- `Dockerfile` — multi-stage build: `node:22-alpine` base; builds `packages/shared`, `packages/server`, and `packages/client`; final stage copies only production artifacts
- `docker-compose.yml` — single service for local-dev parity; maps port 3000; mounts `content/` as a volume so JSON edits do not require a rebuild

---

### Real-time Transport: Socket.IO 4

**Why Socket.IO over native WebSocket:**
The game has five hard requirements that Socket.IO solves out of the box. Rolling them manually on raw WS would cost a week of work:

1. **Automatic reconnect with exponential backoff** — the 5-minute reconnect window (GAME_RULES.md) requires the client to keep retrying; Socket.IO does this automatically
2. **Rooms / namespaces** — each game room is a Socket.IO room; broadcasting to all players in a room is one line of code
3. **Event emitter API** — named events with typed payloads; eliminates manual message type routing
4. **Acknowledgements** — critical for vote submission: client gets a server-side confirmation that the vote was recorded
5. **Disconnect detection** — Socket.IO fires a reliable `disconnect` event, which starts the 5-minute timer and 60-second host-transfer timer

**Transport fallback:** Socket.IO falls back to HTTP long-polling if WebSocket is blocked (rare but relevant for corporate Zoom environments where the game will be used).

---

### State Storage: In-Memory (Node.js process)

**Why in-memory for MVP:**
- The game is stateless across sessions by design (no accounts, no persistent history)
- Room state is transient: a room lives for one session (30–60 minutes) and then expires
- A single server process can trivially hold 100+ concurrent rooms in a plain JavaScript Map
- Eliminates an entire infrastructure layer (no Redis, no DB connection, no schema migrations)
- Target load is 1–10 concurrent rooms (owner's team use)

**Risks and mitigations:**
- **Server restart loses all rooms** — acceptable for MVP; players reconnect within 5 minutes; in practice, Railway/Render deploy takes ~20 seconds and can be scheduled during off-hours
- **Single-process bottleneck** — not a concern at MVP scale; horizontal scaling is a Phase 2 concern
- **No room history** — explicitly out of scope per PRODUCT_VISION.md

**Phase 2 migration path:**
The `RoomStore` interface (see DATA_MODEL.md) is the single abstraction over state. Swapping the in-memory implementation for Redis requires changing one file. No other layer touches storage directly.

---

### Content Storage: JSON files

**Why JSON files (not a database):**
- Apocalypse scenarios (3-5 items) and character trait pools (~210 values across 7 categories × 30 entries) are small, stable, read-only data
- JSON files load at server startup and stay in memory
- Content editors can change scenarios and traits by editing a JSON file — no DB admin tools required
- The `is_premium` boolean field (EPICS.md, Epic 11) is a no-op flag in MVP; Phase 2 adds filtering by it without schema changes

---

### Monorepo: pnpm workspaces

**Structure:**
```
bunker-team-game/
  packages/
    client/      # React frontend
    server/      # Fastify + Socket.IO backend
    shared/      # TypeScript types shared by both
  content/
    scenarios/   # JSON scenario files
    traits/      # JSON trait pool files
```

**Why a monorepo:**
- Shared types package is the primary driver; it prevents client/server event schema drift
- Single repository; single CI pipeline; one `pnpm install` at the root
- Not over-engineered: three tiny packages, not a Nx/Turborepo setup

---

### Hosting: Platform-Agnostic (Local Now, Docker-Based Later)

**Current state:** The application runs on the developer's local machine. No server, no hosting account, no domain is required for MVP development and initial team use. Invite links use `localhost` in dev.

**Version control:** GitHub, account `mazay1907`. The repository is the single source of truth.

**Future deployment:** The application is designed to be deployable to any Docker-compatible host (Railway, Render, Fly.io, or a bare VPS) with a single `docker compose up` or equivalent command. No platform-specific APIs or configuration are used in the server code.

**Why not serverless (Vercel / Netlify functions):**
- WebSocket connections cannot stay open on serverless functions; they time out after 10-30 seconds
- The game requires persistent connections for the duration of a 15-20 minute session
- Socket.IO cannot run on serverless without significant workarounds

**Platform constraints avoided intentionally:**
- No Railway-specific build configuration
- No platform environment variables assumed beyond `PORT`
- No platform-managed domains or TLS in MVP scope
- The server is a standard Node.js process that listens on `process.env.PORT` (default 3000)

---

## What This Stack Does NOT Include (and Why)

| Excluded | Reason |
|---|---|
| Database (Postgres / SQLite) | No persistent state in MVP; in-memory is sufficient |
| Redis | Not needed until Phase 2 (multi-server, persistent sessions) |
| Message queue (RabbitMQ / Kafka) | No async worker pattern needed in MVP |
| GraphQL | REST + Socket.IO is simpler; GraphQL subscriptions are heavier than needed |
| Auth library (NextAuth, Passport) | No auth in MVP; nickname only |
| CSS framework (Tailwind, MUI) | Deferred; SA defers visual tooling to Designer/Developer |
| Testing framework | Specified in CODE_STANDARDS.md |
| Domain / TLS setup | Not needed for local dev; handled by the hosting platform when deployed |

---

## Phase 2 Additions (designed for, not built now)

| Addition | Impact |
|---|---|
| PostgreSQL | Add `packages/db` with a Prisma schema; `RoomStore` gets a Postgres implementation |
| Redis | Replace in-memory store; enables multi-instance deployment |
| Google OAuth | Add Fastify plugin; `host_user_id` field in Room becomes a real FK |
| Stripe | Add Stripe SDK to server; `is_premium` filter on scenarios becomes live |

The current stack is chosen so none of these additions require rewriting the application layer — only adding new implementations of existing interfaces.
