# Code Standards — Bunker Team Game

**Project:** bunker-team-game
**Version:** 0.1
**Quality Mode:** MVP
**Last Updated:** 2026-05-31
**Author:** Solution Architect Agent

---

## Guiding Principles

1. **Minimal and readable** — write the simplest code that correctly implements the requirement. Do not add layers, abstractions, or generics until there is a clear second use case.
2. **Types as documentation** — TypeScript types from `packages/shared` are the contract. If a type is unclear, fix the type, not a comment.
3. **Server-authoritative** — game logic lives on the server. The client is a dumb view. When in doubt, move logic to the server.
4. **One responsibility per module** — each file does one thing. Avoid catch-all `utils.ts` or `helpers.ts` files.
5. **No silent failures** — every error that can occur must be handled or explicitly thrown. Never swallow exceptions.

---

## Folder Structure

```
bunker-team-game/
├── packages/
│   ├── shared/                    # Shared TypeScript types
│   │   └── src/
│   │       ├── events.ts          # All Socket.IO payload types
│   │       ├── models.ts          # Room, Player, CharacterCard, etc.
│   │       └── index.ts           # Re-exports
│   │
│   ├── server/                    # Fastify + Socket.IO backend
│   │   └── src/
│   │       ├── index.ts           # Server entry point; wires everything together
│   │       ├── http/
│   │       │   ├── routes.ts      # Fastify route definitions
│   │       │   └── schemas.ts     # JSON schema for HTTP request validation
│   │       ├── socket/
│   │       │   ├── handlers/      # One file per event domain
│   │       │   │   ├── roomHandlers.ts
│   │       │   │   ├── hostHandlers.ts
│   │       │   │   ├── revealHandlers.ts
│   │       │   │   ├── voteHandlers.ts
│   │       │   │   └── gameHandlers.ts
│   │       │   └── middleware.ts  # Socket auth / session lookup
│   │       ├── services/
│   │       │   ├── RoomManager.ts
│   │       │   ├── GameStateMachine.ts
│   │       │   ├── SessionManager.ts
│   │       │   ├── CharacterDealer.ts
│   │       │   ├── VoteEngine.ts
│   │       │   └── TimerService.ts
│   │       ├── store/
│   │       │   ├── RoomStore.ts   # Interface + in-memory implementation
│   │       │   └── SessionStore.ts
│   │       └── content/
│   │           └── ContentData.ts # Loads and exposes JSON content files
│   │
│   └── client/                    # React frontend
│       └── src/
│           ├── main.tsx           # Vite entry point
│           ├── App.tsx            # Router and socket provider
│           ├── socket/
│           │   ├── socket.ts      # Socket.IO client instance
│           │   └── useSocket.ts   # React hook for socket connection state
│           ├── pages/
│           │   ├── HomePage.tsx
│           │   ├── LobbyPage.tsx
│           │   └── GamePage.tsx
│           ├── components/
│           │   ├── lobby/
│           │   │   ├── PlayerList.tsx
│           │   │   └── InviteLink.tsx
│           │   ├── game/
│           │   │   ├── ScenarioCard.tsx
│           │   │   ├── OwnCharacterCard.tsx
│           │   │   ├── PlayerBoard.tsx
│           │   │   ├── RevealPanel.tsx
│           │   │   ├── VotePanel.tsx
│           │   │   ├── DebateTimer.tsx
│           │   │   └── GameEndScreen.tsx
│           │   └── shared/
│           │       ├── HostBadge.tsx
│           │       └── StatusIndicator.tsx
│           ├── store/
│           │   └── gameStore.ts   # Zustand store — all client game state
│           ├── i18n/
│           │   └── uk.json        # All Ukrainian UI strings
│           └── hooks/
│               ├── useRoom.ts
│               └── useGame.ts
│
├── content/
│   ├── scenarios/
│   │   └── scenarios.json
│   └── traits/
│       ├── gender_age.json
│       ├── profession.json
│       ├── health.json
│       ├── hobby.json
│       ├── phobia.json
│       ├── baggage.json
│       └── secret_fact.json
│
├── Architecture/                  # Solution Architect documents
├── Reqs/                          # Product Manager documents
├── Dockerfile                     # Multi-stage build (node:22-alpine); produces a self-contained image
├── docker-compose.yml             # Single-service compose for local dev parity; maps port 3000
├── package.json                   # Root pnpm workspace config
├── pnpm-workspace.yaml
├── tsconfig.base.json             # Shared TypeScript config
├── .eslintrc.js
├── .prettierrc
└── .gitignore
```

