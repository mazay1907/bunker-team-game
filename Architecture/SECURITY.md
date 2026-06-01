# Security — Bunker Team Game

**Project:** bunker-team-game
**Version:** 0.1
**Quality Mode:** MVP
**Last Updated:** 2026-05-31
**Author:** Solution Architect Agent

---

## Overview

The security model is deliberately scoped to the threat surface that actually exists at MVP: a real-time, single-origin, in-memory game server with no user accounts, no persistent storage, and no financial data. Controls focus on preventing impersonation, unauthorized host actions, and input abuse. Infrastructure-level concerns (TLS, DDoS) are delegated to the hosting platform.

---

## 1. Authentication Model

There are no passwords and no OAuth in MVP. Identity is established by possessing a cryptographically random token issued at join time.

**How identity flows:**

1. Client calls `POST /api/rooms` or emits `room:join` — the server creates a `Player` record and issues two tokens.
2. Client stores both tokens in `localStorage` and sends them on every subsequent socket handshake (via Socket.IO `auth` option).
3. The server's socket middleware (`socket/middleware.ts`) validates the incoming tokens against `SessionStore` and `reconnectIndex`, and attaches the resolved `playerId` to `socket.data`.
4. Every handler reads `socket.data.playerId` — never a `playerId` field from the event payload. Client-supplied player identities in payload bodies are ignored entirely.

```
Client                          Server
  │── POST /api/rooms ─────────► creates Player, issues sessionToken + reconnectToken
  │◄── { sessionToken, reconnectToken } ──────────────────────────────────────────────
  │
  │── socket connect (auth: { sessionToken, reconnectToken }) ──► middleware validates
  │                                                                attaches playerId to
  │                                                                socket.data
  │
  │── room:join {} ───────────► handler reads socket.data.playerId (never payload)
```

This means a malicious payload such as `{ playerId: "someone-else-id", ... }` is structurally harmless — the server never reads that field.

---

## 2. Two-Token System

Two separate tokens are issued per player. They serve different purposes and have different revocation semantics.

| Property | `sessionToken` | `reconnectToken` |
|---|---|---|
| Purpose | Identifies the browser/device across page reloads | Restores a player's in-progress room slot after a socket drop |
| Generation | `crypto.randomBytes(32).toString('hex')` — 64-char hex | Same |
| Storage | `localStorage` | `localStorage` |
| Sent on | Every socket handshake (`auth.sessionToken`) | Every socket handshake (`auth.reconnectToken`) |
| Server index | `SessionStore` (token → playerId) | `reconnectIndex` Map (token → playerId) |
| Checked by | Socket middleware on every connection | Socket middleware; room slot restore logic in `RoomManager` |
| Revoked when | Room is cleaned up (30-min expiry or game ends) | Same |

**Why two tokens instead of one:**

A single token that is compromised grants both a persistent session identity and the ability to hijack a room slot mid-game. Separating them means that if a `sessionToken` leaks (e.g., from a log line), the attacker cannot execute a room-slot takeover without also knowing the `reconnectToken`. Both must be present and valid for a reconnect to succeed. This is a meaningful improvement in a shared-device or screen-sharing context at minimal implementation cost.

Neither token encodes any claims. They are opaque identifiers; all meaning is server-side.

---

## 3. Host Authority Enforcement

The host role is the only elevated-privilege identity in the game. All host-only Socket.IO events are validated with a single, consistent guard:

```typescript
// In every host handler, before any business logic:
if (socket.data.playerId !== room.hostPlayerId) {
  return callback({ ok: false, error: "NOT_HOST" });
}
```

Rules:
- The check uses the server-resolved `socket.data.playerId`, not anything from the event payload.
- No `isHost` flag from the client is ever trusted or read. The `PlayerView.isHost` field sent to clients is computed server-side from `player.playerId === room.hostPlayerId` at serialisation time.
- Host role transfer (on disconnect or reconnect) is executed entirely by `RoomManager` on the server. The client is notified via `host:transferred` after the fact.
- All affected events: `host:kick`, `host:startGame`, `host:pickScenario`, `host:extendTimer`, `host:forceVote`, `host:endGame`, `host:playAgain`, `host:skipVote`.

---

## 4. Input Validation

All incoming data — HTTP bodies and Socket.IO event payloads — is validated with Zod before any business logic executes. Validation failures return an error immediately; the handler exits without touching game state.

### Validation rules by input

| Input | Rule |
|---|---|
| `nickname` | `z.string().trim().min(2).max(20)` — leading/trailing whitespace stripped |
| `roomCode` | `z.string().regex(/^[A-Z0-9]{6}$/)` — exactly 6 chars, uppercase alphanumeric only |
| `reveal:submit categories` | Array length must equal the round quota (2, 2, or 1); each category must be a valid `TraitCategory`; none may already have `isRevealed === true` on the player's card |
| `vote:submit targetId` | Must be a UUID present in `room.players`; target status must be `ACTIVE` or `RECONNECTING`; must not equal `socket.data.playerId` (no self-vote) |
| `host:pickScenario scenarioId` | Must exist in `ContentData.scenarios` or be the literal string `"RANDOM"` |
| `host:kick targetPlayerId` | Must be a UUID present in `room.players`; room state must be `LOBBY` |
| `host:skipVote disconnectedPlayerId` | Must be a UUID present in `room.players` with status `RECONNECTING` |

