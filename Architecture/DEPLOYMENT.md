# Deployment — Bunker Team Game

**Project:** bunker-team-game
**Version:** 0.1
**Quality Mode:** MVP
**Last Updated:** 2026-06-01
**Author:** Solution Architect Agent

---

## Summary

| Phase | Method | URL |
|---|---|---|
| Current (MVP dev) | `pnpm dev` on local machine | `http://localhost:3000` |
| Future (hosted) | `docker compose up` on any Docker-compatible host | Provider-assigned URL |

The server is a standard Node.js process with no platform-specific APIs. It reads configuration from environment variables only. Invite links use `localhost` in dev; they use the provider-assigned hostname once hosted.

---

## Local Development (Current)

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 22 LTS | https://nodejs.org |
| pnpm | 9.x | `npm install -g pnpm` |
| Git | any recent | https://git-scm.com |

Docker is NOT required for local development. It is only needed for the containerised deployment path.

### One-command start

```bash
git clone https://github.com/mazay1907/bunker-team-game.git
cd bunker-team-game
pnpm install
pnpm dev
```

`pnpm dev` at the root uses `concurrently` to start both the Fastify server (port 3000) and the Vite dev server (port 5173) in a single terminal session.

| Process | Port | What it serves |
|---|---|---|
| Fastify server | 3000 | REST API + Socket.IO |
| Vite dev server | 5173 | React app with HMR |

In development, Vite proxies `/api` and the Socket.IO path (`/socket.io`) to port 3000 so the client does not need CORS configuration.

### Environment variables (local)

No `.env` file is required for local dev — the defaults work out of the box.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port the Fastify server listens on |
| `NODE_ENV` | `development` | Enables dev-mode logging and source maps |

Create a `.env` file in the repo root only if you need to override a default. The `.env` file is in `.gitignore` and must never be committed.

---

## Production Build (Local Preview)

To verify the production build locally before Docker:

```bash
pnpm build          # builds packages/shared, packages/server, packages/client
pnpm start          # starts the Node.js server serving the React dist/
```

After `pnpm build`, Fastify serves the React `dist/` folder directly (no separate dev server). Open `http://localhost:3000` to test the production bundle.

---

## Docker Deployment (Future — Platform-Agnostic)

### Strategy

A multi-stage `Dockerfile` and a `docker-compose.yml` are included in the repository from Sprint 0 (task S0-9). The Docker image encapsulates the full production build — both the Node.js server and the compiled React bundle. No Node.js installation is required on the host.

The same image can be deployed to:
- Railway (via `railway up` or their Docker deploy option)
- Render (via their Docker deploy option)
- Fly.io (via `fly deploy`)
- Any bare VPS with Docker installed (`docker compose up -d`)
- Any Kubernetes cluster as a standard workload

No platform-specific configuration is required inside the application code.

### Dockerfile overview

```
Stage 1: builder  (node:22-alpine)
  - Copy root workspace files
  - pnpm install (all workspaces)
  - pnpm build   (shared → server → client)

Stage 2: production  (node:22-alpine)
  - Copy built server artifacts from stage 1
  - Copy compiled React dist/ from stage 1
  - Copy content/ JSON files
  - EXPOSE 3000
  - CMD ["node", "packages/server/dist/index.js"]
```

The final image contains only production artifacts. Development dependencies and source files are excluded.

### docker-compose.yml overview

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./content:/app/content   # JSON edits don't require a rebuild
    environment:
      - NODE_ENV=production
      - PORT=3000
```

### One-command Docker start

```bash
docker compose up --build
```

The app is then accessible at `http://localhost:3000`.

### Building and running without compose

```bash
docker build -t bunker-game .
docker run -p 3000:3000 -e NODE_ENV=production bunker-game
```

---

## Hosting Platform Instructions (Future)

When ready to host, no application code changes are required. The only steps are provider-specific:

### Railway

1. Connect the `mazay1907/bunker-team-game` GitHub repository in the Railway dashboard.
2. Select "Deploy from Dockerfile" (not the Nixpacks auto-detect option).
3. Set `PORT` environment variable to `3000` (Railway injects its own `PORT` which overrides this — the server reads `process.env.PORT` correctly either way).
4. The app is live at the Railway-assigned `*.railway.app` URL.

### Render

1. Create a new "Web Service" from the GitHub repo.
2. Select "Docker" as the environment.
3. Set `PORT=3000` in the environment variables panel.
4. The app is live at the Render-assigned `*.onrender.com` URL.

### Fly.io

```bash
fly launch       # detects Dockerfile; prompts for region and app name
fly deploy
```

### Bare VPS (any cloud provider)

```bash
git clone https://github.com/mazay1907/bunker-team-game.git
cd bunker-team-game
docker compose up -d --build
```

---

## Environment Variables Reference (Production)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | No | `3000` | Most hosting platforms inject this automatically |
| `NODE_ENV` | No | `development` | Set to `production` on any hosted environment |

No other environment variables are required in MVP. There is no database, no external API, and no third-party service integration. Content is bundled in the Docker image.

---

## Domain and TLS

**Not in scope for MVP.** Invite links use `localhost` in dev and the provider-assigned hostname when hosted. When a custom domain is needed:
- Most providers (Railway, Render, Fly.io) offer one-click custom domain + automatic TLS (Let's Encrypt) in their dashboard.
- No code changes are required — the server does not terminate TLS; the hosting platform's reverse proxy handles it.

---

## Static File Serving

In production, Fastify serves the React `dist/` folder directly from the Node.js process using `@fastify/static`. This keeps the deployment as a single process (no Nginx, no CDN) — sufficient for a small team.

The catch-all route `GET /r/:roomCode` returns `index.html` so React Router can handle client-side navigation on direct URL access.

If load increases in Phase 2, static assets can be moved to a CDN without changing the server — simply remove the static plugin and point the CDN at the `dist/` folder.

---

## Health Check

`GET /health` returns HTTP 200 and is available at all times:

```json
{
  "status": "ok",
  "uptime": 12345,
  "activeRooms": 3
}
```

All hosting platforms listed above support configuring this endpoint as a health check probe.

---

## Version Control

- **GitHub account:** `mazay1907`
- **Repository:** `mazay1907/bunker-team-game`
- **Default branch:** `main`
- `main` is always deployable — no broken state on main.
- Feature development happens on `feat/*` branches; merged via PR.

---

## What This Deployment Does NOT Include (MVP)

| Excluded | Reason |
|---|---|
| Custom domain / TLS | Not needed for local dev or team use; hosting platform handles it when needed |
| CI/CD pipeline | Manual `git push` + manual deploy trigger for MVP; add GitHub Actions in Phase 2 |
| Database | No persistent state in MVP |
| Redis | Not needed until Phase 2 |
| Horizontal scaling | Single process is sufficient for MVP scale (1-10 concurrent rooms) |
| Monitoring / APM | Console logging is sufficient for MVP; add in Phase 2 |
| Secrets manager | No secrets in MVP (no API keys, no DB passwords) |