---

## Naming Conventions

### Files
- React components: `PascalCase.tsx` (e.g., `PlayerList.tsx`)
- Non-component TypeScript: `camelCase.ts` (e.g., `gameStore.ts`, `RoomManager.ts`)
- Services use PascalCase to reflect they are class-like modules (e.g., `VoteEngine.ts`)
- JSON content files: `snake_case.json` (e.g., `secret_fact.json`)

### Variables and Functions
- Variables and function parameters: `camelCase`
- Constants that never change: `SCREAMING_SNAKE_CASE` (e.g., `MAX_PLAYERS = 10`, `REVEAL_QUOTA = [2, 2, 1]`)
- Exported TypeScript interfaces: `PascalCase` (e.g., `interface Room {}`)
- Exported type aliases: `PascalCase` (e.g., `type RoomState = ...`)

### Socket.IO Events
- Format: `domain:action` in lowercase with colon separator
- Client-to-server events: describe the action (e.g., `reveal:submit`, `vote:submit`, `host:kick`)
- Server-to-client events: describe what changed (e.g., `player:joined`, `phase:changed`, `game:ended`)
- All event names are defined as constants in `packages/shared/src/events.ts`:
  ```typescript
  export const EVENTS = {
    ROOM_JOIN: "room:join",
    ROOM_STATE: "room:state",
    // ...
  } as const;
  ```

---

## TypeScript Rules

- `strict: true` in all tsconfigs. No exceptions.
- No `any`. Use `unknown` and narrow with type guards if the type is truly unknown.
- No non-null assertion (`!`) unless you can prove it is safe in a comment directly above the line.
- Prefer `interface` over `type` for object shapes. Use `type` for unions, intersections, and aliases.
- All exported functions must have explicit return types.
- Do not export mutable state. Services expose methods, not their internal data.

---

## Function and File Size Limits

- **Functions: max 40 lines.** If a function exceeds this, extract a well-named helper.
- **Files: max 250 lines.** If a file exceeds this, split by responsibility.
- These limits are guidelines enforced in code review, not linter rules. Use judgment — a 45-line function that is perfectly clear is better than two confusing 20-line functions.

---

## Error Handling

### Server
- All Socket.IO event handlers must be wrapped in try/catch. Uncaught errors in a handler must not crash the process.
- Use the acknowledgement callback to return `{ ok: false, error: string }` for all expected failure modes.
- Log unexpected errors to the server console with room ID and player ID context.
- Do not expose stack traces or internal error details to clients.

### Client
- All socket acknowledgement callbacks must handle the `ok: false` branch.
- Network errors shown to the user must use strings from `uk.json` — never raw error codes.
- If a socket event arrives for an unexpected game state, log it and ignore it — do not crash the view.

---

## State Management (Client)

**Zustand is mandatory** for all client-side game state. Do not use `useReducer` + Context as an alternative.

**Why Zustand is required (not optional):** Socket.IO event handlers fire outside React's render cycle. Zustand's store can be updated directly from socket listeners without prop drilling or context re-renders. This is critical for the game's high event rate during reveal, voting, and reconnect phases. A React context dispatch chain would re-render the entire tree on every socket event; Zustand's subscriptions are component-granular.

Rules:
- The store holds the last-known server state (room, players, game, own character).
- Socket event handlers update the store directly. Components read from the store via Zustand selectors. Components do not hold game state locally (only UI state like "modal open").
- Derived values (e.g., "can I vote?", "how many traits left to reveal?") are computed from the store on read — not stored as separate state slices.
- All game state slices live in `packages/client/src/store/gameStore.ts`. Do not create additional top-level stores without SA approval.