Schema definitions live in `packages/server/src/socket/handlers/` alongside their handlers, keeping validation co-located with usage. HTTP request bodies are validated via Fastify's JSON schema (`packages/server/src/http/schemas.ts`).

---

## 5. CORS Policy

| Environment | Policy |
|---|---|
| Development | Vite dev server proxies `/api` and the Socket.IO path to `localhost:3000`. No CORS headers needed; all traffic is same-origin from the browser's perspective. |
| Production | Fastify and Socket.IO both restrict `origin` to the server's own deployed URL. Set via the `ALLOWED_ORIGIN` environment variable. No wildcard `*` is permitted in production configuration. |

Socket.IO CORS config:

```typescript
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGIN ?? "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});
```

Fastify CORS (via `@fastify/cors`):

```typescript
await app.register(cors, {
  origin: process.env.ALLOWED_ORIGIN ?? "http://localhost:3000",
});
```

`ALLOWED_ORIGIN` must be set at deploy time. If it is missing in production, the server startup check should warn loudly — do not silently fall back to `*`.

---

## 6. Rate Limiting

Rate limiting targets the two surfaces most susceptible to abuse at MVP scale.

### HTTP: Room creation

- **Target:** `POST /api/rooms`
- **Limit:** 10 requests per minute per IP address
- **Implementation:** `@fastify/rate-limit` plugin, applied only to this route
- **Response on breach:** `429 Too Many Requests` with `{ error: "RATE_LIMIT_EXCEEDED" }`
- **Rationale:** Room creation is the only stateful HTTP action. Without limiting it, a single client can flood the in-memory room store.

### Socket.IO: Per-socket event rate

- **Target:** All Socket.IO events from a single socket
- **Limit:** 30 events per second per socket
- **Implementation:** A Socket.IO middleware that tracks event count per `socket.id` in a rolling 1-second window; disconnects sockets that exceed the threshold
- **Rationale:** Prevents a single bad client from overwhelming the event loop during reveal or vote phases.

Neither limit requires Redis in MVP — both counters are held in memory because the server is a single process at this scale.

---

## 7. Token Storage (localStorage Trade-off)

Tokens are stored in `localStorage`, not `httpOnly` cookies.

**Why not httpOnly cookies:** The client establishes a Socket.IO WebSocket connection, not a sequence of authenticated HTTP requests. Cookies are not sent with WebSocket upgrade requests without explicit custom handling. Implementing cookie-based auth for Socket.IO requires additional middleware complexity that is not warranted at MVP scale.

**XSS risk:** Tokens in `localStorage` are accessible to JavaScript running in the page origin, which means a successful XSS attack can exfiltrate them. This is the accepted trade-off.

**Mitigation:** A `Content-Security-Policy` header is set on the HTML response served by Fastify:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' ws://localhost:3000 wss://<production-origin>
```

This blocks inline scripts and external script sources, substantially reducing XSS attack surface. The CSP header must be present in both dev and production responses.

---

## 8. What Is Explicitly Out of Scope for MVP

| Concern | Status | Reason |
|---|---|---|
| HTTPS / TLS | Out of scope | Handled by the hosting platform (Fly.io, Railway, etc.) in front of the container |
| CSRF tokens | Not needed | No session cookies; no state-changing form submissions over HTTP |
| Account passwords | Not needed | No user accounts in MVP |
| PII beyond nickname | Not stored | Nicknames are ephemeral; cleared with room expiry |
| GDPR / data retention obligations | Not applicable | No persistent storage of user data |
| Audit logging | Out of scope | Console logging is sufficient for MVP; no compliance requirement |
| Penetration testing | Out of scope | MVP is owner's-team usage only |
| JWT / signed tokens | Not used | Opaque random tokens stored server-side are simpler and sufficient |

---

## 9. Pre-PR Security Checklist

The full checklist lives in `CODE_STANDARDS.md` under the "Security Checklist" section. Summary for quick reference:

- [ ] No secrets, tokens, or API keys in source code or committed `.env` files
- [ ] All user inputs validated with Zod before business logic runs
- [ ] Host actions validated server-side against `room.hostPlayerId`; no client `isHost` flag trusted
- [ ] Session and reconnect tokens not present in production log output
- [ ] Error responses return error codes only — no stack traces, no internal state
- [ ] `ALLOWED_ORIGIN` is set and not `*` in production config
- [ ] CSP header is present on the HTML response

See `Architecture/CODE_STANDARDS.md` for the complete checklist to use at PR review time.
