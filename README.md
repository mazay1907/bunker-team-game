# Бункер — командна гра виживання

A real-time multiplayer survival discussion game for teams of 6–10 players. Each player gets a secret character card with 7 traits. Over 3 rounds they reveal traits, debate on video call, and vote one player out. The remaining players claim a spot in the bunker.

## How to Play

1. **Create a room** — one player opens the app and creates a room, getting a 6-character room code
2. **Share the link** — share the room link with teammates so they can join
3. **Play** — the host starts the game; each round players reveal traits, discuss on Zoom/Meet, and vote someone out

## Prerequisites

- [Node.js](https://nodejs.org) v22 LTS or newer
- [pnpm](https://pnpm.io) v9.x (`npm install -g pnpm@9`)

Docker is only required for the containerised deployment path.

## Quick Start (Local Development)

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173` in your browser.

This starts:
- **Fastify server** on `http://localhost:3000` (REST API + Socket.IO)
- **Vite dev server** on `http://localhost:5173` (React app with HMR)

## Run Tests

```bash
pnpm --dir packages/server test
```

Or with watch mode:

```bash
pnpm --dir packages/server test:watch
```

## Docker Deployment

```bash
docker compose up --build
```

Open `http://localhost:3000`. No separate dev server — the container serves the built frontend.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Fastify server listen port |
| `NODE_ENV` | `development` | Set to `production` on any hosted environment |

No `.env` file required for local development — defaults work out of the box.

## Project Structure

```
bunker-team-game/
  packages/
    client/      # React 18 + Vite + TypeScript frontend
    server/      # Fastify + Socket.IO backend
    shared/      # Shared TypeScript types (imported by both sides)
  content/
    scenarios/   # JSON apocalypse scenario files
    traits/      # JSON character trait pool files (7 categories)
```
