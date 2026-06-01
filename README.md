# Бункер — командна гра

Онлайн-версія дискусійної гри «Бункер» для команд.

## Prerequisites

- [Node.js](https://nodejs.org) v22 LTS or newer
- [pnpm](https://pnpm.io) v9.x (`npm install -g pnpm@9`)
- [Git](https://git-scm.com)

Docker is only required for the containerised deployment path, not for local development.

## Quick Start (Local Development)

```bash
git clone https://github.com/mazay1907/bunker-team-game.git
cd bunker-team-game
pnpm install
pnpm dev
```

This starts:
- **Fastify server** on `http://localhost:3000` (REST API + Socket.IO)
- **Vite dev server** on `http://localhost:5173` (React app with HMR)

Open `http://localhost:5173` in your browser.

## Production Build (Local Preview)

```bash
pnpm build    # builds all packages
pnpm start    # serves at http://localhost:3000
```

## Docker Deployment

```bash
docker compose up --build
```

The app will be accessible at `http://localhost:3000`.

To restart after editing content files (no rebuild needed):

```bash
docker compose restart
```

## Run Tests

```bash
pnpm test
```

## Lint

```bash
pnpm lint
```

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Fastify server port |
| `NODE_ENV` | `development` | Environment mode |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | CORS allowed origin (set in production) |

No `.env` file is required for local development.

## Project Structure

```
bunker-team-game/
  packages/
    client/      # React 18 frontend (Vite + TypeScript)
    server/      # Fastify 4 + Socket.IO 4 backend
    shared/      # Shared TypeScript types
  content/
    scenarios/   # JSON apocalypse scenario files
    traits/      # JSON character trait pool files
```