---

## React Component Rules

- One component per file.
- Props interfaces are defined in the same file as the component, not in a separate types file.
- No inline anonymous functions in JSX that recreate on every render when the component is performance-sensitive. Use `useCallback` sparingly and only when there is a measured need.
- No direct DOM manipulation. Use React state and effects.
- Components may not import from `packages/server`. They may only import from `packages/shared`.

---

## i18n Rules

- **No hard-coded Ukrainian (or any) strings in component or server code.** All user-facing text comes from `packages/client/src/i18n/uk.json`.
- The i18n file is a flat key-value map for MVP (no nested namespaces required at this scale):
  ```json
  {
    "lobby.title": "Очікуємо гравців",
    "lobby.copyLink": "Скопіювати посилання",
    "error.roomNotFound": "Кімнату не знайдено"
  }
  ```
- A thin helper function `t(key: string): string` reads from the map. The developer may use any i18n library they prefer (react-i18next, etc.) as long as it reads from this file.
- Server error messages returned in `{ ok: false, error: string }` are **error codes** (e.g., `"ROOM_NOT_FOUND"`), not user-facing strings. The client looks up the display string from `uk.json` by error code.

---

## Testing Requirements (MVP Quality Mode)

MVP does not require comprehensive unit test coverage. Testing effort is focused where bugs cause the most damage.

**Required tests:**
- `GameStateMachine` — unit tests for all valid and invalid state transitions
- `VoteEngine` — unit tests covering: normal vote, tie, re-vote tie, host tiebreaker, host-is-eliminated fallback, self-vote rejection, abstention
- `CharacterDealer` — unit test that dealing N cards (6-10) from the pool produces N unique cards with no repeated traits per category

**Recommended but not required for MVP:**
- Integration test: full round (reveal → debate → vote → elimination) using Socket.IO client test library
- Unit tests for `TimerService`

**Not required for MVP:**
- End-to-end browser tests (Playwright)
- Full React component tests

**Test framework:** Vitest (consistent with Vite; runs in Node for both client and server packages).

---

## Linting & Formatting

- **ESLint** with `@typescript-eslint/recommended` rules
- **Prettier** with default settings (single quotes, 2-space indent, 100-char line length)
- Both run in `pnpm lint` and in the CI check
- Prettier is auto-applied on commit via a pre-commit hook (simple `lint-staged` setup)
- The linter does not enforce file/function size — that is a code review concern

---

## Git Conventions

### Commit messages
Format: `type(scope): short description`

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
Scopes: `server`, `client`, `shared`, `content`, `infra`

Examples:
```
feat(server): implement VoteEngine with tie resolution
fix(client): handle disconnected player in voting UI
chore(infra): add Dockerfile and docker-compose for local dev parity
```

### Branching
- `main` — always deployable
- Feature branches: `feat/short-name` (e.g., `feat/vote-engine`)
- Bug branches: `fix/short-name`
- No direct commits to `main` after the initial scaffold

---

## Security Checklist

Before any PR is merged, verify:
- [ ] No secrets, tokens, or API keys in source code
- [ ] All user inputs validated before processing (nickname length, trait selection count, vote target validity)
- [ ] Host actions validated server-side (never trust `isHost` from the client)
- [ ] Session tokens are not logged in production log output
- [ ] Socket event payloads are validated with Zod before business logic runs
- [ ] Error responses do not expose internal stack traces

---

## What NOT to Do

- Do not add a database in MVP. The scope does not require it.
- Do not add a Redis layer in MVP. The scope does not require it.
- Do not add a CSS framework (Tailwind, MUI, etc.) without SA approval — visual tooling is deferred.
- Do not implement Phase 2 features (accounts, Stripe, public lobby) in MVP code.
- Do not add logging to a third-party service (Datadog, Sentry) in MVP — console logging is sufficient.
- Do not build a custom reconnect mechanism — use Socket.IO's built-in reconnect.
- Do not use `process.exit()` in application code to handle errors. Throw and let the process manager handle it.
